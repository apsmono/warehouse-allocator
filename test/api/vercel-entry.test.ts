import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { closePool } from "../../src/db/pool.js";

describe("Vercel function entry (api/index.ts)", () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await closePool();
  });

  it("exports an Express handler function and returns 503 db: down when DB is unreachable", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://x:x@127.0.0.1:1/x");
    const mod = await import("../../api/index.js");
    expect(typeof mod.default).toBe("function");

    const res = await request(mod.default).get("/api/v1/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ db: "down" });
  });
});
