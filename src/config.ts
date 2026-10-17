import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export type AppConfig = Readonly<{
  databaseUrl: string;
  port: number;
  rateLimitPerMin: number;
  commit: string;
  version: string;
}>;

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z.coerce.number().int().positive().default(3000),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(60),
  VERCEL_GIT_COMMIT_SHA: z.string().optional(),
});

let cachedConfig: AppConfig | null = null;

function readPackageVersion(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const pkgPath = resolve(currentDir, "../package.json");
  const raw = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
  return typeof raw.version === "string" ? raw.version : "0.0.0";
}

export function resolveCommitSha(rawSha: string | undefined): string {
  const trimmed = rawSha?.trim();
  if (!trimmed) {
    return "local";
  }
  return trimmed.slice(0, 7);
}

export function loadConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  const parsed = envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    PORT: process.env.PORT || undefined,
    RATE_LIMIT_PER_MIN: process.env.RATE_LIMIT_PER_MIN || undefined,
    VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
  });

  cachedConfig = Object.freeze({
    databaseUrl: parsed.DATABASE_URL,
    port: parsed.PORT,
    rateLimitPerMin: parsed.RATE_LIMIT_PER_MIN,
    commit: resolveCommitSha(parsed.VERCEL_GIT_COMMIT_SHA),
    version: readPackageVersion(),
  });

  return cachedConfig;
}
