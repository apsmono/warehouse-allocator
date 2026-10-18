import { afterEach, describe, expect, it, vi } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns version matching package.json", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://x:x@127.0.0.1:1/x");
    const config = loadConfig();
    expect(config.version).toBe(pkg.version);
  });
});
