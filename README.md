# warehouse-allocator

Chooses which warehouse(s) should fulfil a medical-supply order, and explains why.

> **Status:** core complete and deployed. See `docs/ROADMAP.md`.

This README covers a short description, a walkthrough, and setup, running, testing and deployment.
The design rationale lives in `docs/` (PRD, ALGORITHM, DECISIONS).

## Live demo
https://warehouse-allocator-chi.vercel.app

## Requirements
- Node.js 22 (`nvm use`)
- Docker Desktop (or another Docker engine with Compose v2) for local PostgreSQL 18

## Setup
```bash
npm run setup      # Node 22 check, npm ci, .env from example, docker compose up --wait, migrate, seed
npm run dev        # http://localhost:3000
```

**Using Neon instead:** replace `DATABASE_URL` in `.env`, then run `npm run db:migrate && npm run db:seed`.

## Walkthrough
Run `npm run dev` and open `http://localhost:3000/` to build an order, inspect the stock reference table, or try the three built-in example scenarios (the same examples also work on the live demo at `https://warehouse-allocator-chi.vercel.app`):

- **Cold-chain trap (G03 — P002 × 10):** Fulfils `FULL` in one shipment from **W04** while excluding nearer warehouses **W02** and **W06** (`NO_COLD_FLEET`) because they lack refrigerated vans.
- **Split beats far (G09 — P005 × 350):** Fulfils `FULL` by splitting across nearby **W01 + W04** (total cost 75 km) instead of one shipment from **W05** (110 km).
- **Partial (G05 — P002 × 120):** Returns `PARTIAL` across all eligible cold-chain warehouses (**W04, W07, W08** for 108 units) and reports a shortfall of **12** units for **P002**.

API quick check (`docs/API.md`):
```bash
curl -s https://warehouse-allocator-chi.vercel.app/api/v1/health
curl -s -X POST https://warehouse-allocator-chi.vercel.app/api/v1/allocations \
  -H 'content-type: application/json' \
  -d '{"lines":[{"productId":"P002","quantity":10},{"productId":"P001","quantity":100}]}'
```
Expected G07 outcome: status `FULL` (total cost `75` km), splitting across **W01** (100 × `P001`) and **W04** (10 × `P002`), with **W02** (and **W06**) excluded for `P002` due to no refrigerated fleet (`NO_COLD_FLEET`).

## Test
```bash
npm run typecheck && npm run lint && npm test
npm run test:db    # integration tests against the local Docker database
npm run test:cov   # engine coverage report
```

## Deploy
See `docs/ARCHITECTURE.md §5` (Vercel + Neon).
