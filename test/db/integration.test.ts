import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../db/migrate.js";
import { runSeed } from "../../db/seed.js";
import { loadConfig } from "../../src/config.js";
import { type CatalogRepository, createCatalogRepo } from "../../src/db/catalog.repo.js";
import {
  createDecisionsRepo,
  type DecisionsRepository,
  type StoredAllocationRequest,
} from "../../src/db/decisions.repo.js";
import { closePool, getPool } from "../../src/db/pool.js";
import { allocate } from "../../src/engine/index.js";
import type { CatalogSnapshot, Options, OrderLine } from "../../src/engine/types.js";
import { loadSeedSnapshot } from "../helpers/seed-snapshot.js";

type GoldenCase = {
  id: string;
  desc?: string;
  lines: OrderLine[];
  options?: Options;
};

type GoldenFixtureFile = {
  distance: GoldenCase[];
  noSplit: GoldenCase[];
};

const currentDir = dirname(fileURLToPath(import.meta.url));
const goldenPath = resolve(currentDir, "../fixtures/golden.json");
const golden = JSON.parse(readFileSync(goldenPath, "utf8")) as GoldenFixtureFile;
const allGoldenCases = [...golden.distance, ...golden.noSplit];

describe.skipIf(!process.env.DATABASE_URL)("Postgres DB integration", () => {
  let catalogRepo: CatalogRepository;
  let decisionsRepo: DecisionsRepository;
  let dbSnapshot: CatalogSnapshot;
  const seedSnapshot = loadSeedSnapshot();

  beforeAll(async () => {
    const config = loadConfig();
    const pool = getPool(config.databaseUrl);
    await runMigrations(pool);
    await runSeed(pool);
    catalogRepo = createCatalogRepo(pool);
    decisionsRepo = createDecisionsRepo(pool);
    dbSnapshot = await catalogRepo.loadSnapshot();
  });

  afterAll(async () => {
    await closePool();
  });

  it("ping resolves", async () => {
    await expect(catalogRepo.ping()).resolves.toBeUndefined();
  });

  it("all 16 golden cases give toEqual decisions from the DB snapshot and from seed.json", () => {
    expect(allGoldenCases).toHaveLength(16);
    for (const tc of allGoldenCases) {
      const fromDb = allocate({ lines: tc.lines }, dbSnapshot, tc.options);
      const fromSeed = allocate({ lines: tc.lines }, seedSnapshot, tc.options);
      expect(fromDb).toEqual(fromSeed);
    }
  });

  it("insert then getById round-trips a decision", async () => {
    const requestPayload: StoredAllocationRequest = {
      lines: [{ productId: "P002", quantity: 10 }],
      options: {
        allowSplit: true,
        strategy: "distance",
      },
    };
    const decision = allocate({ lines: requestPayload.lines }, dbSnapshot, requestPayload.options);

    const inserted = await decisionsRepo.insert({
      request: requestPayload,
      decision,
    });

    expect(inserted.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(new Date(inserted.createdAt).toISOString()).toBe(inserted.createdAt);

    const fetched = await decisionsRepo.getById(inserted.id);
    expect(fetched).toEqual({
      id: inserted.id,
      createdAt: inserted.createdAt,
      request: requestPayload,
      decision,
    });
  });
});
