import { describe, expect, it } from "vitest";
import {
  ENGINE_VERSION,
  StrategyNotAvailableError,
  allocate,
  evaluateEligibility,
  normaliseOrderLines,
} from "../../src/engine/index.js";
import type { CatalogSnapshot } from "../../src/engine/types.js";
import { loadSeedSnapshot } from "../helpers/seed-snapshot.js";

describe("Eligibility rules (ALGORITHM.md §2 Step 1)", () => {
  const snapshot = loadSeedSnapshot();

  it("flags W02 and W06 with NO_COLD_FLEET for P002 and P004", () => {
    const lines = normaliseOrderLines([
      { productId: "P004", quantity: 10 },
      { productId: "P002", quantity: 10 },
    ]);
    const result = evaluateEligibility(lines, snapshot);

    expect(
      result.excluded.map((e) => ({
        warehouseId: e.warehouseId,
        productId: e.productId,
        code: e.code,
      })),
    ).toEqual([
      { warehouseId: "W02", productId: "P002", code: "NO_COLD_FLEET" },
      { warehouseId: "W06", productId: "P002", code: "NO_COLD_FLEET" },
      { warehouseId: "W02", productId: "P004", code: "NO_COLD_FLEET" },
      { warehouseId: "W06", productId: "P004", code: "NO_COLD_FLEET" },
    ]);
  });

  it("does not list W05 as excluded for P002 because W05 holds zero P002 stock", () => {
    const result = evaluateEligibility([{ productId: "P002", quantity: 10 }], snapshot);
    const w05Excluded = result.excluded.find((e) => e.warehouseId === "W05");
    expect(w05Excluded).toBeUndefined();
  });

  it("flags NO_COLD_STORAGE when a warehouse holds cold product stock without cold storage", () => {
    const customSnapshot: CatalogSnapshot = {
      products: [
        {
          id: "P002",
          name: "Vaccine — Hepatitis B",
          category: "Pharmaceutical",
          requiresColdChain: true,
        },
      ],
      warehouses: [
        {
          id: "W01",
          city: "Surabaya",
          distanceKm: 5,
          hasColdStorage: false,
          hasColdFleet: false,
        },
        {
          id: "W04",
          city: "Gresik",
          distanceKm: 30,
          hasColdStorage: true,
          hasColdFleet: true,
        },
      ],
      stock: [
        { warehouseId: "W01", productId: "P002", quantity: 15 },
        { warehouseId: "W04", productId: "P002", quantity: 20 },
      ],
    };

    const decision = allocate({ lines: [{ productId: "P002", quantity: 10 }] }, customSnapshot);

    expect(decision.excluded).toEqual([
      {
        warehouseId: "W01",
        productId: "P002",
        code: "NO_COLD_STORAGE",
        detail:
          "W01 holds 15 P002 but has no refrigerated storage, so it cannot deliver it safely.",
      },
    ]);
    expect(decision.reasons).toContain(
      "W01 holds 15 P002 but has no refrigerated storage, so it cannot deliver it safely.",
    );
  });
});

describe("Allocation engine edge cases", () => {
  const snapshot = loadSeedSnapshot();

  it("returns UNFULFILLABLE when catalogue has no eligible stock", () => {
    const emptySnapshot: CatalogSnapshot = {
      products: snapshot.products,
      warehouses: snapshot.warehouses,
      stock: [],
    };

    const decision = allocate({ lines: [{ productId: "P001", quantity: 50 }] }, emptySnapshot);

    expect(decision.status).toBe("UNFULFILLABLE");
    expect(decision.shipments).toEqual([]);
    expect(decision.totalCost).toBe(0);
    expect(decision.alternatives).toEqual([]);
    expect(decision.meta.evaluatedCombinations).toBe(0);
    expect(decision.meta.engineVersion).toBe(ENGINE_VERSION);
    expect(decision.shortfalls).toEqual([
      {
        productId: "P001",
        requested: 50,
        allocated: 0,
        missing: 50,
        reason: "No eligible warehouse holds stock of P001.",
      },
    ]);
    expect(decision.summary).toContain("Cannot fulfil order");
  });

  it("throws StrategyNotAvailableError when strategy is time-aware in M1", () => {
    expect(() =>
      allocate({ lines: [{ productId: "P001", quantity: 100 }] }, snapshot, {
        strategy: "time-aware",
        dispatchAt: { day: "Mon", time: "08:00" },
      }),
    ).toThrowError(StrategyNotAvailableError);

    try {
      allocate({ lines: [{ productId: "P001", quantity: 100 }] }, snapshot, {
        strategy: "time-aware",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(StrategyNotAvailableError);
      expect((err as StrategyNotAvailableError).code).toBe("STRATEGY_NOT_AVAILABLE");
    }
  });

  it("merges duplicate product lines and sorts by productId ascending", () => {
    const merged = normaliseOrderLines([
      { productId: "P005", quantity: 25 },
      { productId: "P001", quantity: 40 },
      { productId: "P005", quantity: 75 },
      { productId: "P001", quantity: 60 },
    ]);

    expect(merged).toEqual([
      { productId: "P001", quantity: 100 },
      { productId: "P005", quantity: 100 },
    ]);

    const dMerged = allocate({ lines: merged }, snapshot);
    const dUnmerged = allocate(
      {
        lines: [
          { productId: "P005", quantity: 25 },
          { productId: "P001", quantity: 40 },
          { productId: "P005", quantity: 75 },
          { productId: "P001", quantity: 60 },
        ],
      },
      snapshot,
    );

    expect(dUnmerged).toEqual(dMerged);
  });

  it("applies deterministic tie-breaks on maxTravel, shipment count, and warehouse IDs", () => {
    const tieSnapshot: CatalogSnapshot = {
      products: [
        {
          id: "P001",
          name: "Gloves",
          category: "Medical Supplies",
          requiresColdChain: false,
        },
      ],
      warehouses: [
        {
          id: "W02",
          city: "CityB",
          distanceKm: 10,
          hasColdStorage: false,
          hasColdFleet: false,
        },
        {
          id: "W01",
          city: "CityA",
          distanceKm: 10,
          hasColdStorage: false,
          hasColdFleet: false,
        },
      ],
      stock: [
        { warehouseId: "W02", productId: "P001", quantity: 50 },
        { warehouseId: "W01", productId: "P001", quantity: 50 },
      ],
    };

    const decision = allocate({ lines: [{ productId: "P001", quantity: 50 }] }, tieSnapshot);
    expect(decision.shipments[0]?.warehouseId).toBe("W01");
    expect(decision.alternatives[0]?.warehouses).toEqual(["W02"]);
  });
});
