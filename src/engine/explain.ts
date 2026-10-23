import type { ExclusionWithQuantity } from "./eligibility.js";
import { formatUnits, roundCost } from "./numbers.js";
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
  allowSplit: boolean;
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
  getTotalEligibleStock: (productId: string) => number;
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

function joinSentencesIntoOne(sentences: readonly string[]): string {
  return `${sentences.map((s) => s.replace(/\.$/, "")).join("; ")}.`;
}

export function buildSummary(input: ExplainInput): string {
  const {
    status,
    allowSplit,
    mergedLines,
    snapshot,
    shipments,
    shortfalls,
    totalCost,
    allSurvivors,
    getTotalEligibleStock,
  } = input;
  const totalRequested = mergedLines.reduce((sum, l) => sum + l.quantity, 0);
  const totalFilled = shipments.reduce(
    (sum, s) => sum + s.items.reduce((iSum, item) => iSum + item.quantity, 0),
    0,
  );

  if (status === "UNFULFILLABLE") {
    return `Cannot fulfil order: 0 of ${totalRequested} requested ${totalRequested === 1 ? "unit" : "units"} available across eligible warehouses.`;
  }

  if (status === "PARTIAL") {
    const shortfallParts = shortfalls
      .map((sf) => `${formatUnits(sf.missing)} of ${sf.productId}`)
      .join(", ");
    const shortVerb = shortfalls.length === 1 && shortfalls[0]!.missing === 1 ? "is" : "are";
    const filledPart = `Can fill ${totalFilled} of ${formatUnits(totalRequested)}`;
    if (!allowSplit) {
      const allCoveredAcrossNetwork = shortfalls.every(
        (sf) => getTotalEligibleStock(sf.productId) >= sf.requested,
      );
      if (allCoveredAcrossNetwork) {
        return `${filledPart} from a single warehouse; ${shortfallParts} ${shortVerb} short due to the single-shipment limit.`;
      }
      const anyCappedBySingleShipment = shortfalls.some(
        (sf) => sf.allocated < getTotalEligibleStock(sf.productId),
      );
      if (anyCappedBySingleShipment) {
        return `${filledPart} from a single warehouse; ${shortfallParts} ${shortVerb} short under the single-shipment limit and available stock.`;
      }
    }
    return `${filledPart}; ${shortfallParts} ${shortVerb} short across all eligible warehouses.`;
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
    if (singleFullOption.totalCost > totalCost) {
      return `Split into ${shipments.length} nearby shipments; cheaper than one shipment from ${singleId} (${km} km).`;
    }
    // Equal cost: the split won the maxTravel tie-break (ALGORITHM.md Step 4).
    return `Split into ${shipments.length} nearby shipments; same cost as one shipment from ${singleId} (${km} km), but the longest trip is shorter.`;
  }

  const warehouseIds = shipments.map((s) => s.warehouseId);
  return `Split into ${shipments.length} shipments: ${formatWarehouseList(warehouseIds)}, because no single eligible warehouse holds the full order.`;
}

export function buildReasons(input: ExplainInput): string[] {
  const {
    strategy,
    allowSplit,
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
    getTotalEligibleStock,
  } = input;

  const productById = new Map(snapshot.products.map((p) => [p.id, p]));
  const totalRequested = mergedLines.reduce((sum, l) => sum + l.quantity, 0);

  const eligibleStockByKey = new Map<string, number>();
  for (const row of snapshot.stock) {
    if (row.quantity <= 0) {
      continue;
    }
    const product = productById.get(row.productId);
    const warehouse = snapshot.warehouses.find((w) => w.id === row.warehouseId);
    if (!product || !warehouse) {
      continue;
    }
    if (!product.requiresColdChain || (warehouse.hasColdStorage && warehouse.hasColdFleet)) {
      const key = `${row.warehouseId}:${row.productId}`;
      eligibleStockByKey.set(key, (eligibleStockByKey.get(key) ?? 0) + row.quantity);
    }
  }

  // 1. Cold chain (at most one sentence naming all ordered cold products)
  const coldCapableIds = [...snapshot.warehouses]
    .filter((w) => w.hasColdStorage && w.hasColdFleet)
    .sort((a, b) => compareStrings(a.id, b.id))
    .map((w) => w.id);

  const coldProductIds = mergedLines
    .map((line) => line.productId)
    .filter((productId) => productById.get(productId)?.requiresColdChain === true);

  const coldCapableText =
    coldCapableIds.length === 0
      ? "no warehouse has both refrigerated storage and refrigerated vans"
      : coldCapableIds.length === 1
        ? `only ${coldCapableIds[0]} has both refrigerated storage and refrigerated vans`
        : `only ${coldCapableIds.join(", ")} have both refrigerated storage and refrigerated vans`;

  const coldChainSentences: string[] = [];
  if (coldProductIds.length === 1) {
    coldChainSentences.push(`${coldProductIds[0]} needs a cold chain; ${coldCapableText}.`);
  } else if (coldProductIds.length > 1) {
    coldChainSentences.push(
      `Each of ${formatWarehouseList(coldProductIds)} needs a cold chain; ${coldCapableText}.`,
    );
  }

  // 2. Exclusion callouts (grouped into one sentence per warehouse)
  const excludedByWarehouse = new Map<string, ExclusionWithQuantity[]>();
  for (const ex of excluded) {
    const list = excludedByWarehouse.get(ex.warehouseId) ?? [];
    list.push(ex);
    excludedByWarehouse.set(ex.warehouseId, list);
  }

  let exclusionSentences: string[] = [];
  for (const [warehouseId, entries] of excludedByWarehouse.entries()) {
    const itemsText = formatWarehouseList(entries.map((e) => `${e.quantity} ${e.productId}`));
    const firstCode = entries[0]!.code;
    const limitation =
      firstCode === "NO_COLD_FLEET" ? "has no refrigerated vans" : "has no refrigerated storage";
    const pronoun = entries.length === 1 ? "it" : "them";
    exclusionSentences.push(
      `${warehouseId} holds ${itemsText} but ${limitation}, so it cannot deliver ${pronoun} safely.`,
    );
  }

  // 3. Choice sentences (only call a warehouse "nearest" when truly nearest for the items it supplies)
  const seenProductsInEarlierShipments = new Set<string>();
  let shipmentSentences: string[] = [];

  for (const shipment of shipments) {
    const itemsDesc = shipment.items.map((item) => `${item.quantity} ${item.productId}`).join(", ");
    const isFirstForAllItems = shipment.items.every(
      (item) => !seenProductsInEarlierShipments.has(item.productId),
    );
    const hasNearerWarehouseForAnyItem = shipment.items.some((item) =>
      snapshot.warehouses.some((w) => {
        const isStrictlyNearer =
          w.distanceKm < shipment.distanceKm ||
          (w.distanceKm === shipment.distanceKm && compareStrings(w.id, shipment.warehouseId) < 0);
        if (!isStrictlyNearer) {
          return false;
        }
        const avail = eligibleStockByKey.get(`${w.id}:${item.productId}`) ?? 0;
        return avail >= item.quantity;
      }),
    );

    for (const item of shipment.items) {
      seenProductsInEarlierShipments.add(item.productId);
    }

    if (isFirstForAllItems && !hasNearerWarehouseForAnyItem) {
      shipmentSentences.push(
        `${shipment.warehouseId} is the nearest warehouse that can supply ${itemsDesc}.`,
      );
    } else {
      shipmentSentences.push(
        `${shipment.warehouseId} supplies ${itemsDesc} (${shipment.distanceKm} km).`,
      );
    }
  }

  // 4. Split trade-off or single-shipment comparison sentence
  const tradeoffSentences: string[] = [];
  if (shipments.length > 1) {
    const singleFullOption = allSurvivors.find(
      (cand) => cand.warehouses.length === 1 && cand.unitsFilled === totalRequested,
    );
    if (singleFullOption && singleFullOption.totalCost > totalCost) {
      const saved = roundCost(singleFullOption.totalCost - totalCost);
      tradeoffSentences.push(
        `Each extra shipment adds ${shipmentOverhead} ${costUnit} to the cost; splitting still saves ${saved} ${costUnit}.`,
      );
    } else {
      tradeoffSentences.push(
        `Each extra shipment adds ${shipmentOverhead} ${costUnit} to the cost; this order uses ${shipments.length} shipments.`,
      );
    }
  } else if (shipments.length === 1) {
    const only = shipments[0]!;
    const chosenUnitsFilled =
      allSurvivors[0]?.unitsFilled ?? only.items.reduce((sum, item) => sum + item.quantity, 0);
    const runnerUp = allSurvivors[1];

    if (runnerUp) {
      const runnerUpLabel = formatWarehouseList(runnerUp.warehouses);
      if (runnerUp.unitsFilled < chosenUnitsFilled) {
        const moreUnits = chosenUnitsFilled - runnerUp.unitsFilled;
        tradeoffSentences.push(
          `Single shipment from ${only.warehouseId} fills ${formatUnits(chosenUnitsFilled)} (${totalCost} ${costUnit}), which is ${moreUnits} more than runner-up ${runnerUpLabel} (${formatUnits(runnerUp.unitsFilled)} at ${runnerUp.totalCost} ${costUnit}).`,
        );
      } else if (runnerUp.totalCost > totalCost) {
        const saved = roundCost(runnerUp.totalCost - totalCost);
        tradeoffSentences.push(
          `Single shipment from ${only.warehouseId} costs ${totalCost} ${costUnit} (${only.distanceKm} ${costUnit} distance + ${shipmentOverhead} ${costUnit} for the shipment), saving ${saved} ${costUnit} over ${runnerUpLabel} (${runnerUp.totalCost} ${costUnit}).`,
        );
      } else {
        tradeoffSentences.push(
          `Single shipment from ${only.warehouseId} costs ${totalCost} ${costUnit} (${only.distanceKm} ${costUnit} distance + ${shipmentOverhead} ${costUnit} for the shipment), selected ahead of ${runnerUpLabel} (${runnerUp.totalCost} ${costUnit}) by tie-break.`,
        );
      }
    } else {
      tradeoffSentences.push(
        `Single shipment from ${only.warehouseId} totals ${totalCost} ${costUnit} (${only.distanceKm} ${costUnit} distance + ${shipmentOverhead} ${costUnit} for the shipment); no other eligible warehouse can supply this order.`,
      );
    }
  } else {
    tradeoffSentences.push("No candidate warehouse holds eligible stock for the requested items.");
  }

  // 5. Shortfall sentences (using real total eligible stock)
  let shortfallSentences: string[] = [];
  for (const sf of shortfalls) {
    const totalEligible = getTotalEligibleStock(sf.productId);
    if (!allowSplit && sf.allocated < totalEligible) {
      shortfallSentences.push(
        `Total eligible stock of ${sf.productId} is ${totalEligible}, but single-shipment mode caps fill at ${sf.allocated}; ${formatUnits(sf.missing)} should be back-ordered.`,
      );
    } else {
      shortfallSentences.push(
        `Total eligible stock of ${sf.productId} is ${totalEligible}; ${formatUnits(sf.missing)} should be back-ordered.`,
      );
    }
  }

  // 6. Time-aware sentences (M4)
  let timeAwareSentences: string[] = [];
  if (strategy === "time-aware" && dispatchAt) {
    for (const shipment of shipments) {
      if (shipment.travel) {
        timeAwareSentences.push(
          `At ${dispatchAt.day} ${dispatchAt.time}, ${shipment.warehouseId} is predicted at ${shipment.travel.minutes} min (${shipment.travel.source}, n=${shipment.travel.sampleSize}).`,
        );
      }
    }
  }

  const totalCount = (): number =>
    coldChainSentences.length +
    exclusionSentences.length +
    shipmentSentences.length +
    tradeoffSentences.length +
    shortfallSentences.length +
    timeAwareSentences.length;

  // Consolidate multi-item categories deterministically when total exceeds 6 sentences
  if (totalCount() > 6 && shipmentSentences.length > 2) {
    const keepFirstTwo = [shipmentSentences[0]!, joinSentencesIntoOne(shipmentSentences.slice(1))];
    if (totalCount() - shipmentSentences.length + keepFirstTwo.length <= 6) {
      shipmentSentences = keepFirstTwo;
    } else {
      shipmentSentences = [joinSentencesIntoOne(shipmentSentences)];
    }
  }
  if (totalCount() > 6 && shipmentSentences.length > 1) {
    shipmentSentences = [joinSentencesIntoOne(shipmentSentences)];
  }
  if (totalCount() > 6 && shortfallSentences.length > 1) {
    shortfallSentences = [joinSentencesIntoOne(shortfallSentences)];
  }
  if (totalCount() > 6 && exclusionSentences.length > 1) {
    exclusionSentences = [joinSentencesIntoOne(exclusionSentences)];
  }
  if (totalCount() > 6 && timeAwareSentences.length > 1) {
    timeAwareSentences = [joinSentencesIntoOne(timeAwareSentences)];
  }

  return [
    ...coldChainSentences,
    ...exclusionSentences,
    ...shipmentSentences,
    ...tradeoffSentences,
    ...shortfallSentences,
    ...timeAwareSentences,
  ];
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
  const delta = roundCost(altTotalCost - chosenTotalCost);
  const deltaPrefix = `${delta >= 0 ? `+${delta}` : `${delta}`} ${costUnit}`;

  if (altUnitsFilled < chosenUnitsFilled) {
    const fewer = chosenUnitsFilled - altUnitsFilled;
    return {
      delta,
      whyNot: `${deltaPrefix}: fills ${fewer} fewer ${fewer === 1 ? "unit" : "units"}`,
    };
  }

  if (altWarehouseCount > chosenShipmentCount) {
    const extra = altWarehouseCount - chosenShipmentCount;
    return {
      delta,
      whyNot: `${deltaPrefix}: ${extra === 1 ? "one extra shipment" : `${extra} extra shipments`}`,
    };
  }

  return {
    delta,
    whyNot: `${deltaPrefix}: longer trip`,
  };
}
