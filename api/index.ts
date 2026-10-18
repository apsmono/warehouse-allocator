import { createApp } from "../src/api/app.js";
import { loadConfig } from "../src/config.js";
import { createCatalogRepo } from "../src/db/catalog.repo.js";
import { createDecisionsRepo } from "../src/db/decisions.repo.js";
import { getPool } from "../src/db/pool.js";

const config = loadConfig();
const pool = getPool(config.databaseUrl);

const app = createApp({
  catalogRepo: createCatalogRepo(pool),
  decisionsRepo: createDecisionsRepo(pool),
  version: config.version,
  commit: config.commit,
  rateLimitPerMin: config.rateLimitPerMin,
});

export default app;
