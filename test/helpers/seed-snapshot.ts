import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogSnapshot, Product, StockRow, Warehouse } from "../../src/engine/types.js";

type RawSeedWarehouse = Warehouse & {
  stock: { productId: string; quantity: number }[];
};

type RawSeedFile = {
  products: Product[];
  warehouses: RawSeedWarehouse[];
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const seedFilePath = resolve(currentDir, "../../data/seed.json");

export function loadSeedSnapshot(): CatalogSnapshot {
  const raw = JSON.parse(readFileSync(seedFilePath, "utf8")) as RawSeedFile;

  const warehouses: Warehouse[] = [];
  const stock: StockRow[] = [];

  for (const w of raw.warehouses) {
    warehouses.push({
      id: w.id,
      city: w.city,
      distanceKm: w.distanceKm,
      hasColdStorage: w.hasColdStorage,
      hasColdFleet: w.hasColdFleet,
    });
    for (const item of w.stock) {
      stock.push({
        warehouseId: w.id,
        productId: item.productId,
        quantity: item.quantity,
      });
    }
  }

  return {
    products: raw.products.map((p) => ({ ...p })),
    warehouses,
    stock,
  };
}
