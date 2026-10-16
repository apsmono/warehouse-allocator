import type { CatalogSnapshot, Exclusion, OrderLine, Product, Warehouse } from "./types.js";

export type ExclusionWithQuantity = Exclusion & {
  quantity: number;
};

export type EligibilityResult = {
  candidateWarehouses: Warehouse[];
  excluded: ExclusionWithQuantity[];
  getEligibleStock: (warehouseId: string, productId: string) => number;
  getTotalEligibleStock: (productId: string) => number;
};

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isWarehouseEligibleForProduct(
  warehouse: Warehouse,
  product: Product,
  stockQuantity: number,
): boolean {
  if (stockQuantity <= 0) {
    return false;
  }
  if (product.requiresColdChain) {
    return warehouse.hasColdStorage && warehouse.hasColdFleet;
  }
  return true;
}

export function evaluateEligibility(
  mergedLines: readonly OrderLine[],
  snapshot: CatalogSnapshot,
): EligibilityResult {
  const productById = new Map<string, Product>();
  for (const product of snapshot.products) {
    productById.set(product.id, product);
  }

  const stockByKey = new Map<string, number>();
  for (const row of snapshot.stock) {
    if (row.quantity > 0) {
      const key = `${row.warehouseId}:${row.productId}`;
      stockByKey.set(key, (stockByKey.get(key) ?? 0) + row.quantity);
    }
  }

  const sortedWarehouses = [...snapshot.warehouses].sort((a, b) => compareStrings(a.id, b.id));

  const eligibleStockByKey = new Map<string, number>();
  const totalEligibleByProduct = new Map<string, number>();
  const candidateWarehouseIds = new Set<string>();
  const excluded: ExclusionWithQuantity[] = [];

  for (const line of mergedLines) {
    const product = productById.get(line.productId);
    if (!product) {
      totalEligibleByProduct.set(line.productId, 0);
      continue;
    }

    let productTotalEligible = 0;

    for (const warehouse of sortedWarehouses) {
      const key = `${warehouse.id}:${product.id}`;
      const qty = stockByKey.get(key) ?? 0;
      if (qty <= 0) {
        continue;
      }

      if (isWarehouseEligibleForProduct(warehouse, product, qty)) {
        eligibleStockByKey.set(key, qty);
        productTotalEligible += qty;
        candidateWarehouseIds.add(warehouse.id);
      } else if (product.requiresColdChain) {
        const code = !warehouse.hasColdStorage ? "NO_COLD_STORAGE" : "NO_COLD_FLEET";
        const detail =
          code === "NO_COLD_FLEET"
            ? `${warehouse.id} holds ${qty} ${product.id} but has no refrigerated vans, so it cannot deliver it safely.`
            : `${warehouse.id} holds ${qty} ${product.id} but has no refrigerated storage, so it cannot deliver it safely.`;

        excluded.push({
          warehouseId: warehouse.id,
          productId: product.id,
          code,
          detail,
          quantity: qty,
        });
      }
    }

    totalEligibleByProduct.set(product.id, productTotalEligible);
  }

  const candidateWarehouses = sortedWarehouses.filter((w) => candidateWarehouseIds.has(w.id));

  return {
    candidateWarehouses,
    excluded,
    getEligibleStock: (warehouseId: string, productId: string): number =>
      eligibleStockByKey.get(`${warehouseId}:${productId}`) ?? 0,
    getTotalEligibleStock: (productId: string): number =>
      totalEligibleByProduct.get(productId) ?? 0,
  };
}
