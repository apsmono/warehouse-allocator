import { Router } from "express";
import type { CatalogRepository } from "../../db/catalog.repo.js";
import { ENGINE_VERSION } from "../../engine/index.js";
import { extractErrorCode } from "../errors.js";

export type HealthRouterDeps = {
  catalogRepo: Pick<CatalogRepository, "ping">;
  version: string;
  commit: string;
};

export function createHealthRouter(deps: HealthRouterDeps): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    try {
      await deps.catalogRepo.ping();
      res.status(200).json({
        status: "ok",
        version: deps.version,
        commit: deps.commit,
        db: "ok",
        engineVersion: ENGINE_VERSION,
      });
    } catch (err) {
      console.error(`Health check: database ping failed (${extractErrorCode(err)}).`);
      res.status(503).json({
        status: "degraded",
        version: deps.version,
        commit: deps.commit,
        db: "down",
        engineVersion: ENGINE_VERSION,
      });
    }
  });

  return router;
}
