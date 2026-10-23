import express, { type Express } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import type { CatalogRepository } from "../db/catalog.repo.js";
import type { DecisionsRepository } from "../db/decisions.repo.js";
import { RateLimitedError, errorHandler, notFoundHandler } from "./errors.js";
import { createAllocationsRouter } from "./routes/allocations.js";
import { createCatalogRouter } from "./routes/catalog.js";
import { createHealthRouter } from "./routes/health.js";

export type AppDeps = {
  catalogRepo: CatalogRepository;
  decisionsRepo: DecisionsRepository;
  version?: string;
  commit?: string;
  rateLimitPerMin?: number;
  readRateLimitPerMin?: number;
  publicDir?: string;
};

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "10kb" }));

  if (deps.publicDir) {
    app.use(express.static(deps.publicDir));
  }

  const version = deps.version ?? "0.1.0";
  const commit = deps.commit ?? "local";
  const rateLimitPerMin = deps.rateLimitPerMin ?? 60;
  const readRateLimitPerMin = deps.readRateLimitPerMin ?? rateLimitPerMin * 5;

  // Every GET reaches the database; POST /allocations has its own, stricter limiter.
  app.use(
    "/api/v1",
    rateLimit({
      windowMs: 60_000,
      limit: readRateLimitPerMin,
      standardHeaders: true,
      legacyHeaders: false,
      // HEAD runs the GET handler too, so it counts
      skip: (req) => req.method !== "GET" && req.method !== "HEAD",
      handler: (_req, _res, next) => {
        next(new RateLimitedError("Too many requests, please try again later"));
      },
    }),
  );

  app.use(
    "/api/v1/health",
    createHealthRouter({
      catalogRepo: deps.catalogRepo,
      version,
      commit,
    }),
  );

  app.use(
    "/api/v1/catalog",
    createCatalogRouter({
      catalogRepo: deps.catalogRepo,
    }),
  );

  app.use(
    "/api/v1/allocations",
    createAllocationsRouter({
      catalogRepo: deps.catalogRepo,
      decisionsRepo: deps.decisionsRepo,
      rateLimitPerMin,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
