# warehouse-allocator

Chooses which warehouse(s) should fulfil a medical-supply order, and explains why.

> **Status:** planning complete, implementation not started. See `docs/ROADMAP.md`.

This README covers a short description, a walkthrough, and setup, running, testing and deployment
(the walkthrough is added once the UI exists). The design rationale lives in `docs/` (PRD, ALGORITHM, DECISIONS).

## Requirements
- Node.js 22 (`nvm use`)
- Docker Desktop (or another Docker engine with Compose v2) for local PostgreSQL 16

## Setup
```bash
npm run setup      # Node 22 check, npm ci, .env from example, docker compose up --wait, migrate, seed
npm run dev        # http://localhost:3000
```

**Using Neon instead:** replace `DATABASE_URL` in `.env`, then run `npm run db:migrate && npm run db:seed`.

## Test
```bash
npm test           # unit + API tests (no DB needed, same as CI)
npm run test:db    # integration tests against the local Docker database
npm run typecheck && npm run lint && npm test
npm run test:cov   # engine coverage report
```

## API
See `docs/API.md`. Quick check:
```bash
curl -s localhost:3000/api/v1/health
curl -s -X POST localhost:3000/api/v1/allocations \
  -H 'content-type: application/json' \
  -d '{"lines":[{"productId":"P002","quantity":10},{"productId":"P001","quantity":100}]}'
```

## Deploy
See `docs/ARCHITECTURE.md §5` (Vercel + Neon).
