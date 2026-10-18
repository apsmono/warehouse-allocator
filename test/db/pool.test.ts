import { afterEach, describe, expect, it, vi } from "vitest";
import { closePool, getPool } from "../../src/db/pool.js";

describe("getPool idle error handling", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await closePool();
  });

  it("logs idle client error codes without throwing or leaking error messages", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const pool = getPool("postgresql://x:x@127.0.0.1:1/x");

    const idleError = Object.assign(new Error("terminating connection"), {
      code: "57P01",
    });

    expect(() => {
      pool.emit("error", idleError);
    }).not.toThrow();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("57P01");
    expect(logged).not.toContain("terminating connection");
  });
});
