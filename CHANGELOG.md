# Changelog

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) · Versioning: [SemVer](https://semver.org) (see `docs/VERSIONING.md`).

## [Unreleased]

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
