import { resolve } from "node:path";
import { createApp } from "./api/app.js";
import { loadConfig } from "./config.js";
import { createCatalogRepo } from "./db/catalog.repo.js";
import { createDecisionsRepo } from "./db/decisions.repo.js";
import { closePool, getPool } from "./db/pool.js";

const config = loadConfig();
const pool = getPool(config.databaseUrl);

const app = createApp({
  catalogRepo: createCatalogRepo(pool),
  decisionsRepo: createDecisionsRepo(pool),
  version: config.version,
  commit: config.commit,
  rateLimitPerMin: config.rateLimitPerMin,
  publicDir: resolve(import.meta.dirname, "../public"),
});

const server = app.listen(config.port, () => {
  console.log(`warehouse-allocator listening on http://localhost:${config.port}`);
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => {
    void closePool().finally(() => {
      process.exit(0);
    });
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
