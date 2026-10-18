import type pg from "pg";
import type { Decision, DispatchAt, OrderLine, Strategy } from "../engine/types.js";

export type StoredAllocationRequest = {
  lines: OrderLine[];
  options: {
    allowSplit: boolean;
    strategy: Strategy;
    dispatchAt?: DispatchAt;
  };
};

export type InsertDecisionInput = {
  request: StoredAllocationRequest;
  decision: Decision;
};

export type InsertDecisionResult = {
  id: string;
  createdAt: string;
};

export type StoredDecisionRecord = {
  id: string;
  createdAt: string;
  request: StoredAllocationRequest;
  decision: Decision;
};

export type DecisionsRepository = {
  insert(input: InsertDecisionInput): Promise<InsertDecisionResult>;
  getById(id: string): Promise<StoredDecisionRecord | null>;
};

export function createDecisionsRepo(pool: pg.Pool): DecisionsRepository {
  return {
    async insert({ request, decision }: InsertDecisionInput): Promise<InsertDecisionResult> {
      const result = await pool.query<{ id: string; created_at: Date }>(
        `INSERT INTO allocation_decisions (
           engine_version,
           strategy,
           status,
           request,
           decision
         )
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
         RETURNING id, created_at`,
        [
          decision.meta.engineVersion,
          decision.strategy,
          decision.status,
          JSON.stringify(request),
          JSON.stringify(decision),
        ],
      );

      const row = result.rows[0]!;
      return {
        id: row.id,
        createdAt: row.created_at.toISOString(),
      };
    },

    async getById(id: string): Promise<StoredDecisionRecord | null> {
      const result = await pool.query<{
        id: string;
        created_at: Date;
        request: StoredAllocationRequest;
        decision: Decision;
      }>(
        `SELECT id, created_at, request, decision
         FROM allocation_decisions
         WHERE id = $1`,
        [id],
      );

      const row = result.rows[0];
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        createdAt: row.created_at.toISOString(),
        request: row.request,
        decision: row.decision,
      };
    },
  };
}
