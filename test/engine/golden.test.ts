import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allocate } from "../../src/engine/index.js";
import type { Decision, Options, OrderLine } from "../../src/engine/types.js";
import { loadSeedSnapshot } from "../helpers/seed-snapshot.js";

type GoldenExpected = {
  status: "FULL" | "PARTIAL" | "UNFULFILLABLE";
  shipments: {
    warehouseId: string;
    items: Record<string, number>;
  }[];
  shortfalls: Record<string, number>;
  totalCost: number;
  evaluatedCombinations: number;
  alternatives: {
    warehouses: string[];
    unitsFilled: number;
    totalCost: number;
  }[];
};

type GoldenCase = {
  id: string;
  desc?: string;
  lines: OrderLine[];
  options?: Options;
  expected: GoldenExpected;
};

type GoldenFixtureFile = {
  distance: GoldenCase[];
  noSplit: GoldenCase[];
  timeAware: GoldenCase[];
  travelModel: unknown;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(currentDir, "../fixtures/golden.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenFixtureFile;

function toGoldenComparable(decision: Decision): GoldenExpected {
  return {
    status: decision.status,
    shipments: decision.shipments.map((s) => ({
      warehouseId: s.warehouseId,
      items: Object.fromEntries(s.items.map((item) => [item.productId, item.quantity])),
    })),
    shortfalls: Object.fromEntries(decision.shortfalls.map((sf) => [sf.productId, sf.missing])),
    totalCost: decision.totalCost,
    evaluatedCombinations: decision.meta.evaluatedCombinations,
    alternatives: decision.alternatives.map((alt) => ({
      warehouses: alt.warehouses,
      unitsFilled: alt.unitsFilled,
      totalCost: alt.totalCost,
    })),
  };
}

describe("Golden scenarios — distance strategy (G01–G13)", () => {
  const snapshot = loadSeedSnapshot();

  for (const tc of golden.distance) {
    it(`${tc.id}: ${tc.desc ?? ""}`, () => {
      const decision = allocate({ lines: tc.lines }, snapshot, tc.options);
      expect(toGoldenComparable(decision)).toEqual(tc.expected);
    });
  }

  it("G03 reasons contain a sentence mentioning both W02 and refrigerated vans", () => {
    const g03 = golden.distance.find((c) => c.id === "G03")!;
    const decision = allocate({ lines: g03.lines }, snapshot, g03.options);
    const matchingSentence = decision.reasons.find(
      (r) => r.includes("W02") && r.includes("refrigerated vans"),
    );
    expect(matchingSentence).toBeDefined();
  });

  it("G05 excluded lists W02 and W06 with NO_COLD_FLEET", () => {
    const g05 = golden.distance.find((c) => c.id === "G05")!;
    const decision = allocate({ lines: g05.lines }, snapshot, g05.options);
    expect(
      decision.excluded.map((e) => ({
        warehouseId: e.warehouseId,
        productId: e.productId,
        code: e.code,
      })),
    ).toEqual([
      { warehouseId: "W02", productId: "P002", code: "NO_COLD_FLEET" },
      { warehouseId: "W06", productId: "P002", code: "NO_COLD_FLEET" },
    ]);
  });
});

describe("Golden scenarios — noSplit (allowSplit: false)", () => {
  const snapshot = loadSeedSnapshot();

  for (const tc of golden.noSplit) {
    it(`${tc.id}`, () => {
      const decision = allocate({ lines: tc.lines }, snapshot, tc.options);
      expect(toGoldenComparable(decision)).toEqual(tc.expected);
    });
  }
});

// Deferred to M4 (bonus: time-aware strategy & travel model)
describe.skip("Golden scenarios — timeAware (M4)", () => {
  it("runs time-aware cases in M4", () => {
    expect(golden.timeAware.length).toBeGreaterThan(0);
  });
});

// Deferred to M4 (bonus: time-aware strategy & travel model)
describe.skip("Golden scenarios — travelModel (M4)", () => {
  it("verifies travelModel baselines, multipliers and predictions in M4", () => {
    expect(golden.travelModel).toBeDefined();
  });
});
