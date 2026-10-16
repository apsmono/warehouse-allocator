import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allocate, normaliseOrderLines } from "../../src/engine/index.js";
import { loadSeedSnapshot } from "../helpers/seed-snapshot.js";

const PRODUCT_IDS = ["P001", "P002", "P003", "P004", "P005"] as const;

const orderLineArb = fc.record({
  productId: fc.constantFrom(...PRODUCT_IDS),
  quantity: fc.integer({ min: 1, max: 600 }),
});

const orderLinesArb = fc.array(orderLineArb, { minLength: 1, maxLength: 5 });

describe("Allocation engine properties (P1–P6, 200 runs each)", () => {
  const snapshot = loadSeedSnapshot();
  const productMap = new Map(snapshot.products.map((p) => [p.id, p]));
  const warehouseMap = new Map(snapshot.warehouses.map((w) => [w.id, w]));
  const stockMap = new Map(
    snapshot.stock.map((s) => [`${s.warehouseId}:${s.productId}`, s.quantity]),
  );

  it("P1: no allocation exceeds stock (sum per (w, p) <= stock)", () => {
    fc.assert(
      fc.property(orderLinesArb, fc.boolean(), (lines, allowSplit) => {
        const decision = allocate({ lines }, snapshot, { allowSplit });
        for (const shipment of decision.shipments) {
          for (const item of shipment.items) {
            const avail = stockMap.get(`${shipment.warehouseId}:${item.productId}`) ?? 0;
            expect(item.quantity).toBeLessThanOrEqual(avail);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("P2: no cold product is ever allocated from a warehouse lacking storage or fleet", () => {
    fc.assert(
      fc.property(orderLinesArb, fc.boolean(), (lines, allowSplit) => {
        const decision = allocate({ lines }, snapshot, { allowSplit });
        for (const shipment of decision.shipments) {
          const warehouse = warehouseMap.get(shipment.warehouseId)!;
          for (const item of shipment.items) {
            const product = productMap.get(item.productId)!;
            if (product.requiresColdChain) {
              expect(warehouse.hasColdStorage).toBe(true);
              expect(warehouse.hasColdFleet).toBe(true);
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("P3: allocated + missing = requested for each merged line", () => {
    fc.assert(
      fc.property(orderLinesArb, fc.boolean(), (lines, allowSplit) => {
        const decision = allocate({ lines }, snapshot, { allowSplit });
        const merged = normaliseOrderLines(lines);

        const allocatedByProduct = new Map<string, number>();
        for (const shipment of decision.shipments) {
          for (const item of shipment.items) {
            allocatedByProduct.set(
              item.productId,
              (allocatedByProduct.get(item.productId) ?? 0) + item.quantity,
            );
          }
        }

        const missingByProduct = new Map<string, number>();
        for (const sf of decision.shortfalls) {
          missingByProduct.set(sf.productId, sf.missing);
          expect(sf.allocated + sf.missing).toBe(sf.requested);
        }

        for (const line of merged) {
          const allocated = allocatedByProduct.get(line.productId) ?? 0;
          const missing = missingByProduct.get(line.productId) ?? 0;
          expect(allocated + missing).toBe(line.quantity);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("P4: deterministic — same input twice gives deep-equal output", () => {
    fc.assert(
      fc.property(orderLinesArb, fc.boolean(), (lines, allowSplit) => {
        const first = allocate({ lines }, snapshot, { allowSplit });
        const second = allocate({ lines: lines.map((l) => ({ ...l })) }, snapshot, { allowSplit });
        expect(second).toEqual(first);
      }),
      { numRuns: 200 },
    );
  });

  it("P5: allowSplit=false gives at most 1 shipment", () => {
    fc.assert(
      fc.property(orderLinesArb, (lines) => {
        const decision = allocate({ lines }, snapshot, { allowSplit: false });
        expect(decision.shipments.length).toBeLessThanOrEqual(1);
      }),
      { numRuns: 200 },
    );
  });

  it("P6: every shipment has >= 1 item and positive item quantities", () => {
    fc.assert(
      fc.property(orderLinesArb, fc.boolean(), (lines, allowSplit) => {
        const decision = allocate({ lines }, snapshot, { allowSplit });
        for (const shipment of decision.shipments) {
          expect(shipment.items.length).toBeGreaterThanOrEqual(1);
          for (const item of shipment.items) {
            expect(item.quantity).toBeGreaterThanOrEqual(1);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
