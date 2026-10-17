import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { loadConfig } from "../src/config.js";
import { closePool, getPool } from "../src/db/pool.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(currentDir, "migrations");

export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  try {
    const regResult = await client.query<{ reg: string | null }>(
      "SELECT to_regclass('public.schema_migrations') AS reg",
    );
    const tableExists = regResult.rows[0]?.reg !== null && regResult.rows[0]?.reg !== undefined;

    const applied = new Set<string>();
    if (tableExists) {
      const rowsResult = await client.query<{ version: string }>(
        "SELECT version FROM schema_migrations",
      );
      for (const row of rowsResult.rows) {
        applied.add(row.version);
      }
    }

    const newlyApplied: string[] = [];
    for (const file of files) {
      if (applied.has(file)) {
        continue;
      }
      const sql = readFileSync(join(migrationsDir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
        await client.query("COMMIT");
        newlyApplied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }

    return newlyApplied;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = getPool(config.databaseUrl);
  try {
    const applied = await runMigrations(pool);
    if (applied.length === 0) {
      console.log("Migrations: 0 applied (already up to date)");
    } else {
      console.log(`Migrations: applied ${applied.length} (${applied.join(", ")})`);
    }
  } finally {
    await closePool();
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? "")) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Migration failed: ${message}`);
    process.exit(1);
  });
}
