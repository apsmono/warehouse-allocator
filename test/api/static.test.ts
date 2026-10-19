import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/api/app.js";
import type { CatalogRepository } from "../../src/db/catalog.repo.js";
import type { DecisionsRepository } from "../../src/db/decisions.repo.js";
import { loadSeedSnapshot } from "../helpers/seed-snapshot.js";

const publicDir = resolve(import.meta.dirname, "../../public");

function createStubDeps() {
  const snapshot = loadSeedSnapshot();
  const catalogRepo: CatalogRepository = {
    loadSnapshot: async () => snapshot,
    ping: async () => {},
  };
  const decisionsRepo: DecisionsRepository = {
    insert: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-10-18T00:00:00.000Z",
    })),
    getById: vi.fn(async () => null),
  };
  return { catalogRepo, decisionsRepo };
}

describe("Static UI serving and CSP hygiene", () => {
  it("with publicDir set to real public/, GET / returns 200 text/html and GET /app.js returns 200 JavaScript", async () => {
    const { catalogRepo, decisionsRepo } = createStubDeps();
    const app = createApp({ catalogRepo, decisionsRepo, publicDir });

    const htmlRes = await request(app).get("/");
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.headers["content-type"]).toMatch(/text\/html/i);

    const jsRes = await request(app).get("/app.js");
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers["content-type"]).toMatch(/javascript/i);

    const formatRes = await request(app).get("/format.js");
    expect(formatRes.status).toBe(200);
    expect(formatRes.headers["content-type"]).toMatch(/javascript/i);
  });

  it("without publicDir, GET / returns 404 NOT_FOUND in the API error shape", async () => {
    const { catalogRepo, decisionsRepo } = createStubDeps();
    const app = createApp({ catalogRepo, decisionsRepo });

    const res = await request(app).get("/");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: expect.any(String),
      },
    });
  });

  it("public/index.html contains no <script> without src and no inline on[a-z]+= event handler", () => {
    const html = readFileSync(resolve(publicDir, "index.html"), "utf8");
    const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];
    expect(scriptTags.length).toBeGreaterThan(0);
    for (const tag of scriptTags) {
      expect(tag).toMatch(/\bsrc\s*=\s*["'][^"']+["']/i);
    }
    expect(html).not.toMatch(/\bon[a-z]+\s*=/i);

    const appJs = readFileSync(resolve(publicDir, "app.js"), "utf8");
    expect(appJs).not.toMatch(/\binnerHTML\b/);

    const formatJs = readFileSync(resolve(publicDir, "format.js"), "utf8");
    expect(formatJs).not.toMatch(/\binnerHTML\b/);
  });

  it("/api/v1/health still answers when publicDir is set", async () => {
    const { catalogRepo, decisionsRepo } = createStubDeps();
    const app = createApp({
      catalogRepo,
      decisionsRepo,
      publicDir,
      version: "0.2.0",
      commit: "local",
    });

    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: "ok",
      version: "0.2.0",
      commit: "local",
      db: "ok",
      engineVersion: "1.0.0",
    });
  });
});
