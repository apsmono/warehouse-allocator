import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/api/app.js";
import type { CatalogRepository } from "../../src/db/catalog.repo.js";
import type {
  DecisionsRepository,
  StoredDecisionRecord,
} from "../../src/db/decisions.repo.js";
import { allocate } from "../../src/engine/index.js";
import type { Options, OrderLine } from "../../src/engine/types.js";
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

function createInMemoryDeps(options?: {
  rateLimitPerMin?: number;
  loadSnapshotImpl?: CatalogRepository["loadSnapshot"];
  insertImpl?: DecisionsRepository["insert"];
}) {
  const snapshot = loadSeedSnapshot();
  const store = new Map<string, StoredDecisionRecord>();
  let counter = 0;

  const catalogRepo: CatalogRepository = {
    loadSnapshot: options?.loadSnapshotImpl ?? vi.fn(async () => snapshot),
    ping: vi.fn(async () => {}),
  };

  const insertSpy = vi.fn<DecisionsRepository["insert"]>(
    options?.insertImpl ??
      (async ({ request: reqData, decision }) => {
        counter += 1;
        const id = `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
        const createdAt = "2026-10-17T12:00:00.000Z";
        store.set(id, { id, createdAt, request: reqData, decision });
        return { id, createdAt };
      }),
  );

  const getByIdSpy = vi.fn<DecisionsRepository["getById"]>(
    async (id: string) => store.get(id) ?? null,
  );

  const decisionsRepo: DecisionsRepository = {
    insert: insertSpy,
    getById: getByIdSpy,
  };

  const app = createApp({
    catalogRepo,
    decisionsRepo,
    rateLimitPerMin: options?.rateLimitPerMin ?? 1000,
  });

  return { app, snapshot, catalogRepo, decisionsRepo, insertSpy, getByIdSpy, store };
}

describe("POST /api/v1/allocations — golden distance & noSplit scenarios", () => {
  const { app, snapshot } = createInMemoryDeps();

  for (const tc of [...golden.distance, ...golden.noSplit]) {
    it(`${tc.id} returns 201 and decision equals allocate() on seed snapshot`, async () => {
      const expectedDecision = allocate({ lines: tc.lines }, snapshot, tc.options);

      const res = await request(app)
        .post("/api/v1/allocations")
        .send({
          lines: tc.lines,
          ...(tc.options ? { options: tc.options } : {}),
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(res.body.createdAt).toBe("2026-10-17T12:00:00.000Z");
      expect(res.body.decision).toEqual(expectedDecision);
    });
  }
});

describe("POST /api/v1/allocations — 422 validation errors and paths", () => {
  const { app } = createInMemoryDeps();

  const validationCases: {
    name: string;
    body: Record<string, unknown>;
    expectedPath: string;
  }[] = [
    {
      name: "unknown product",
      body: { lines: [{ productId: "P999", quantity: 10 }] },
      expectedPath: "lines.0.productId",
    },
    {
      name: "quantity 0",
      body: { lines: [{ productId: "P001", quantity: 0 }] },
      expectedPath: "lines.0.quantity",
    },
    {
      name: "quantity 1.5",
      body: { lines: [{ productId: "P001", quantity: 1.5 }] },
      expectedPath: "lines.0.quantity",
    },
    {
      name: 'quantity "10" (string, no coercion)',
      body: { lines: [{ productId: "P001", quantity: "10" }] },
      expectedPath: "lines.0.quantity",
    },
    {
      name: "quantity 100001",
      body: { lines: [{ productId: "P001", quantity: 100001 }] },
      expectedPath: "lines.0.quantity",
    },
    {
      name: "lines: []",
      body: { lines: [] },
      expectedPath: "lines",
    },
    {
      name: "21 lines",
      body: {
        lines: Array.from({ length: 21 }, () => ({ productId: "P001", quantity: 1 })),
      },
      expectedPath: "lines",
    },
    {
      name: "unknown top-level key",
      body: {
        lines: [{ productId: "P001", quantity: 10 }],
        extraField: true,
      },
      expectedPath: "",
    },
    {
      name: "unknown options key",
      body: {
        lines: [{ productId: "P001", quantity: 10 }],
        options: { allowSplit: true, unknownOption: "nope" },
      },
      expectedPath: "options",
    },
    {
      name: "dispatchAt with distance strategy",
      body: {
        lines: [{ productId: "P001", quantity: 10 }],
        options: {
          strategy: "distance",
          dispatchAt: { day: "Mon", time: "08:00" },
        },
      },
      expectedPath: "options.dispatchAt",
    },
    {
      name: "time-aware without dispatchAt",
      body: {
        lines: [{ productId: "P001", quantity: 10 }],
        options: {
          strategy: "time-aware",
        },
      },
      expectedPath: "options.dispatchAt",
    },
  ];

  for (const vc of validationCases) {
    it(`rejects ${vc.name} with 422 VALIDATION_FAILED at path "${vc.expectedPath}"`, async () => {
      const res = await request(app).post("/api/v1/allocations").send(vc.body);
      expect(res.status).toBe(422);
      expect(res.body).toEqual({
        error: {
          code: "VALIDATION_FAILED",
          message: "Order is invalid",
          details: expect.arrayContaining([
            {
              path: vc.expectedPath,
              message: expect.any(String),
            },
          ]),
        },
      });
    });
  }

  it("returns 422 STRATEGY_NOT_AVAILABLE when strategy is time-aware with valid dispatchAt", async () => {
    const res = await request(app)
      .post("/api/v1/allocations")
      .send({
        lines: [{ productId: "P001", quantity: 10 }],
        options: {
          strategy: "time-aware",
          dispatchAt: { day: "Mon", time: "08:00" },
        },
      });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: {
        code: "STRATEGY_NOT_AVAILABLE",
        message: expect.any(String),
        details: [
          {
            path: "options.strategy",
            message: expect.any(String),
          },
        ],
      },
    });
  });
});

describe("GET /api/v1/allocations/:id", () => {
  it("returns 404 for non-UUID without calling getById", async () => {
    const { app, getByIdSpy } = createInMemoryDeps();

    const res = await request(app).get("/api/v1/allocations/not-a-uuid");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: expect.any(String),
      },
    });
    expect(getByIdSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown valid UUID", async () => {
    const { app, getByIdSpy } = createInMemoryDeps();
    const unknownUuid = "11111111-2222-4333-8444-555555555555";

    const res = await request(app).get(`/api/v1/allocations/${unknownUuid}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: expect.any(String),
      },
    });
    expect(getByIdSpy).toHaveBeenCalledWith(unknownUuid);
  });

  it("returns 200 { id, createdAt, request, decision } for a known id with defaults stored in request", async () => {
    const { app } = createInMemoryDeps();

    const postRes = await request(app)
      .post("/api/v1/allocations")
      .send({
        lines: [{ productId: "P002", quantity: 10 }],
      });
    expect(postRes.status).toBe(201);

    const id = postRes.body.id as string;
    const getRes = await request(app).get(`/api/v1/allocations/${id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body).toEqual({
      id,
      createdAt: postRes.body.createdAt,
      request: {
        lines: [{ productId: "P002", quantity: 10 }],
        options: {
          allowSplit: true,
          strategy: "distance",
        },
      },
      decision: postRes.body.decision,
    });
  });
});

describe("Persistence & catalogue failure resilience and rate limiting", () => {
  it("returns 200 with id: null, createdAt: null and full decision when insert throws", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { app, snapshot } = createInMemoryDeps({
        insertImpl: async () => {
          throw new Error("Neon connection terminated unexpectedly");
        },
      });

      const lines = [{ productId: "P002", quantity: 10 }];
      const expectedDecision = allocate({ lines }, snapshot);

      const res = await request(app).post("/api/v1/allocations").send({ lines });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: null,
        createdAt: null,
        decision: expectedDecision,
      });
      expect(consoleErrorSpy).toHaveBeenCalledOnce();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns 500 INTERNAL when loadSnapshot throws, leaking neither message nor stack", async () => {
    const secretMessage = "SELECT * FROM inventory failed: password authentication failed";
    const { app } = createInMemoryDeps({
      loadSnapshotImpl: async () => {
        throw new Error(secretMessage);
      },
    });

    const res = await request(app)
      .post("/api/v1/allocations")
      .send({ lines: [{ productId: "P001", quantity: 10 }] });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: "INTERNAL",
        message: "Internal error",
      },
    });
    const rawText = JSON.stringify(res.body);
    expect(rawText).not.toContain(secretMessage);
    expect(rawText).not.toContain("stack");
  });

  it("with rateLimitPerMin: 2, 3rd POST returns 429 RATE_LIMITED while GET /catalog is unaffected", async () => {
    const { app } = createInMemoryDeps({ rateLimitPerMin: 2 });
    const validBody = { lines: [{ productId: "P001", quantity: 10 }] };

    const r1 = await request(app).post("/api/v1/allocations").send(validBody);
    expect(r1.status).toBe(201);

    const r2 = await request(app).post("/api/v1/allocations").send(validBody);
    expect(r2.status).toBe(201);

    const r3 = await request(app).post("/api/v1/allocations").send(validBody);
    expect(r3.status).toBe(429);
    expect(r3.body).toEqual({
      error: {
        code: "RATE_LIMITED",
        message: expect.any(String),
      },
    });

    const catRes = await request(app).get("/api/v1/catalog");
    expect(catRes.status).toBe(200);
  });
});
