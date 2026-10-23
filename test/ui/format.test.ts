import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildAllocationCurl,
  computeCostBreakdown,
  computeShippableStock,
  describeStockCell,
  findDuplicateMerges,
  formatExclusionCode,
  formatExclusions,
  formatOrderSummary,
  formatProductDisplay,
  formatShortDecisionId,
  formatStatusHint,
  getWarehouseDecisionRole,
  getWarehouseStockQuantity,
  isWarehouseEligibleForProduct,
  splitWhyNot,
} from "../../public/format.js";
import { allocate } from "../../src/engine/index.js";
import type { Options, OrderLine, Product, Warehouse } from "../../src/engine/types.js";
import { loadSeedSnapshot } from "../helpers/seed-snapshot.js";

type GoldenCase = {
  id: string;
  desc?: string;
  lines: OrderLine[];
  options?: Options;
  expected: {
    totalCost: number;
  };
};

type GoldenFixtureFile = {
  distance: GoldenCase[];
  noSplit: GoldenCase[];
};

type SeedWarehouseWithStock = Warehouse & {
  stock: { productId: string; quantity: number }[];
};

type SeedFile = {
  products: Product[];
  warehouses: SeedWarehouseWithStock[];
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(currentDir, "../fixtures/golden.json");
const seedPath = resolve(currentDir, "../../data/seed.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenFixtureFile;
const seedCatalog = JSON.parse(readFileSync(seedPath, "utf8")) as SeedFile;

describe("public/format.js — pure UI display helpers", () => {
  const snapshot = loadSeedSnapshot();

  describe("computeCostBreakdown (#5)", () => {
    it("equals decision.totalCost for all 13 distance + 3 no-split golden cases", () => {
      const allSixteen = [...golden.distance, ...golden.noSplit];
      expect(allSixteen).toHaveLength(16);

      for (const tc of allSixteen) {
        const decision = allocate({ lines: tc.lines }, snapshot, tc.options);
        const breakdown = computeCostBreakdown(decision);
        expect(breakdown.computedTotal).toBe(decision.totalCost);
        expect(breakdown.totalCost).toBe(tc.expected.totalCost);
        expect(breakdown.text).toContain(`${decision.totalCost} ${decision.costUnit} =`);
      }
    });

    it("formats single and split shipment arithmetic cleanly", () => {
      const g03 = golden.distance.find((c) => c.id === "G03")!;
      const d03 = allocate({ lines: g03.lines }, snapshot, g03.options);
      expect(computeCostBreakdown(d03).text).toBe("50 km = 30 km distance + 20 km for 1 shipment");

      const g09 = golden.distance.find((c) => c.id === "G09")!;
      const d09 = allocate({ lines: g09.lines }, snapshot, g09.options);
      expect(computeCostBreakdown(d09).text).toBe(
        "75 km = 35 km distance (5 + 30) + 40 km for 2 shipments (20 km each)",
      );

      const g05 = golden.distance.find((c) => c.id === "G05")!;
      const d05 = allocate({ lines: g05.lines }, snapshot, g05.options);
      expect(computeCostBreakdown(d05).text).toBe(
        "285 km = 225 km distance (30 + 45 + 150) + 60 km for 3 shipments (20 km each)",
      );
    });

    it("handles zero shipments (UNFULFILLABLE) gracefully", () => {
      const emptyDecision = allocate({ lines: [{ productId: "P999", quantity: 10 }] }, snapshot);
      const breakdown = computeCostBreakdown(emptyDecision);
      expect(breakdown.computedTotal).toBe(0);
      expect(breakdown.text).toBe("0 km");
    });
  });

  describe("splitWhyNot (#4)", () => {
    it("returns the substring after the first ': '", () => {
      expect(splitWhyNot("+35 km: longer trip")).toBe("longer trip");
      expect(splitWhyNot("+185 km: one extra shipment")).toBe("one extra shipment");
      expect(splitWhyNot("-65 km: fills 8 fewer units")).toBe("fills 8 fewer units");
    });

    it("returns the whole string when ': ' is absent", () => {
      expect(splitWhyNot("longer trip")).toBe("longer trip");
      expect(splitWhyNot("")).toBe("");
    });
  });

  describe("formatExclusionCode & formatExclusions (#2, #3)", () => {
    it("maps raw exclusion codes to human-readable labels", () => {
      expect(formatExclusionCode("NO_COLD_FLEET")).toBe("No refrigerated vans");
      expect(formatExclusionCode("NO_COLD_STORAGE")).toBe("No cold storage");
      expect(formatExclusionCode("OTHER_CODE")).toBe("OTHER_CODE");
    });

    it("enriches exclusions with held quantities from catalog warehouses", () => {
      const g03 = golden.distance.find((c) => c.id === "G03")!;
      const decision = allocate({ lines: g03.lines }, snapshot, g03.options);
      const rows = formatExclusions(decision.excluded, seedCatalog.warehouses);

      expect(rows).toEqual([
        {
          warehouseId: "W02",
          productId: "P002",
          quantity: 30,
          holdsText: "holds 30",
          code: "NO_COLD_FLEET",
          reasonLabel: "No refrigerated vans",
          detail: "W02 holds 30 P002 but has no refrigerated vans, so it cannot deliver it safely.",
        },
        {
          warehouseId: "W06",
          productId: "P002",
          quantity: 20,
          holdsText: "holds 20",
          code: "NO_COLD_FLEET",
          reasonLabel: "No refrigerated vans",
          detail: "W06 holds 20 P002 but has no refrigerated vans, so it cannot deliver it safely.",
        },
      ]);
    });
  });

  describe("formatProductDisplay (#6), formatStatusHint (#8), formatShortDecisionId (#7)", () => {
    it("formats product ID and name together", () => {
      const p005 = seedCatalog.products.find((p) => p.id === "P005");
      expect(formatProductDisplay(p005, "P005")).toBe("P005 · Paracetamol Tablets (Box of 100)");
      expect(formatProductDisplay(undefined, "P999")).toBe("P999");
    });

    it("formats status hints for FULL, PARTIAL, and UNFULFILLABLE", () => {
      const dFull = allocate({ lines: [{ productId: "P002", quantity: 10 }] }, snapshot);
      expect(formatStatusHint(dFull)).toBe("all units allocated");

      const dPartial = allocate({ lines: [{ productId: "P002", quantity: 120 }] }, snapshot);
      expect(formatStatusHint(dPartial)).toBe("12 units short, back-order needed");

      const dUnfulfillable = allocate({ lines: [{ productId: "P999", quantity: 5 }] }, snapshot);
      expect(formatStatusHint(dUnfulfillable)).toBe("no eligible stock available");
    });

    it("truncates UUIDs to 8 chars", () => {
      expect(formatShortDecisionId("53994f4b-1234-4000-8000-abcdef123456")).toBe("53994f4b");
      expect(formatShortDecisionId(null)).toBe("");
    });
  });

  describe("eligibility, shippable stock (#11), and stock cells (#20, #21)", () => {
    it("computes shippable stock across eligible warehouses only", () => {
      const p002Stock = computeShippableStock("P002", seedCatalog.products, seedCatalog.warehouses);
      expect(p002Stock).toEqual({
        productId: "P002",
        requiresColdChain: true,
        totalUnits: 108,
        warehouseCount: 3,
        text: "Shippable stock: 108 across 3 warehouses",
      });

      const p001Stock = computeShippableStock("P001", seedCatalog.products, seedCatalog.warehouses);
      expect(p001Stock.totalUnits).toBe(1100);
      expect(p001Stock.warehouseCount).toBe(5);
    });

    it("describes stock cells for zero, ineligible cold, available, and allocated states", () => {
      const p002 = seedCatalog.products.find((p) => p.id === "P002")!;
      const p005 = seedCatalog.products.find((p) => p.id === "P005")!;
      const w01 = seedCatalog.warehouses.find((w) => w.id === "W01")!;
      const w02 = seedCatalog.warehouses.find((w) => w.id === "W02")!;
      const w04 = seedCatalog.warehouses.find((w) => w.id === "W04")!;

      expect(getWarehouseStockQuantity(seedCatalog.warehouses, "W02", "P002")).toBe(30);
      expect(isWarehouseEligibleForProduct(w02, p002, 30)).toBe(false);
      expect(isWarehouseEligibleForProduct(w04, p002, 40)).toBe(true);

      expect(describeStockCell(w01, p002, 0)).toEqual({
        state: "zero",
        quantity: 0,
        allocated: 0,
        canShip: false,
        primaryText: "—",
        secondaryText: "",
      });

      expect(describeStockCell(w02, p002, 0)).toEqual({
        state: "ineligible-cold",
        quantity: 30,
        allocated: 0,
        canShip: false,
        primaryText: "30",
        secondaryText: "can't ship cold",
      });

      expect(describeStockCell(w01, p005, 300)).toEqual({
        state: "allocated",
        quantity: 300,
        allocated: 300,
        canShip: true,
        primaryText: "300 → ships 300",
        secondaryText: "ships 300",
      });

      expect(describeStockCell(w04, p005, 0)).toEqual({
        state: "available",
        quantity: 100,
        allocated: 0,
        canShip: true,
        primaryText: "100",
        secondaryText: "",
      });
    });
  });

  describe("duplicate line merges (#12) and running order summary (#13)", () => {
    it("detects duplicate product lines and sums their quantities", () => {
      const merges = findDuplicateMerges([
        { productId: "P001", quantity: 50 },
        { productId: "P002", quantity: 10 },
        { productId: "P001", quantity: 50 },
      ]);
      expect(merges).toEqual([
        {
          productId: "P001",
          lineCount: 2,
          totalQuantity: 100,
          text: "P001 appears in 2 lines; they'll be combined (100 total)",
        },
      ]);
    });

    it("formats the running order summary with line count, total units, and cold-chain product count", () => {
      const summary = formatOrderSummary(
        [
          { productId: "P001", quantity: 100 },
          { productId: "P002", quantity: 50 },
          { productId: "P005", quantity: 300 },
        ],
        seedCatalog.products,
      );
      expect(summary).toEqual({
        lineCount: 3,
        totalUnits: 450,
        coldCount: 1,
        text: "3 lines · 450 units · 1 cold-chain product",
      });
    });
  });

  describe("getWarehouseDecisionRole (#41) and buildAllocationCurl (#40)", () => {
    it("describes chosen, excluded, alternative, and uninvolved warehouses for G03", () => {
      const g03 = golden.distance.find((c) => c.id === "G03")!;
      const d03 = allocate({ lines: g03.lines }, snapshot, g03.options);

      const w02Role = getWarehouseDecisionRole("W02", d03, seedCatalog.warehouses);
      expect(w02Role.role).toBe("excluded");
      expect(w02Role.summary).toBe("Can't ship P002 (no refrigerated vans); holds 30");

      const w04Role = getWarehouseDecisionRole("W04", d03, seedCatalog.warehouses);
      expect(w04Role.role).toBe("chosen");
      expect(w04Role.summary).toContain("ships 10 P002");

      const w08Role = getWarehouseDecisionRole("W08", d03, seedCatalog.warehouses);
      expect(w08Role.role).toBe("alternative");
      expect(w08Role.summary).toContain("W08");

      const w01Role = getWarehouseDecisionRole("W01", d03, seedCatalog.warehouses);
      expect(w01Role.role).toBe("not-involved");
      expect(w01Role.summary).toBe("Not involved in this decision");
    });

    it("builds a reproducible curl command for POST /api/v1/allocations", () => {
      const cmd = buildAllocationCurl("https://warehouse-allocator-chi.vercel.app/", {
        lines: [{ productId: "P002", quantity: 10 }],
        options: { allowSplit: true },
      });
      expect(cmd).toBe(
        `curl -s -X POST "https://warehouse-allocator-chi.vercel.app/api/v1/allocations" -H "Content-Type: application/json" -d '{"lines":[{"productId":"P002","quantity":10}],"options":{"allowSplit":true}}'`,
      );
    });
  });
});
