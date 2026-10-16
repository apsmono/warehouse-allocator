import type { ExclusionWithQuantity } from "./eligibility.js";
import type {
  AllocationStatus,
  CatalogSnapshot,
  CostUnit,
  DispatchAt,
  OrderLine,
  Shipment,
  Shortfall,
  Strategy,
} from "./types.js";

export type ScoredCandidateSummary = {
  warehouses: string[];
  unitsFilled: number;
  totalCost: number;
};

export type ExplainInput = {
  status: AllocationStatus;
  strategy: Strategy;
  dispatchAt?: DispatchAt;
  mergedLines: readonly OrderLine[];
  snapshot: CatalogSnapshot;
  shipments: readonly Shipment[];
  shortfalls: readonly Shortfall[];
  excluded: readonly ExclusionWithQuantity[];
  totalCost: number;
  costUnit: CostUnit;
  shipmentOverhead: number;
  allSurvivors: readonly ScoredCandidateSummary[];
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function formatWarehouseList(ids: readonly string[]): string {
  if (ids.length === 0) {
    return "none";
  }
  if (ids.length === 1) {
    return ids[0] ?? "";
  }
  if (ids.length === 2) {
    return `${ids[0]} and ${ids[1]}`;
  }
  const head = ids.slice(0, -1).join(", ");
  const tail = ids[ids.length - 1];
  return `${head} and ${tail}`;
}

export function buildSummary(input: ExplainInput): string {
  const { status, mergedLines, snapshot, shipments, shortfalls, allSurvivors } = input;
  const totalRequested = mergedLines.reduce((sum, l) => sum + l.quantity, 0);
  const totalFilled = shipments.reduce(
    (sum, s) => sum + s.items.reduce((iSum, item) => iSum + item.quantity, 0),
    0,
  );

  if (status === "UNFULFILLABLE") {
    return `Cannot fulfil order: 0 of ${totalRequested} requested units available across eligible warehouses.`;
  }

  if (status === "PARTIAL") {
    const shortfallParts = shortfalls
      .map((sf) => `${sf.missing} units of ${sf.productId}`)
      .join(", ");
    const verb = shortfalls.length === 1 ? "are" : "are";
    return `Can fill ${totalFilled} of ${totalRequested} units; ${shortfallParts} ${verb} short across all eligible warehouses.`;
  }

  if (shipments.length === 1) {
    const only = shipments[0]!;
    return `Ship everything from ${only.warehouseId} (${only.city}, ${only.distanceKm} km).`;
  }

  const singleFullOption = allSurvivors.find(
    (cand) => cand.warehouses.length === 1 && cand.unitsFilled === totalRequested,
  );

  if (singleFullOption) {
    const singleId = singleFullOption.warehouses[0]!;
    const warehouseObj = snapshot.warehouses.find((w) => w.id === singleId);
    const km = warehouseObj?.distanceKm ?? 0;
    return `Split into ${shipments.length} nearby shipments; cheaper than one shipment from ${singleId} (${km} km).`;
  }

  const warehouseIds = shipments.map((s) => s.warehouseId);
  return `Split into ${shipments.length} shipments: ${formatWarehouseList(warehouseIds)}, because no single eligible warehouse holds the full order.`;
}

export function buildReasons(input: ExplainInput): string[] {
  const {
    strategy,
    dispatchAt,
    mergedLines,
    snapshot,
    shipments,
    shortfalls,
    excluded,
    totalCost,
    costUnit,
    shipmentOverhead,
    allSurvivors,
  } = input;

  const reasons: string[] = [];
  const productById = new Map(snapshot.products.map((p) => [p.id, p]));
  const totalRequested = mergedLines.reduce((sum, l) => sum + l.quantity, 0);

  const coldCapableIds = [...snapshot.warehouses]
    .filter((w) => w.hasColdStorage && w.hasColdFleet)
    .sort((a, b) => compareStrings(a.id, b.id))
    .map((w) => w.id);

  for (const line of mergedLines) {
    const product = productById.get(line.productId);
    if (product?.requiresColdChain) {
      reasons.push(
        `${product.id} needs a cold chain; only ${coldCapableIds.join(", ")} have both refrigerated storage and refrigerated vans.`,
      );
    }
  }

  for (const ex of excluded) {
    if (ex.code === "NO_COLD_FLEET") {
      reasons.push(
        `${ex.warehouseId} holds ${ex.quantity} ${ex.productId} but has no refrigerated vans, so it cannot deliver it safely.`,
      );
    } else {
      reasons.push(
        `${ex.warehouseId} holds ${ex.quantity} ${ex.productId} but has no refrigerated storage, so it cannot deliver it safely.`,
      );
    }
  }

  for (const shipment of shipments) {
    const itemsDesc = shipment.items.map((item) => `${item.quantity} ${item.productId}`).join(", ");
    reasons.push(`${shipment.warehouseId} is the nearest warehouse that can supply ${itemsDesc}.`);
  }

  if (shipments.length > 1) {
    const singleFullOption = allSurvivors.find(
      (cand) => cand.warehouses.length === 1 && cand.unitsFilled === totalRequested,
    );
    if (singleFullOption && singleFullOption.totalCost > totalCost) {
      const saved = singleFullOption.totalCost - totalCost;
      reasons.push(
        `Each extra shipment costs a fixed ${shipmentOverhead} ${costUnit} (dispatch + receiving); the split still saves ${saved} ${costUnit}.`,
      );
    } else {
      reasons.push(
        `Each extra shipment costs a fixed ${shipmentOverhead} ${costUnit} (dispatch + receiving) to cover the order across ${shipments.length} warehouses.`,
      );
    }
  }

  for (const sf of shortfalls) {
    reasons.push(
      `Total eligible stock of ${sf.productId} is ${sf.allocated}; ${sf.missing} units should be back-ordered.`,
    );
  }

  if (strategy === "time-aware" && dispatchAt) {
    for (const shipment of shipments) {
      if (shipment.travel) {
        reasons.push(
          `At ${dispatchAt.day} ${dispatchAt.time}, ${shipment.warehouseId} is predicted at ${shipment.travel.minutes} min (${shipment.travel.source}, n=${shipment.travel.sampleSize}).`,
        );
      }
    }
  }

  return reasons;
}

export function buildAlternativeWhyNot(
  chosenUnitsFilled: number,
  chosenTotalCost: number,
  chosenShipmentCount: number,
  altUnitsFilled: number,
  altTotalCost: number,
  altWarehouseCount: number,
  costUnit: CostUnit,
): { delta: number; whyNot: string } {
  const delta = altTotalCost - chosenTotalCost;
  const deltaPrefix = `${delta >= 0 ? `+${delta}` : `${delta}`} ${costUnit}`;

  if (altUnitsFilled < chosenUnitsFilled) {
    const fewer = chosenUnitsFilled - altUnitsFilled;
    return {
      delta,
      whyNot: `${deltaPrefix}: fills ${fewer} fewer units`,
    };
  }

  if (altWarehouseCount > chosenShipmentCount) {
    return {
      delta,
      whyNot: `${deltaPrefix}: one extra shipment`,
    };
  }

  return {
    delta,
    whyNot: `${deltaPrefix}: longer trip`,
  };
}
