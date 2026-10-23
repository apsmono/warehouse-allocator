import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate } from "../../src/engine/index.js";
import type { CatalogSnapshot, Options, OrderLine, Warehouse } from "../../src/engine/types.js";
import { loadSeedSnapshot } from "../helpers/seed-snapshot.js";

type GoldenCase = {
  id: string;
  desc?: string;
  lines: OrderLine[];
  options?: Options;
};

type GoldenFixtureFile = {
  distance: GoldenCase[];
  noSplit: GoldenCase[];
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(currentDir, "../fixtures/golden.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenFixtureFile;

const PRODUCT_IDS = ["P001", "P002", "P003", "P004", "P005"] as const;

const orderLineArb = fc.record({
  productId: fc.constantFrom(...PRODUCT_IDS),
  quantity: fc.integer({ min: 1, max: 600 }),
});

const orderLinesArb = fc.array(orderLineArb, { minLength: 1, maxLength: 5 });

describe("Explanation layer (ALGORITHM.md §3/§4 — R1)", () => {
  const snapshot = loadSeedSnapshot();
  const allGoldenCases: GoldenCase[] = [...golden.distance, ...golden.noSplit];

  it("produces 2 <= reasons.length <= 6 for all 16 golden cases", () => {
    for (const tc of allGoldenCases) {
      const decision = allocate({ lines: tc.lines }, snapshot, tc.options);
      expect(
        decision.reasons.length,
        `${tc.id} reasons (${decision.reasons.length}): ${JSON.stringify(decision.reasons)}`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        decision.reasons.length,
        `${tc.id} reasons (${decision.reasons.length}): ${JSON.stringify(decision.reasons)}`,
      ).toBeLessThanOrEqual(6);
    }
  });

  it("property: 2 <= reasons.length <= 6 for random orders with allowSplit both true and false (200 runs)", () => {
    fc.assert(
      fc.property(orderLinesArb, (lines) => {
        for (const allowSplit of [true, false]) {
          const decision = allocate({ lines }, snapshot, { allowSplit });
          expect(decision.reasons.length).toBeGreaterThanOrEqual(2);
          expect(decision.reasons.length).toBeLessThanOrEqual(6);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("G07-noSplit: shortfall sentence reports P002 eligible total is 108, summary does not say 'across all eligible warehouses', and W07 is not called nearest", () => {
    const g07NoSplit = golden.noSplit.find((c) => c.id === "G07-nosplit")!;
    const decision = allocate({ lines: g07NoSplit.lines }, snapshot, g07NoSplit.options);

    expect(decision.summary).not.toContain("across all eligible warehouses");
    expect(decision.summary).toContain("single-shipment limit");

    const shortfallSentence = decision.reasons.find((r) =>
      r.includes("Total eligible stock of P002 is 108"),
    );
    expect(shortfallSentence).toBeDefined();

    const w07Nearest = decision.reasons.find((r) => r.includes("W07") && r.includes("nearest"));
    expect(w07Nearest).toBeUndefined();
  });

  it("G08-noSplit: shortfall sentence reports P004 eligible total is 85 and summary attributes shortfall to single-shipment limit", () => {
    const g08NoSplit = golden.noSplit.find((c) => c.id === "G08-nosplit")!;
    const decision = allocate({ lines: g08NoSplit.lines }, snapshot, g08NoSplit.options);

    expect(decision.summary).not.toContain("across all eligible warehouses");
    expect(decision.summary).toContain("single-shipment limit");

    const shortfallSentence = decision.reasons.find((r) =>
      r.includes("Total eligible stock of P004 is 85"),
    );
    expect(shortfallSentence).toBeDefined();
  });

  it("G13: no reasons entry calls W05 'nearest'", () => {
    const g13 = golden.distance.find((c) => c.id === "G13")!;
    const decision = allocate({ lines: g13.lines }, snapshot, g13.options);

    const w05Sentences = decision.reasons.filter((r) => r.includes("W05"));
    expect(w05Sentences.length).toBeGreaterThan(0);
    for (const s of w05Sentences) {
      expect(s).not.toContain("nearest");
    }
    expect(decision.reasons).toContain("W05 supplies 400 P001 (90 km).");
  });

  it("G11: exactly one sentence contains 'needs a cold chain', and exclusions merge per warehouse", () => {
    const g11 = golden.distance.find((c) => c.id === "G11")!;
    const decision = allocate({ lines: g11.lines }, snapshot, g11.options);

    const coldChainSentences = decision.reasons.filter((r) => r.includes("needs a cold chain"));
    expect(coldChainSentences).toHaveLength(1);
    expect(coldChainSentences[0]).toContain("P002");
    expect(coldChainSentences[0]).toContain("P004");

    expect(decision.reasons).toContain(
      "W02 holds 30 P002 and 20 P004 but has no refrigerated vans, so it cannot deliver them safely.",
    );
    expect(decision.reasons).toContain(
      "W06 holds 20 P002 and 30 P004 but has no refrigerated vans, so it cannot deliver them safely.",
    );
  });

  it("G03: reasons contain a sentence mentioning both W02 and refrigerated vans", () => {
    const g03 = golden.distance.find((c) => c.id === "G03")!;
    const decision = allocate({ lines: g03.lines }, snapshot, g03.options);
    const matching = decision.reasons.find(
      (r) => r.includes("W02") && r.includes("refrigerated vans"),
    );
    expect(matching).toBeDefined();
  });

  it("keeps reasons within 2–6 sentences on multi-cold-product split and multi-shortfall orders", () => {
    const d1 = allocate(
      {
        lines: [
          { productId: "P002", quantity: 60 },
          { productId: "P004", quantity: 60 },
        ],
      },
      snapshot,
    );
    expect(d1.reasons.length).toBeGreaterThanOrEqual(2);
    expect(d1.reasons.length).toBeLessThanOrEqual(6);

    const d2 = allocate(
      {
        lines: [
          { productId: "P001", quantity: 1500 },
          { productId: "P002", quantity: 200 },
          { productId: "P003", quantity: 1500 },
          { productId: "P004", quantity: 200 },
          { productId: "P005", quantity: 1500 },
        ],
      },
      snapshot,
    );
    expect(d2.reasons.length).toBeGreaterThanOrEqual(2);
    expect(d2.reasons.length).toBeLessThanOrEqual(6);

    const d3 = allocate(
      {
        lines: [
          { productId: "P001", quantity: 100 },
          { productId: "P002", quantity: 200 },
        ],
      },
      snapshot,
      { allowSplit: false },
    );
    expect(d3.summary).toContain("single-shipment limit and available stock");
    expect(d3.reasons.length).toBeGreaterThanOrEqual(2);
    expect(d3.reasons.length).toBeLessThanOrEqual(6);
  });
});

describe("Explanation edge cases (engine 1.0.2)", () => {
  const snapshot = loadSeedSnapshot();

  function plainWarehouse(id: string, distanceKm: number): Warehouse {
    return { id, city: `City${id}`, distanceKm, hasColdStorage: false, hasColdFleet: false };
  }

  function splitVsSingleSnapshot(nearKm: [number, number]): CatalogSnapshot {
    return {
      products: [
        { id: "P001", name: "Gloves", category: "Medical Supplies", requiresColdChain: false },
      ],
      warehouses: [
        plainWarehouse("W01", nearKm[0]),
        plainWarehouse("W02", nearKm[1]),
        plainWarehouse("W03", 40),
      ],
      stock: [
        { warehouseId: "W01", productId: "P001", quantity: 50 },
        { warehouseId: "W02", productId: "P001", quantity: 50 },
        { warehouseId: "W03", productId: "P001", quantity: 100 },
      ],
    };
  }

  it("on an exact cost tie, the split summary says 'same cost', not 'cheaper'", () => {
    // (10 + 20) + (10 + 20) = 60 = 40 + 20: the split wins on the shorter longest trip.
    const decision = allocate(
      { lines: [{ productId: "P001", quantity: 100 }] },
      splitVsSingleSnapshot([10, 10]),
    );

    expect(decision.shipments.map((s) => s.warehouseId)).toEqual(["W01", "W02"]);
    expect(decision.summary).toBe(
      "Split into 2 nearby shipments; same cost as one shipment from W03 (40 km), but the longest trip is shorter.",
    );
    expect(decision.reasons.join(" ")).not.toContain("saves");
  });

  it("rounds decimal-distance costs to 0.1 in totals, deltas and sentences", () => {
    const decision = allocate(
      { lines: [{ productId: "P001", quantity: 100 }] },
      splitVsSingleSnapshot([0.1, 0.2]),
    );

    expect(decision.totalCost).toBe(40.3);
    expect(decision.alternatives[0]).toMatchObject({
      warehouses: ["W03"],
      totalCost: 60,
      delta: 19.7,
    });
    expect(decision.alternatives[0]?.whyNot).toBe("+19.7 km: longer trip");
    expect(decision.reasons).toContain(
      "Each extra shipment adds 20 km to the cost; splitting still saves 19.7 km.",
    );
  });

  it("says no warehouse can keep the cold chain when none has both storage and vans", () => {
    const noColdSnapshot: CatalogSnapshot = {
      products: [
        { id: "P002", name: "Vaccine", category: "Pharmaceutical", requiresColdChain: true },
      ],
      warehouses: [{ ...plainWarehouse("W02", 12), hasColdStorage: true }],
      stock: [{ warehouseId: "W02", productId: "P002", quantity: 30 }],
    };
    const decision = allocate({ lines: [{ productId: "P002", quantity: 1 }] }, noColdSnapshot);

    expect(decision.status).toBe("UNFULFILLABLE");
    expect(decision.reasons[0]).toBe(
      "P002 needs a cold chain; no warehouse has both refrigerated storage and refrigerated vans.",
    );
    expect(decision.summary).toBe(
      "Cannot fulfil order: 0 of 1 requested unit available across eligible warehouses.",
    );
  });

  it("counts extra shipments in whyNot instead of always saying 'one'", () => {
    // P001×651 on seed: chosen W03+W05 (2 shipments); runner-up uses 4.
    const decision = allocate({ lines: [{ productId: "P001", quantity: 651 }] }, snapshot);

    expect(decision.shipments.map((s) => s.warehouseId)).toEqual(["W03", "W05"]);
    expect(decision.alternatives.map((a) => a.whyNot)).toEqual([
      "+12 km: 2 extra shipments",
      "+25 km: one extra shipment",
    ]);
  });

  it("uses the singular for a 1-unit shortfall", () => {
    // P002×109 on seed: eligible total is 108.
    const decision = allocate({ lines: [{ productId: "P002", quantity: 109 }] }, snapshot);

    expect(decision.summary).toBe(
      "Can fill 108 of 109 units; 1 unit of P002 is short across all eligible warehouses.",
    );
    expect(decision.reasons).toContain(
      "Total eligible stock of P002 is 108; 1 unit should be back-ordered.",
    );
  });
});
