import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { CatalogRepository } from "../../db/catalog.repo.js";
import type { DecisionsRepository, StoredAllocationRequest } from "../../db/decisions.repo.js";
import { allocate } from "../../engine/index.js";
import {
  type ErrorDetail,
  NotFoundError,
  RateLimitedError,
  ValidationError,
} from "../errors.js";
import { allocationRequestSchema, isValidUuid } from "../schemas.js";

export type AllocationsRouterDeps = {
  catalogRepo: Pick<CatalogRepository, "loadSnapshot">;
  decisionsRepo: DecisionsRepository;
  rateLimitPerMin: number;
};

export function createAllocationsRouter(deps: AllocationsRouterDeps): Router {
  const router = Router();

  const postLimiter = rateLimit({
    windowMs: 60_000,
    limit: deps.rateLimitPerMin,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, _res, next) => {
      next(new RateLimitedError());
    },
  });

  router.post("/", postLimiter, async (req, res) => {
    const parsed = allocationRequestSchema.parse(req.body);
    const snapshot = await deps.catalogRepo.loadSnapshot();

    const knownProductIds = new Set(snapshot.products.map((p) => p.id));
    const unknownProductDetails: ErrorDetail[] = [];

    for (let i = 0; i < parsed.lines.length; i++) {
      const line = parsed.lines[i]!;
      if (!knownProductIds.has(line.productId)) {
        unknownProductDetails.push({
          path: `lines.${i}.productId`,
          message: `Unknown product "${line.productId}"`,
        });
      }
    }

    if (unknownProductDetails.length > 0) {
      throw new ValidationError(unknownProductDetails);
    }

    const decision = allocate({ lines: parsed.lines }, snapshot, parsed.options);

    const storedRequest: StoredAllocationRequest = {
      lines: parsed.lines,
      options: {
        allowSplit: parsed.options.allowSplit,
        strategy: parsed.options.strategy,
        ...(parsed.options.dispatchAt ? { dispatchAt: parsed.options.dispatchAt } : {}),
      },
    };

    try {
      const { id, createdAt } = await deps.decisionsRepo.insert({
        request: storedRequest,
        decision,
      });
      res.status(201).json({
        id,
        createdAt,
        decision,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.name : "UnknownError";
      console.error(`Decision persistence failed (${reason}); returning unpersisted decision.`);
      res.status(200).json({
        id: null,
        createdAt: null,
        decision,
      });
    }
  });

  router.get("/:id", async (req, res) => {
    const { id } = req.params;
    if (!isValidUuid(id)) {
      throw new NotFoundError("Allocation decision not found");
    }

    const stored = await deps.decisionsRepo.getById(id);
    if (!stored) {
      throw new NotFoundError("Allocation decision not found");
    }

    res.status(200).json({
      id: stored.id,
      createdAt: stored.createdAt,
      request: stored.request,
      decision: stored.decision,
    });
  });

  return router;
}
