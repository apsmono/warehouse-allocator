import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/api/app.js";
import type { CatalogRepository } from "../../src/db/catalog.repo.js";
import type { DecisionsRepository } from "../../src/db/decisions.repo.js";
import { loadSeedSnapshot } from "../helpers/seed-snapshot.js";

function createStubDeps(overrides?: {
  ping?: () => Promise<void>;
  loadSnapshot?: () => ReturnType<CatalogRepository["loadSnapshot"]>;
}) {
  const snapshot = loadSeedSnapshot();
  const catalogRepo: CatalogRepository = {
    loadSnapshot: overrides?.loadSnapshot ?? (async () => snapshot),
    ping: overrides?.ping ?? (async () => {}),
  };
  const decisionsRepo: DecisionsRepository = {
    insert: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-10-17T00:00:00.000Z",
    })),
    getById: vi.fn(async () => null),
  };
  return { catalogRepo, decisionsRepo };
}

describe("Module import safety and general error handling", () => {
  it("importing src/api/app.ts with DATABASE_URL unset throws nothing and opens no connection", async () => {
    const previousDbUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      const mod = await import("../../src/api/app.js");
      expect(typeof mod.createApp).toBe("function");
      const { catalogRepo, decisionsRepo } = createStubDeps();
      const app = mod.createApp({ catalogRepo, decisionsRepo });
      expect(app).toBeDefined();
    } finally {
      if (previousDbUrl !== undefined) {
        process.env.DATABASE_URL = previousDbUrl;
      }
    }
  });

  it("GET unknown route returns 404 NOT_FOUND with API.md error shape", async () => {
    const { catalogRepo, decisionsRepo } = createStubDeps();
    const app = createApp({ catalogRepo, decisionsRepo });

    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: expect.any(String),
      },
    });
  });

  it("POST with malformed JSON returns 400 MALFORMED_JSON", async () => {
    const { catalogRepo, decisionsRepo } = createStubDeps();
    const app = createApp({ catalogRepo, decisionsRepo });

    const res = await request(app)
      .post("/api/v1/allocations")
      .set("Content-Type", "application/json")
      .send('{"lines": [');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: "MALFORMED_JSON",
        message: expect.any(String),
      },
    });
  });

  it("POST with an 11 KB body returns 413 PAYLOAD_TOO_LARGE", async () => {
    const { catalogRepo, decisionsRepo } = createStubDeps();
    const app = createApp({ catalogRepo, decisionsRepo });

    const oversizedPayload = JSON.stringify({
      lines: [{ productId: "P001", quantity: 1 }],
      padding: "x".repeat(11 * 1024),
    });

    const res = await request(app)
      .post("/api/v1/allocations")
      .set("Content-Type", "application/json")
      .send(oversizedPayload);

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: expect.any(String),
      },
    });
  });
});

describe("GET /api/v1/health", () => {
  it("returns 200 with status ok, version, commit, db ok, engineVersion 1.0.2 when ping resolves", async () => {
    const { catalogRepo, decisionsRepo } = createStubDeps({
      ping: async () => {},
    });
    const app = createApp({
      catalogRepo,
      decisionsRepo,
      version: "0.1.0",
      commit: "a1b2c3d",
    });

    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      version: "0.1.0",
      commit: "a1b2c3d",
      db: "ok",
      engineVersion: "1.0.2",
    });
  });

  it("returns 503 with status degraded and db down when ping rejects", async () => {
    const { catalogRepo, decisionsRepo } = createStubDeps({
      ping: async () => {
        throw new Error("Connection refused");
      },
    });
    const app = createApp({
      catalogRepo,
      decisionsRepo,
      version: "0.1.0",
      commit: "local",
    });

    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      status: "degraded",
      version: "0.1.0",
      commit: "local",
      db: "down",
      engineVersion: "1.0.2",
    });
  });
});

describe("GET /api/v1/catalog", () => {
  it("returns 5 products and 8 warehouses with nested stock, and W02 has hasColdFleet: false", async () => {
    const { catalogRepo, decisionsRepo } = createStubDeps();
    const app = createApp({ catalogRepo, decisionsRepo });

    const res = await request(app).get("/api/v1/catalog");
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(5);
    expect(res.body.warehouses).toHaveLength(8);

    const w02 = res.body.warehouses.find((w: { id: string }) => w.id === "W02");
    expect(w02).toBeDefined();
    expect(w02.hasColdStorage).toBe(true);
    expect(w02.hasColdFleet).toBe(false);
    expect(w02.stock).toEqual([
      { productId: "P001", quantity: 50 },
      { productId: "P002", quantity: 30 },
      { productId: "P004", quantity: 20 },
    ]);
  });
});
