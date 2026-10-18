import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { loadConfig } from "../src/config.js";
import { closePool, getPool } from "../src/db/pool.js";
import type { Product, Warehouse } from "../src/engine/types.js";

type RawSeedWarehouse = Warehouse & {
  stock: { productId: string; quantity: number }[];
};

type RawSeedFile = {
  products: Product[];
  warehouses: RawSeedWarehouse[];
};

export type DeliveryHistoryRow = {
  id: string;
  warehouseId: string;
  dayOfWeek: string;
  departTime: string;
  durationMin: number;
  note: string | null;
};

export type SeedCounts = {
  products: number;
  warehouses: number;
  inventory: number;
  deliveryHistory: number;
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const seedJsonPath = resolve(currentDir, "../data/seed.json");
const historyCsvPath = resolve(currentDir, "../data/delivery_history.csv");

export function parseDeliveryHistoryCsv(csvText: string): DeliveryHistoryRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    throw new Error("delivery_history.csv is empty");
  }

  const header = lines[0]!;
  if (header !== "delivery_id,warehouse_id,day,time,duration_min,note") {
    throw new Error(`Unexpected CSV header: ${header}`);
  }

  const rows: DeliveryHistoryRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const fields = line.split(",");
    if (fields.length !== 6) {
      throw new Error(
        `CSV row ${i + 1} must have exactly 6 fields, got ${fields.length}: "${line}"`,
      );
    }
    const [deliveryId, warehouseId, day, time, durationRaw, noteRaw] = fields as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const durationMin = Number.parseInt(durationRaw, 10);
    if (!Number.isInteger(durationMin) || durationMin <= 0) {
      throw new Error(`Invalid duration_min at CSV row ${i + 1}: "${durationRaw}"`);
    }
    rows.push({
      id: deliveryId,
      warehouseId,
      dayOfWeek: day,
      departTime: time,
      durationMin,
      note: noteRaw.length > 0 ? noteRaw : null,
    });
  }

  return rows;
}

export async function runSeed(pool: pg.Pool): Promise<SeedCounts> {
  const seedData = JSON.parse(readFileSync(seedJsonPath, "utf8")) as RawSeedFile;
  const csvText = readFileSync(historyCsvPath, "utf8");
  const historyRows = parseDeliveryHistoryCsv(csvText);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      for (const product of seedData.products) {
        await client.query(
          `INSERT INTO products (id, name, category, requires_cold_chain)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             category = EXCLUDED.category,
             requires_cold_chain = EXCLUDED.requires_cold_chain`,
          [product.id, product.name, product.category, product.requiresColdChain],
        );
      }

      for (const warehouse of seedData.warehouses) {
        await client.query(
          `INSERT INTO warehouses (id, city, distance_km, has_cold_storage, has_cold_fleet)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             city = EXCLUDED.city,
             distance_km = EXCLUDED.distance_km,
             has_cold_storage = EXCLUDED.has_cold_storage,
             has_cold_fleet = EXCLUDED.has_cold_fleet`,
          [
            warehouse.id,
            warehouse.city,
            warehouse.distanceKm,
            warehouse.hasColdStorage,
            warehouse.hasColdFleet,
          ],
        );

        for (const item of warehouse.stock) {
          await client.query(
            `INSERT INTO inventory (warehouse_id, product_id, quantity)
             VALUES ($1, $2, $3)
             ON CONFLICT (warehouse_id, product_id) DO UPDATE SET
               quantity = EXCLUDED.quantity`,
            [warehouse.id, item.productId, item.quantity],
          );
        }
      }

      for (const row of historyRows) {
        await client.query(
          `INSERT INTO delivery_history (id, warehouse_id, day_of_week, depart_time, duration_min, note)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             warehouse_id = EXCLUDED.warehouse_id,
             day_of_week = EXCLUDED.day_of_week,
             depart_time = EXCLUDED.depart_time,
             duration_min = EXCLUDED.duration_min,
             note = EXCLUDED.note`,
          [row.id, row.warehouseId, row.dayOfWeek, row.departTime, row.durationMin, row.note],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }

    const countsResult = await client.query<{
      products: string;
      warehouses: string;
      inventory: string;
      delivery_history: string;
    }>(`
      SELECT
        (SELECT count(*) FROM products) AS products,
        (SELECT count(*) FROM warehouses) AS warehouses,
        (SELECT count(*) FROM inventory) AS inventory,
        (SELECT count(*) FROM delivery_history) AS delivery_history
    `);

    const row = countsResult.rows[0]!;
    return {
      products: Number.parseInt(row.products, 10),
      warehouses: Number.parseInt(row.warehouses, 10),
      inventory: Number.parseInt(row.inventory, 10),
      deliveryHistory: Number.parseInt(row.delivery_history, 10),
    };
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = getPool(config.databaseUrl);
  try {
    const counts = await runSeed(pool);
    console.log(
      `Seeded: products=${counts.products}, warehouses=${counts.warehouses}, inventory=${counts.inventory}, delivery_history=${counts.deliveryHistory}`,
    );
  } finally {
    await closePool();
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Seed failed: ${message}`);
    process.exit(1);
  });
}
