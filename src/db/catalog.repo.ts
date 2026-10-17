import type pg from "pg";
import type { CatalogSnapshot, Product, StockRow, Warehouse } from "../engine/types.js";

export type CatalogRepository = {
  loadSnapshot(): Promise<CatalogSnapshot>;
  ping(): Promise<void>;
};

const PING_TIMEOUT_MS = 3_000;

export function createCatalogRepo(pool: pg.Pool): CatalogRepository {
  return {
    async loadSnapshot(): Promise<CatalogSnapshot> {
      const [productsRes, warehousesRes, stockRes] = await Promise.all([
        pool.query<Product>(
          `SELECT
             id,
             name,
             category,
             requires_cold_chain AS "requiresColdChain"
           FROM products
           ORDER BY id`,
        ),
        pool.query<Warehouse>(
          `SELECT
             id,
             city,
             distance_km::float8 AS "distanceKm",
             has_cold_storage AS "hasColdStorage",
             has_cold_fleet AS "hasColdFleet"
           FROM warehouses
           ORDER BY id`,
        ),
        pool.query<StockRow>(
          `SELECT
             warehouse_id AS "warehouseId",
             product_id AS "productId",
             quantity
           FROM inventory
           ORDER BY warehouse_id, product_id`,
        ),
      ]);

      return {
        products: productsRes.rows.map((row) => ({
          id: row.id,
          name: row.name,
          category: row.category,
          requiresColdChain: Boolean(row.requiresColdChain),
        })),
        warehouses: warehousesRes.rows.map((row) => ({
          id: row.id,
          city: row.city,
          distanceKm: Number(row.distanceKm),
          hasColdStorage: Boolean(row.hasColdStorage),
          hasColdFleet: Boolean(row.hasColdFleet),
        })),
        stock: stockRes.rows.map((row) => ({
          warehouseId: row.warehouseId,
          productId: row.productId,
          quantity: Number(row.quantity),
        })),
      };
    },

    async ping(): Promise<void> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          pool.query("SELECT 1"),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error("DB ping timed out after 3s"));
            }, PING_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    },
  };
}
