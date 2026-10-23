# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org) (see `docs/VERSIONING.md`).

## [Unreleased]

## [1.0.1] - 2026-10-23

Post-submission review fixes, before the submission email (engine `1.0.2`). Seed data, URL and endpoints unchanged.

### Security
- The page served by Vercel's CDN now gets the same security headers as the API (CSP, `X-Frame-Options`, `nosniff`, …) via `vercel.json`; a test keeps the two in sync with helmet.
- All `GET` and `HEAD` API routes are rate-limited (300/min/IP by default, 5× the POST limit); before, only `POST /allocations` was.
- CI runs with a read-only `GITHUB_TOKEN`.

### Fixed
- Engine `1.0.2` (wording and rounding only; no seed-data allocation or cost changes):
  - On an exact cost tie the split summary said "cheaper than one shipment"; it now says "same cost … but the longest trip is shorter".
  - `whyNot` said "one extra shipment" for alternatives with 2+ extra shipments (e.g. P001×651).
  - The cold-chain sentence read "only  have both…" when no warehouse qualifies.
  - Decimal distances printed as `19.700000000000003 km`; costs, deltas and savings are rounded to 0.1 (UI cost breakdown too).
  - `1 units` → `1 unit`, with matching `is`/`are`.
- The saved-decision dialog showed the in-browser response when the stored one failed to load; it now shows the error.
- Unhandled programming errors are logged with route and stack (DB and system errors still log the code only); a failed health check is logged with its code.

### Changed
- CI runs the database integration tests against a Postgres 18 service.

## [1.0.0] - 2026-10-23

### Added
- **Stock reference** button in the header scrolls to the stock table and focuses its heading (honours reduced motion).
- How it decides, the stock table note and the README say that cold-chain stock without refrigerated vans counts as 0, and why.
- Tests for the header button, the cold-chain note and the G05 cost line.

### Changed
- Docs mark the time-aware bonus (FR-11/12, ADR-008, travel model) as not built; spec and architecture show engine `1.0.1`.

## [0.4.0] - 2026-10-23

### Added
- Pure display formatting module (`public/format.js`) with JSDoc type checking and unit tests (`test/ui/format.test.ts`), covering product labels (`P00X · Name`), cold-chain exclusion mapping, alternative `whyNot` splitting, plain-arithmetic cost breakdowns across all golden cases, shippable stock calculation, duplicate line detection, stock cell descriptors, warehouse decision roles, and `curl` command generation.
- Decision panel detail toggle (`Simple | Full | Debug`, persisted in `localStorage`), status badge hint (`all units allocated` / shortfall count), plain-arithmetic cost breakdown, compact cold-chain exclusions table, de-duplicated alternative `whyNot` column, and focus/scroll management on `#result-heading`.
- Order builder enhancements: single customer location note, visible example captions, per-line `❄ Cold chain` badge and shippable stock hint, duplicate product merge banner, split-shipment policy help (`aria-describedby`), and live running summary.
- Transposed `Products × Warehouses` stock reference table (with persisted orientation toggle), readable zero (`—`) and cold-ineligible (`can't ship cold`) cells, and live decision highlights on ordered product rows, chosen warehouse columns, and allocated cells (`qty → ships X`).
- Four native `<dialog>` modals (`showModal()` with `Esc`, Close button, backdrop click, body scroll lock, and opener focus restoration): **How it decides** (`#rules-modal`), **Warehouse detail** (`#warehouse-modal`, opened from any warehouse ID button), **Saved decision JSON** (`#saved-decision-modal`), and **API call** (`#api-call-modal` with **Copy as curl**).
- Responsive 1-, 2-, and 3-column CSS Grid layout (`< 768 px` phone card layout, `768–1099 px` single column, `1100–1439 px` two columns with sticky order card, `≥ 1440 px` three columns separating Order, Decision, and Why), plus GitHub repo and API docs links in the footer.

### Changed
- Simplified shipment cost wording across the UI and engine explanations (`ENGINE_VERSION = "1.0.1"`) to use "distance" and "20 km per shipment" uniformly.

## [0.3.0] - 2026-10-18

### Added
- Vanilla HTML/CSS/JS web UI (`public/index.html`, `public/styles.css`, `public/app.js`) served locally via optional `publicDir` in `createApp`: dynamic 1–20 line order builder, split-shipment toggle, three golden example buttons (`G03`, `G09`, `G05`), accessible `aria-live` decision view (status badge, shipments, shortfalls, reasons, exclusions, alternatives, persisted decision link, raw JSON), warehouse stock matrix, and `/api/v1/health` footer.
- Static UI and CSP hygiene test suite (`test/api/static.test.ts`).
- Vercel serverless function entry (`api/index.ts`), `vercel.json` routing/region config (`sin1`), weekly keep-alive workflow (`.github/workflows/keepalive.yml`), and unit tests for config version loading (`test/config.test.ts`), Vercel entry (`test/api/vercel-entry.test.ts`), and pool idle error handling (`test/db/pool.test.ts`).
- Live demo URL and walkthrough in `README.md`.

### Changed
- Local Docker database is Postgres 18 (matches Neon); existing clones get a fresh `pgdata18` volume and must re-run `npm run db:migrate && npm run db:seed`.
- Replaced runtime `readFileSync` of `package.json` in `src/config.ts` with a static JSON module import for Vercel serverless bundle compatibility.
- Upgraded GitHub Actions (`actions/checkout@v7`, `actions/setup-node@v7`) to the Node 24 runtime and pinned `ubuntu-24.04` in `.github/workflows/ci.yml`.

### Fixed
- Idle database client errors are logged instead of crashing the process (local server and Vercel function).
- Resolved `.env` and `.env.example` paths relative to the script directory (`import.meta.dirname`) in `scripts/setup.mjs`.

## [0.2.0] - 2026-10-18

### Added
- Express 5 HTTP API (`/api/v1/health`, `/api/v1/catalog`, `POST /api/v1/allocations`, `GET /api/v1/allocations/:id`) with strict Zod request validation, rate limiting, and uniform error middleware (`src/api/**`).
- PostgreSQL persistence layer (`src/db/**`), initial schema migration (`db/migrations/0001_init.sql`), forward-only migrator (`db/migrate.ts`), and idempotent catalogue/history seeder (`db/seed.ts`).
- Supertest API test suite with in-memory repository stubs (`test/api/*.test.ts`) and opt-in PostgreSQL integration tests (`test/db/integration.test.ts`).
- Local development database: PostgreSQL 16 via `docker-compose.yml` (port 5433), one-command bootstrap `npm run setup` (`scripts/setup.mjs`), and `db:up` / `db:down` / `test:db` scripts. Neon is used only for the online preview (ADR-011).

## [0.1.0] - 2026-10-17

### Added
- Pure warehouse allocation engine (M1, `ENGINE_VERSION = "1.0.0"`): line normalisation, cold-chain and stock eligibility with exclusion tracking (`NO_COLD_FLEET`, `NO_COLD_STORAGE`), exhaustive subset enumeration and lexicographic ranking, deterministic explanation templates (`summary`, `reasons`, `alternatives[].whyNot`), and `StrategyNotAvailableError` for `time-aware` prior to M4.
- Engine test suite: 16 golden distance/no-split scenarios, property-based tests P1–P6 (`fast-check`, 200 runs each), edge-case unit tests, and static engine purity verification (`test/purity.test.ts`).
- Explanation test suite (`test/engine/explain.test.ts`) and refined explanation synthesis enforcing 2–6 `reasons` sentences, accurate eligible stock totals, single-shipment shortfall attribution, merged cold-chain/warehouse exclusions, and truthful nearest-warehouse phrasing.

## [0.0.1] - 2026-10-16

### Added
- Planning docs: PRD, algorithm spec, travel-model spec, API contract, architecture, decision log, roadmap, versioning policy.
- Canonical seed data (`data/seed.json`), normalised delivery history (`data/delivery_history.csv`) and golden test fixtures (`test/fixtures/golden.json`).
- Project scaffolding (M0): TypeScript strict ESM config, Vitest with v8 coverage, oxlint, Prettier, GitHub Actions CI workflow and confidential brief-leak check (`scripts/check-no-brief.sh`).
