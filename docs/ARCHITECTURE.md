# Architecture

## 1. Stack (locked; changing it requires an ADR in DECISIONS.md)

| Layer | Choice | Version policy |
|---|---|---|
| Runtime | Node.js **22 LTS** | `.nvmrc` = `22`; `"engines": {"node": ">=22 <23"}` |
| Language | TypeScript, `strict: true`, ESM | latest 5.x |
| HTTP | **Express 5** | Async errors propagate natively, so no wrapper helpers |
| Validation | **Zod** | Schemas in `src/api/schemas.ts` are the single source of request types |
| Database | PostgreSQL 18: Docker locally, Neon (free tier) online | Local: compose URL. Online: Neon pooled URL |
| DB access | **`pg` (node-postgres) with plain SQL**, no ORM | Migrations are numbered `.sql` files |
| UI | **Static HTML + vanilla JS + one CSS file**, served from `public/` | No framework, no bundler |
| Tests | **Vitest** + **supertest** | |
| Lint/format | oxlint + Prettier | Same as `tower-planner` |
| Hosting | **Vercel** (Express app as a serverless function plus static `public/`) | Same pattern as `peta-gudang` |
| CI | GitHub Actions | |

Allowed runtime deps: `express`, `zod`, `pg`, `express-rate-limit`, `helmet`. Allowed dev deps:
`typescript`, `tsx`, `vitest`, `@vitest/coverage-v8`, `supertest`, `@types/*`, `oxlint`,
`prettier`, `fast-check`. **Nothing else without asking.**

## 2. Layout

```
warehouse-allocator/
├── AGENTS.md                 executor rules (read first)
├── README.md                 description, walkthrough, setup / run / test / deploy (ADR-009)
├── CHANGELOG.md
├── package.json  tsconfig.json  .nvmrc  .oxlintrc.json  .prettierrc  vercel.json  docker-compose.yml
├── scripts/
│   └── setup.mjs             one-command local bootstrap (Node 22 check, npm ci, .env, Docker DB, migrate, seed)
├── data/
│   ├── seed.json             canonical products, warehouses, stock   (READ-ONLY)
│   └── delivery_history.csv  normalised history                      (READ-ONLY)
├── db/
│   ├── migrations/0001_init.sql
│   └── seed.ts               loads data/seed.json + CSV into Postgres (idempotent upsert)
├── src/
│   ├── engine/               PURE. No imports from api/, db/, node:fs, pg, express
│   │   ├── allocate.ts       the algorithm (ALGORITHM.md)
│   │   ├── eligibility.ts
│   │   ├── explain.ts        templates → summary / reasons / whyNot
│   │   ├── travel-model.ts   fit() + predict() (TRAVEL-MODEL.md) — not built
│   │   ├── types.ts
│   │   └── version.ts        export const ENGINE_VERSION = "1.0.2"
│   ├── db/
│   │   ├── pool.ts           single pg Pool, lazy init
│   │   ├── catalog.repo.ts   loadSnapshot(): CatalogSnapshot
│   │   ├── history.repo.ts   — not built
│   │   └── decisions.repo.ts insert / getById
│   ├── api/
│   │   ├── app.ts            express app factory (no listen) — used by tests and Vercel
│   │   ├── routes/*.ts
│   │   ├── schemas.ts
│   │   └── errors.ts         error middleware → API.md error shape
│   ├── config.ts             reads env once, validates with Zod, exports frozen config
│   └── server.ts             local dev: app.listen(PORT)
├── api/index.ts              Vercel entry: export default app
├── public/  index.html  app.js  styles.css
├── test/
│   ├── fixtures/golden.json  (READ-ONLY)
│   ├── engine/*.test.ts      golden + property tests, no DB
│   ├── api/*.test.ts         supertest against app with an in-memory snapshot stub
│   └── purity.test.ts        fails if src/engine/** imports a forbidden module
└── .github/workflows/  ci.yml  keepalive.yml
```

**Dependency direction:** `api → engine`, `api → db`, `db → engine/types`. The engine never imports
upward. The API loads the snapshot once per request (8 warehouses, so it is cheap and always fresh).
The time-aware travel model (not built) would be fitted once per cold start and cached in module scope.

## 3. Data model (`0001_init.sql`)

```sql
CREATE TABLE products (
  id                  text PRIMARY KEY CHECK (id ~ '^P[0-9]{3}$'),
  name                text NOT NULL,
  category            text NOT NULL,
  requires_cold_chain boolean NOT NULL
);
CREATE TABLE warehouses (
  id               text PRIMARY KEY CHECK (id ~ '^W[0-9]{2}$'),
  city             text NOT NULL,
  distance_km      numeric(6,1) NOT NULL CHECK (distance_km >= 0),
  has_cold_storage boolean NOT NULL,
  has_cold_fleet   boolean NOT NULL,
  CHECK (NOT has_cold_fleet OR has_cold_storage)   -- a reefer fleet without cold storage is not modelled
);
CREATE TABLE inventory (
  warehouse_id text NOT NULL REFERENCES warehouses(id),
  product_id   text NOT NULL REFERENCES products(id),
  quantity     integer NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY (warehouse_id, product_id)
);
CREATE TABLE delivery_history (
  id           text PRIMARY KEY,
  warehouse_id text NOT NULL REFERENCES warehouses(id),
  day_of_week  text NOT NULL CHECK (day_of_week IN ('Mon','Tue','Wed','Thu','Fri','Sat','Sun')),
  depart_time  time NOT NULL,
  duration_min integer NOT NULL CHECK (duration_min > 0),
  note         text
);
CREATE TABLE allocation_decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  engine_version text NOT NULL,
  strategy       text NOT NULL CHECK (strategy IN ('distance','time-aware')),
  status         text NOT NULL CHECK (status IN ('FULL','PARTIAL','UNFULFILLABLE')),
  request        jsonb NOT NULL,
  decision       jsonb NOT NULL
);
CREATE INDEX allocation_decisions_created_at_idx ON allocation_decisions (created_at DESC);
CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
```

Migrations are forward-only. `db/migrate.ts` applies unapplied files in one transaction each and
records them in `schema_migrations`. Seeding is an idempotent upsert (`ON CONFLICT … DO UPDATE`), so
re-running it resets demo stock to the seed values.

## 4. Configuration

| Env var | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Local: the compose URL from `.env.example`. Online: Neon **pooled** URL, `sslmode=verify-full`. |
| `PORT` | no | Local only, default 3000 |
| `RATE_LIMIT_PER_MIN` | no | Default 60 |
| `VERCEL_GIT_COMMIT_SHA` | auto | Shown in `/health` and the UI footer |

`.env.example` is committed; `.env` / `.env.local` never are.

## 5. Deployment

0. Local development needs no Neon; see `README.md` (`## Setup`) for the local Docker workflow.
1. CI leak check: set the `LEAK_MARKERS` repository secret (`gh secret set LEAK_MARKERS -R apsmono/warehouse-allocator < .private/leak-markers.txt`).
2. Neon: create a PostgreSQL 18 database in the Singapore region (`ap-southeast-1`), copy the **pooled** URL, and run `npm run db:migrate && npm run db:seed` against Neon via a shell `DATABASE_URL` override (keeping local `.env` pointed at `postgresql://wa:wa@localhost:5433/warehouse_allocator`).
3. Vercel: import `apsmono/warehouse-allocator` with framework preset **Other** (build/output left at defaults so `vercel.json` governs them and pins `sin1`), set `DATABASE_URL` to the Neon pooled URL for **Production and Preview** with `sslmode=verify-full` and `channel_binding=require`, and turn **Vercel Authentication off** under Deployment Protection.
4. `.github/workflows/keepalive.yml`: weekly cron (`17 2 * * 1`, Mon 02:17 UTC) plus `workflow_dispatch` that curls `<PROD_URL>/api/v1/health` with retries (`--retry 3 --retry-delay 20 --retry-all-errors`) to surface breakage and keep Neon warm.
5. Fallback if Vercel misbehaves with Express: Render free web service. **It sleeps after 15 min idle
   (~1 min cold start), which must then be stated in the submission email.**
