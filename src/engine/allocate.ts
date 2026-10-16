import { evaluateEligibility } from "./eligibility.js";
import { StrategyNotAvailableError } from "./errors.js";
import { buildAlternativeWhyNot, buildReasons, buildSummary } from "./explain.js";
import type {
  AllocationStatus,
  Alternative,
  CatalogSnapshot,
  CostUnit,
  Decision,
  Options,
  Order,
  OrderLine,
  Shipment,
  Shortfall,
  TravelModel,
  Warehouse,
} from "./types.js";
import { ENGINE_VERSION } from "./version.js";

const DISTANCE_OVERHEAD = 20;

type EvaluatedSubset = {
  shipments: Shipment[];
  warehousesInFillOrder: string[];
  shortfalls: Shortfall[];
  unitsFilled: number;
  totalCost: number;
  maxTravel: number;
  size: number;
  sortedIdsKey: string;
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Step 0: Normalise order lines by merging duplicate productIds and sorting by productId asc.
 */
export function normaliseOrderLines(lines: readonly OrderLine[]): OrderLine[] {
  const merged = new Map<string, number>();
  for (const line of lines) {
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.quantity);
  }
  return Array.from(merged.entries())
    .sort(([a], [b]) => compareStrings(a, b))
    .map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Generates all non-empty subsets of items in order of increasing size,
 * then lexicographic order of indices (which matches lexicographic warehouse IDs
 * when items are already sorted by ID ascending).
 */
function generateSubsets<T>(items: readonly T[], maxSubsetSize: number): T[][] {
  const result: T[][] = [];
  const n = items.length;
  const limit = Math.min(n, maxSubsetSize);

  function backtrack(targetSize: number, startIdx: number, current: T[]): void {
    if (current.length === targetSize) {
      result.push([...current]);
      return;
    }
    const remainingNeeded = targetSize - current.length;
    for (let i = startIdx; i <= n - remainingNeeded; i++) {
      current.push(items[i]!);
      backtrack(targetSize, i + 1, current);
      current.pop();
    }
  }

  for (let size = 1; size <= limit; size++) {
    backtrack(size, 0, []);
  }

  return result;
}

function compareEvaluatedSubsets(a: EvaluatedSubset, b: EvaluatedSubset): number {
  if (a.unitsFilled !== b.unitsFilled) {
    return b.unitsFilled - a.unitsFilled;
  }
  if (a.totalCost !== b.totalCost) {
    return a.totalCost - b.totalCost;
  }
  if (a.maxTravel !== b.maxTravel) {
    return a.maxTravel - b.maxTravel;
  }
  if (a.size !== b.size) {
    return a.size - b.size;
  }
  return compareStrings(a.sortedIdsKey, b.sortedIdsKey);
}

export function allocate(
  order: Order,
  snapshot: CatalogSnapshot,
  options?: Options,
  _travelModel?: TravelModel,
): Decision {
  const strategy = options?.strategy ?? "distance";
  const allowSplit = options?.allowSplit ?? true;

  if (strategy === "time-aware") {
    throw new StrategyNotAvailableError("time-aware");
  }

  const shipmentOverhead = DISTANCE_OVERHEAD;
  const costUnit: CostUnit = "km";

  // Step 0: Normalise
  const mergedLines = normaliseOrderLines(order.lines);

  // Step 1: Eligibility
  const eligibility = evaluateEligibility(mergedLines, snapshot);
  const { candidateWarehouses, excluded, getEligibleStock, getTotalEligibleStock } = eligibility;

  // Step 2: Travel cost per warehouse (distance strategy in M1)
  const getTravelCost = (w: Warehouse): number => w.distanceKm;

  // Step 3: Enumerate and allocate
  const maxSubsetSize = allowSplit ? candidateWarehouses.length : 1;
  const subsets = generateSubsets(candidateWarehouses, maxSubsetSize);

  const survivors: EvaluatedSubset[] = [];

  for (const subset of subsets) {
    // 1. Order warehouses in S by (travel(w) asc, id asc) -> fill order
    const fillOrder = [...subset].sort((a, b) => {
      const travelDiff = getTravelCost(a) - getTravelCost(b);
      if (travelDiff !== 0) {
        return travelDiff;
      }
      return compareStrings(a.id, b.id);
    });

    const itemsByWarehouse = new Map<string, { productId: string; quantity: number }[]>();
    for (const w of fillOrder) {
      itemsByWarehouse.set(w.id, []);
    }

    const shortfalls: Shortfall[] = [];
    let unitsFilled = 0;

    // 2. For each merged line, in productId order, take min(remaining, stock(w, p)) in fill order
    for (const line of mergedLines) {
      let remaining = line.quantity;

      for (const w of fillOrder) {
        if (remaining <= 0) {
          break;
        }
        const avail = getEligibleStock(w.id, line.productId);
        if (avail <= 0) {
          continue;
        }
        const take = Math.min(remaining, avail);
        if (take > 0) {
          itemsByWarehouse.get(w.id)!.push({
            productId: line.productId,
            quantity: take,
          });
          remaining -= take;
          unitsFilled += take;
        }
      }

      if (remaining > 0) {
        const allocated = line.quantity - remaining;
        const totalEligible = getTotalEligibleStock(line.productId);
        shortfalls.push({
          productId: line.productId,
          requested: line.quantity,
          allocated,
          missing: remaining,
          reason:
            totalEligible === 0
              ? `No eligible warehouse holds stock of ${line.productId}.`
              : `Eligible stock across selected warehouses (${allocated}) is less than requested (${line.quantity}).`,
        });
      }
    }

    // 3. Discard S if any warehouse in it received zero units
    let hasZeroUnitWarehouse = false;
    for (const w of fillOrder) {
      if ((itemsByWarehouse.get(w.id)?.length ?? 0) === 0) {
        hasZeroUnitWarehouse = true;
        break;
      }
    }
    if (hasZeroUnitWarehouse) {
      continue;
    }

    // 4. Score
    let totalCost = 0;
    let maxTravel = 0;
    const shipments: Shipment[] = [];

    for (const w of fillOrder) {
      const travel = getTravelCost(w);
      totalCost += shipmentOverhead + travel;
      if (travel > maxTravel) {
        maxTravel = travel;
      }
      shipments.push({
        warehouseId: w.id,
        city: w.city,
        distanceKm: w.distanceKm,
        items: itemsByWarehouse.get(w.id)!,
      });
    }

    const sortedIdsKey = subset
      .map((w) => w.id)
      .sort(compareStrings)
      .join(",");

    survivors.push({
      shipments,
      warehousesInFillOrder: fillOrder.map((w) => w.id),
      shortfalls,
      unitsFilled,
      totalCost,
      maxTravel,
      size: subset.length,
      sortedIdsKey,
    });
  }

  // Step 4: Rank (lexicographic, all ascending)
  survivors.sort(compareEvaluatedSubsets);

  const evaluatedCombinations = survivors.length;
  const chosen = survivors[0];

  // Step 5: Status
  let status: AllocationStatus;
  let shipments: Shipment[];
  let shortfalls: Shortfall[];
  let totalCost: number;
  let alternatives: Alternative[];

  if (!chosen || candidateWarehouses.length === 0) {
    status = "UNFULFILLABLE";
    shipments = [];
    totalCost = 0;
    alternatives = [];
    shortfalls = mergedLines.map((line) => ({
      productId: line.productId,
      requested: line.quantity,
      allocated: 0,
      missing: line.quantity,
      reason: `No eligible warehouse holds stock of ${line.productId}.`,
    }));
  } else {
    status = chosen.shortfalls.length === 0 ? "FULL" : "PARTIAL";
    shipments = chosen.shipments;
    shortfalls = chosen.shortfalls;
    totalCost = chosen.totalCost;

    alternatives = survivors.slice(1, 3).map((alt) => {
      const { delta, whyNot } = buildAlternativeWhyNot(
        chosen.unitsFilled,
        chosen.totalCost,
        chosen.shipments.length,
        alt.unitsFilled,
        alt.totalCost,
        alt.warehousesInFillOrder.length,
        costUnit,
      );
      return {
        warehouses: alt.warehousesInFillOrder,
        unitsFilled: alt.unitsFilled,
        totalCost: alt.totalCost,
        delta,
        whyNot,
      };
    });
  }

  const allSurvivorsSummary = survivors.map((s) => ({
    warehouses: s.warehousesInFillOrder,
    unitsFilled: s.unitsFilled,
    totalCost: s.totalCost,
  }));

  const explainInput = {
    status,
    strategy,
    dispatchAt: options?.dispatchAt,
    mergedLines,
    snapshot,
    shipments,
    shortfalls,
    excluded,
    totalCost,
    costUnit,
    shipmentOverhead,
    allSurvivors: allSurvivorsSummary,
  };

  const summary = buildSummary(explainInput);
  const reasons = buildReasons(explainInput);

  return {
    status,
    strategy,
    ...(options?.dispatchAt ? { dispatchAt: options.dispatchAt } : {}),
    shipments,
    shortfalls,
    totalCost,
    costUnit,
    summary,
    reasons,
    excluded: excluded.map(({ warehouseId, productId, code, detail }) => ({
      warehouseId,
      productId,
      code,
      detail,
    })),
    alternatives,
    meta: {
      engineVersion: ENGINE_VERSION,
      shipmentOverhead,
      evaluatedCombinations,
    },
  };
}
