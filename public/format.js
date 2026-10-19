/**
 * Pure display and formatting helpers for the Warehouse Allocator UI.
 * No DOM access, no globals, no side effects.
 */

/**
 * @typedef {{ id: string, name: string, category?: string, requiresColdChain: boolean }} ProductItem
 * @typedef {{ productId: string, quantity: number }} StockEntry
 * @typedef {{ id: string, city: string, distanceKm: number, hasColdStorage: boolean, hasColdFleet: boolean, stock?: StockEntry[] }} WarehouseItem
 * @typedef {{ productId: string, quantity: number }} OrderLineItem
 * @typedef {{ warehouseId: string, city: string, distanceKm: number, items: OrderLineItem[] }} ShipmentItem
 * @typedef {{ productId: string, requested: number, allocated: number, missing: number, reason: string }} ShortfallItem
 * @typedef {{ warehouseId: string, productId: string, code: string, detail: string }} ExclusionItem
 * @typedef {{ warehouses: string[], unitsFilled: number, totalCost: number, delta: number, whyNot: string }} AlternativeItem
 * @typedef {{ engineVersion: string, shipmentOverhead: number, evaluatedCombinations: number }} DecisionMetaItem
 * @typedef {{
 *   status: "FULL" | "PARTIAL" | "UNFULFILLABLE",
 *   strategy?: string,
 *   shipments: ShipmentItem[],
 *   shortfalls: ShortfallItem[],
 *   totalCost: number,
 *   costUnit: "km" | "min",
 *   summary: string,
 *   reasons: string[],
 *   excluded: ExclusionItem[],
 *   alternatives: AlternativeItem[],
 *   meta: DecisionMetaItem
 * }} DecisionPayload
 */

/**
 * Formats a product as `P005 · Paracetamol Tablets (Box of 100)` (#6).
 * @param {ProductItem | undefined} product
 * @param {string} [fallbackId]
 * @returns {string}
 */
export function formatProductDisplay(product, fallbackId = "") {
  if (!product) {
    return String(fallbackId);
  }
  return `${product.id} · ${product.name}`;
}

/**
 * Maps an engine exclusion code to a human-readable label (#3).
 * @param {string} code
 * @returns {string}
 */
export function formatExclusionCode(code) {
  if (code === "NO_COLD_FLEET") {
    return "No refrigerated vans";
  }
  if (code === "NO_COLD_STORAGE") {
    return "No cold storage";
  }
  return String(code || "");
}

/**
 * Looks up how many units of `productId` a warehouse holds in `/catalog`.
 * @param {readonly WarehouseItem[]} warehouses
 * @param {string} warehouseId
 * @param {string} productId
 * @returns {number}
 */
export function getWarehouseStockQuantity(warehouses, warehouseId, productId) {
  if (!Array.isArray(warehouses)) {
    return 0;
  }
  const warehouse = warehouses.find((w) => w.id === warehouseId);
  if (!warehouse || !Array.isArray(warehouse.stock)) {
    return 0;
  }
  const entry = warehouse.stock.find((s) => s.productId === productId);
  return entry && typeof entry.quantity === "number" ? entry.quantity : 0;
}

/**
 * Formats `decision.excluded[]` into structured rows for the compact exclusions table (#2, #3).
 * Looks up held stock from `warehouses` (falling back to parsing `detail` if needed).
 * @param {readonly ExclusionItem[]} excluded
 * @param {readonly WarehouseItem[]} [warehouses]
 * @returns {{ warehouseId: string, productId: string, quantity: number, holdsText: string, code: string, reasonLabel: string, detail: string }[]}
 */
export function formatExclusions(excluded, warehouses = []) {
  if (!Array.isArray(excluded)) {
    return [];
  }
  return excluded.map((ex) => {
    let quantity = getWarehouseStockQuantity(warehouses, ex.warehouseId, ex.productId);
    if (quantity === 0 && typeof ex.detail === "string") {
      const match = ex.detail.match(/\bholds\s+(\d+)\b/i);
      if (match && match[1]) {
        quantity = Number(match[1]);
      }
    }
    return {
      warehouseId: ex.warehouseId,
      productId: ex.productId,
      quantity,
      holdsText: `holds ${quantity}`,
      code: ex.code,
      reasonLabel: formatExclusionCode(ex.code),
      detail: ex.detail,
    };
  });
}

/**
 * Removes the duplicate delta prefix from `alternatives[].whyNot` by returning the substring
 * after the first `": "`, or the whole string if no `": "` is present (#4).
 * @param {string} whyNot
 * @returns {string}
 */
export function splitWhyNot(whyNot) {
  const raw = String(whyNot ?? "");
  const sepIndex = raw.indexOf(": ");
  if (sepIndex === -1) {
    return raw;
  }
  return raw.slice(sepIndex + 2);
}

/**
 * Computes the plain-arithmetic cost breakdown from `shipments[].distanceKm` and `meta.shipmentOverhead` (#5).
 * @param {DecisionPayload} decision
 * @returns {{
 *   totalCost: number,
 *   computedTotal: number,
 *   travelDistances: number[],
 *   travelSum: number,
 *   shipmentCount: number,
 *   shipmentOverhead: number,
 *   costUnit: string,
 *   formulaRightSide: string,
 *   text: string
 * }}
 */
export function computeCostBreakdown(decision) {
  const shipments = Array.isArray(decision?.shipments) ? decision.shipments : [];
  const costUnit = decision?.costUnit ?? "km";
  const shipmentOverhead = Number(decision?.meta?.shipmentOverhead ?? 20);
  const totalCost = Number(decision?.totalCost ?? 0);
  const travelDistances = shipments.map((s) => Number(s.distanceKm));
  const travelSum = travelDistances.reduce((sum, km) => sum + km, 0);
  const shipmentCount = shipments.length;
  const computedTotal = shipmentCount === 0 ? 0 : travelSum + shipmentCount * shipmentOverhead;

  if (shipmentCount === 0) {
    return {
      totalCost,
      computedTotal,
      travelDistances,
      travelSum: 0,
      shipmentCount: 0,
      shipmentOverhead,
      costUnit,
      formulaRightSide: `0 ${costUnit}`,
      text: `0 ${costUnit}`,
    };
  }

  const travelExpr = travelDistances.join(" + ");
  const formulaRightSide = `${travelExpr} ${costUnit} travel + ${shipmentCount} × ${shipmentOverhead} ${costUnit} dispatch`;
  return {
    totalCost,
    computedTotal,
    travelDistances,
    travelSum,
    shipmentCount,
    shipmentOverhead,
    costUnit,
    formulaRightSide,
    text: `${computedTotal} ${costUnit} = ${formulaRightSide}`,
  };
}

/**
 * One-line status hint shown next to the FULL / PARTIAL / UNFULFILLABLE badge (#8).
 * @param {DecisionPayload} decision
 * @returns {string}
 */
export function formatStatusHint(decision) {
  if (!decision) {
    return "";
  }
  if (decision.status === "FULL") {
    return "all units allocated";
  }
  if (decision.status === "PARTIAL") {
    const missingTotal = (decision.shortfalls || []).reduce(
      (sum, sf) => sum + Number(sf.missing || 0),
      0,
    );
    const unitWord = missingTotal === 1 ? "unit" : "units";
    return `${missingTotal} ${unitWord} short, back-order needed`;
  }
  return "no eligible stock available";
}

/**
 * Short 8-character decision identifier (#7).
 * @param {string | null | undefined} id
 * @returns {string}
 */
export function formatShortDecisionId(id) {
  if (!id) {
    return "";
  }
  return String(id).slice(0, 8);
}

/**
 * Mirrors `src/engine/eligibility.ts`: stock > 0 and (not cold, or cold storage AND cold fleet) (#11, #20).
 * @param {WarehouseItem} warehouse
 * @param {ProductItem} product
 * @param {number} stockQuantity
 * @returns {boolean}
 */
export function isWarehouseEligibleForProduct(warehouse, product, stockQuantity) {
  if (stockQuantity <= 0) {
    return false;
  }
  if (product.requiresColdChain) {
    return Boolean(warehouse.hasColdStorage && warehouse.hasColdFleet);
  }
  return true;
}

/**
 * Computes total shippable stock and eligible warehouse count for a product (#11).
 * @param {string} productId
 * @param {readonly ProductItem[]} products
 * @param {readonly WarehouseItem[]} warehouses
 * @returns {{
 *   productId: string,
 *   requiresColdChain: boolean,
 *   totalUnits: number,
 *   warehouseCount: number,
 *   text: string
 * }}
 */
export function computeShippableStock(productId, products, warehouses) {
  const product = (products || []).find((p) => p.id === productId);
  if (!product) {
    return {
      productId,
      requiresColdChain: false,
      totalUnits: 0,
      warehouseCount: 0,
      text: "Shippable stock: 0 across 0 warehouses",
    };
  }

  let totalUnits = 0;
  let warehouseCount = 0;

  for (const warehouse of warehouses || []) {
    const qty = getWarehouseStockQuantity(warehouses, warehouse.id, product.id);
    if (isWarehouseEligibleForProduct(warehouse, product, qty)) {
      totalUnits += qty;
      warehouseCount += 1;
    }
  }

  const whWord = warehouseCount === 1 ? "warehouse" : "warehouses";
  return {
    productId,
    requiresColdChain: Boolean(product.requiresColdChain),
    totalUnits,
    warehouseCount,
    text: `Shippable stock: ${totalUnits} across ${warehouseCount} ${whWord}`,
  };
}

/**
 * Detects duplicate product lines in the order builder and computes their combined total (#12).
 * @param {readonly { productId: string, quantity: number }[]} lines
 * @returns {{ productId: string, lineCount: number, totalQuantity: number, text: string }[]}
 */
export function findDuplicateMerges(lines) {
  /** @type {Map<string, { lineCount: number, totalQuantity: number }>} */
  const byProduct = new Map();

  for (const line of lines || []) {
    if (!line || !line.productId) {
      continue;
    }
    const numQty = Number(line.quantity);
    const validQty = Number.isFinite(numQty) && numQty > 0 ? Math.floor(numQty) : 0;
    const prev = byProduct.get(line.productId) ?? { lineCount: 0, totalQuantity: 0 };
    byProduct.set(line.productId, {
      lineCount: prev.lineCount + 1,
      totalQuantity: prev.totalQuantity + validQty,
    });
  }

  return Array.from(byProduct.entries())
    .filter(([, info]) => info.lineCount >= 2)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([productId, info]) => ({
      productId,
      lineCount: info.lineCount,
      totalQuantity: info.totalQuantity,
      text: `${productId} appears in ${info.lineCount} lines; they'll be combined (${info.totalQuantity} total)`,
    }));
}

/**
 * Computes the running order summary shown above the Allocate button (#13).
 * @param {readonly { productId: string, quantity: number }[]} lines
 * @param {readonly ProductItem[]} products
 * @returns {{ lineCount: number, totalUnits: number, coldCount: number, text: string }}
 */
export function formatOrderSummary(lines, products) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const productMap = new Map((products || []).map((p) => [p.id, p]));
  const lineCount = safeLines.length;
  let totalUnits = 0;
  const coldProductIds = new Set();

  for (const line of safeLines) {
    if (!line) {
      continue;
    }
    const numQty = Number(line.quantity);
    if (Number.isFinite(numQty) && numQty > 0) {
      totalUnits += Math.floor(numQty);
    }
    const prod = productMap.get(line.productId);
    if (prod?.requiresColdChain) {
      coldProductIds.add(prod.id);
    }
  }

  const coldCount = coldProductIds.size;
  const lineWord = lineCount === 1 ? "line" : "lines";
  const unitWord = totalUnits === 1 ? "unit" : "units";
  const coldWord = coldCount === 1 ? "cold-chain product" : "cold-chain products";

  return {
    lineCount,
    totalUnits,
    coldCount,
    text: `${lineCount} ${lineWord} · ${totalUnits} ${unitWord} · ${coldCount} ${coldWord}`,
  };
}

/**
 * Describes a stock table cell's display state, including 0 -> "—", struck-through cold-ineligible stock,
 * and allocated shipment quantity highlights (#20, #21).
 * @param {WarehouseItem} warehouse
 * @param {ProductItem} product
 * @param {number} [allocatedQuantity]
 * @returns {{
 *   state: "zero" | "ineligible-cold" | "allocated" | "available",
 *   quantity: number,
 *   allocated: number,
 *   canShip: boolean,
 *   primaryText: string,
 *   secondaryText: string
 * }}
 */
export function describeStockCell(warehouse, product, allocatedQuantity = 0) {
  const quantity = getWarehouseStockQuantity([warehouse], warehouse.id, product.id);
  const alloc = Number(allocatedQuantity || 0);

  if (quantity <= 0) {
    return {
      state: "zero",
      quantity: 0,
      allocated: 0,
      canShip: false,
      primaryText: "—",
      secondaryText: "",
    };
  }

  if (!isWarehouseEligibleForProduct(warehouse, product, quantity)) {
    return {
      state: "ineligible-cold",
      quantity,
      allocated: 0,
      canShip: false,
      primaryText: String(quantity),
      secondaryText: "can't ship cold",
    };
  }

  if (alloc > 0) {
    return {
      state: "allocated",
      quantity,
      allocated: alloc,
      canShip: true,
      primaryText: `${quantity} → ships ${alloc}`,
      secondaryText: `ships ${alloc}`,
    };
  }

  return {
    state: "available",
    quantity,
    allocated: 0,
    canShip: true,
    primaryText: String(quantity),
    secondaryText: "",
  };
}

/**
 * Describes a warehouse's role in the active decision for the warehouse detail modal (#41, W4-b).
 * @param {string} warehouseId
 * @param {DecisionPayload | null | undefined} decision
 * @param {readonly WarehouseItem[]} warehouses
 * @returns {{
 *   role: "none" | "chosen" | "excluded" | "alternative" | "not-involved",
 *   summary: string
 * }}
 */
export function getWarehouseDecisionRole(warehouseId, decision, warehouses = []) {
  if (!decision) {
    return {
      role: "none",
      summary: "No order allocated yet.",
    };
  }

  const shipment = (decision.shipments || []).find((s) => s.warehouseId === warehouseId);
  const exclusions = formatExclusions(
    (decision.excluded || []).filter((e) => e.warehouseId === warehouseId),
    warehouses,
  );

  if (shipment) {
    const shippedList = (shipment.items || [])
      .map((item) => `${item.quantity} ${item.productId}`)
      .join(", ");
    let summary = `Chosen: ships ${shippedList}`;
    if (exclusions.length > 0) {
      const exText = exclusions
        .map(
          (ex) =>
            `can't ship ${ex.productId} (${ex.reasonLabel.toLowerCase()}); holds ${ex.quantity}`,
        )
        .join("; ");
      summary += ` (${exText})`;
    }
    return {
      role: "chosen",
      summary,
    };
  }

  if (exclusions.length > 0) {
    const exSummary = exclusions
      .map(
        (ex) =>
          `Can't ship ${ex.productId} (${ex.reasonLabel.toLowerCase()}); holds ${ex.quantity}`,
      )
      .join("; ");
    return {
      role: "excluded",
      summary: exSummary,
    };
  }

  const matchingAlt = (decision.alternatives || []).find((alt) =>
    (alt.warehouses || []).includes(warehouseId),
  );
  if (matchingAlt) {
    const combo = matchingAlt.warehouses.join(" + ");
    const sign = matchingAlt.delta >= 0 ? "+" : "";
    const reason = splitWhyNot(matchingAlt.whyNot);
    return {
      role: "alternative",
      summary: `In alternative ${combo} (${sign}${matchingAlt.delta} ${decision.costUnit}: ${reason})`,
    };
  }

  return {
    role: "not-involved",
    summary: "Not involved in this decision",
  };
}

/**
 * Builds a copyable curl command for `POST /api/v1/allocations` against the given origin (#40).
 * @param {string} origin
 * @param {{ lines: { productId: string, quantity: number }[], options?: { allowSplit?: boolean, strategy?: string } }} requestPayload
 * @returns {string}
 */
export function buildAllocationCurl(origin, requestPayload) {
  const baseUrl = String(origin || "http://localhost:3000").replace(/\/+$/, "");
  const jsonBody = JSON.stringify(requestPayload);
  return `curl -s -X POST "${baseUrl}/api/v1/allocations" -H "Content-Type: application/json" -d '${jsonBody}'`;
}
