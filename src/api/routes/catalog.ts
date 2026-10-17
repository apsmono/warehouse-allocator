import { Router } from "express";
import type { CatalogRepository } from "../../db/catalog.repo.js";

export type CatalogRouterDeps = {
  catalogRepo: Pick<CatalogRepository, "loadSnapshot">;
};

export function createCatalogRouter(deps: CatalogRouterDeps): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const snapshot = await deps.catalogRepo.loadSnapshot();

    const stockByWarehouse = new Map<string, { productId: string; quantity: number }[]>();
    for (const row of snapshot.stock) {
      let list = stockByWarehouse.get(row.warehouseId);
      if (!list) {
        list = [];
        stockByWarehouse.set(row.warehouseId, list);
      }
      list.push({
        productId: row.productId,
        quantity: row.quantity,
      });
    }

    const warehouses = snapshot.warehouses.map((w) => ({
      id: w.id,
      city: w.city,
      distanceKm: w.distanceKm,
      hasColdStorage: w.hasColdStorage,
      hasColdFleet: w.hasColdFleet,
      stock: stockByWarehouse.get(w.id) ?? [],
    }));

    res.status(200).json({
      products: snapshot.products,
      warehouses,
    });
  });

  return router;
}
