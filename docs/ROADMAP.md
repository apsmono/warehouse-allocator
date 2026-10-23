# Roadmap

One milestone = one handoff (`.agents/handoff/` in this project). The executor never starts the
next milestone on its own.

## Calendar — deadline Sun 25 Oct 2026, send Sat 24 Oct

| Day | Work | Who |
|---|---|---|
| Fri 16 | Planning docs ✓ | Claude |
| Sat 17 | Arif finishes the ADR review → promote and run M0+M1 | Arif · Antigravity |
| Sun 18 | Review M1, fix, tag `v0.1.0`; write the M2 plan | Claude · Antigravity |
| Mon 19 | M2 API + DB. **Create Vercel + Neon accounts today** (human step, needs GitHub login) | Antigravity · Arif |
| Tue 20 | M3 UI + deploy. Deploy a hello-world first, before building the UI | Antigravity |
| Wed 21 | Review M3 → `v0.3.0` = **core submittable**. **Bonus go/no-go gate (evening)** | Claude · Arif |
| Thu 22 | M4 = UI/UX polish (time-aware bonus dropped 2026-10-19) | Antigravity |
| Fri 23 | Review M4 → `v0.4.0` ✓; M5 plan | Claude · Arif |
| Sat 24 | M5: final README, interview prep, prod smoke test, tag `v1.0.0`, **send the email** | Arif |
| Sun 25 | Buffer only. No new work | — |

**Gate rule:** if `v0.3.0` is not deployed and passing by Wed 21 evening, M4 is dropped and the
bonus becomes a "next steps" paragraph. A solid core beats a half bonus.
**ADR changes:** if Arif changes a decision (e.g. the overhead value), Claude regenerates
`golden.json` and updates the spec. The executor never adjusts expected values itself.

```
M0 scaffold ─► M1 engine ─► M2 API+DB ─► M3 UI+deploy ══► (core done, submittable)
                                                         └─► M4 UI/UX ─► M5 submit v1.0.0
```

---

## M0 — Scaffold → `v0.0.1` (~1 h)
- `git init`, `.gitignore` (already provided), package.json, tsconfig (strict, ESM, NodeNext), `.nvmrc`, oxlint, prettier
- Scripts: `dev`, `build`, `typecheck`, `lint`, `format`, `test`, `test:cov`, `db:migrate`, `db:seed`
- CI `ci.yml`: install → typecheck → lint → test → **brief-leak grep** (AGENTS.md §6)
- `test/purity.test.ts` (it can pass trivially until the engine exists)

**Accept:** `npm ci && npm run typecheck && npm run lint && npm test` exit 0 · CI workflow added (first green run happens on the first push, which is not part of M0/M1) ·
`git status` shows `.private/` and `submission/` untracked and ignored.

## M1 — Allocation engine → `v0.1.0` (~4–6 h)
- `src/engine/*` per ALGORITHM.md. No DB, no HTTP.
- A seed loader for tests that reads `data/seed.json` into a `CatalogSnapshot`.
- Tests: every `golden.json → distance` and `noSplit` case; properties P1–P6 with fast-check (200 runs); an `UNFULFILLABLE` case with a stub snapshot; purity test.

**Accept:** all 16 distance/no-split golden cases pass · coverage of `src/engine` ≥ 90 % ·
`strategy: "time-aware"` throws a typed `StrategyNotAvailable` error · `reasons` for G03 contains a
sentence naming W02 and refrigerated vans.

## M2 — API + Postgres → `v0.2.0` (~4 h)
- `0001_init.sql`, `migrate.ts`, idempotent `seed.ts`
- `app.ts` factory, routes per API.md, Zod schemas, error middleware, helmet, rate limit, 10 KB body limit
- Decision persistence; DB failure degrades to `200` + `id: null`
- API tests with supertest and a stubbed repo (no live DB in CI). One opt-in integration test runs when `DATABASE_URL` is set

**Accept:** every API.md example reproduces with curl locally · the 422 cases (unknown product,
qty 0, qty 1.5, 21 lines, missing `dispatchAt` once M4 exists, unknown key) each return the
documented shape · `GET /allocations/not-a-uuid` → 404 · re-running seed changes nothing.

## M3 — UI + deploy → `v0.3.0` (~3–4 h) · **core complete**
- `public/index.html`: order lines (product select + qty, add/remove), "Allow split shipments"
  checkbox, Submit. The result panel shows a status badge, summary, a shipment cards table, reasons
  list, "Why not…" (excluded + alternatives), and a collapsible raw JSON view. A stock reference
  table comes from `/catalog`.
- Three "Try an example" buttons: G03 (cold-chain trap), G09 (split beats far), G05 (partial).
- Footer: app version, engine version, commit SHA.
- Repo `README.md`: add the description and walkthrough (ADR-009).
- Accessible basics: labels, keyboard-submittable, visible focus, works at 360 px wide.
- Deploy per ARCHITECTURE.md §5 and set up `keepalive.yml`.

**Accept:** in a fresh incognito window on the production URL, all three example buttons give the
golden results · `/api/v1/health` → `db: "ok"` · Lighthouse accessibility ≥ 90.

## M4 — UI/UX polish → `v0.4.0`, engine `1.0.1` ✓
The time-aware bonus was dropped on 2026-10-19 (gate decision: stay with distance); its design stays in
ADR-008 and TRAVEL-MODEL.md as "next steps". The slot went to the sample view instead: decision panel with
Simple/Full/Debug detail, order-builder hints, transposed stock table tied to the decision, four `<dialog>`
modals, 1/2/3-column responsive layout, and plain cost wording ("distance" + "20 km per shipment").

## M5 — Submission → `v1.0.0` (~2 h, mostly human)
- Finalise the repo `README.md` walkthrough against production (ADR-009); fill `submission/README.md`; finalise `submission/ai-collaboration-log.md`; Arif does `submission/interview-prep.md`
- Final smoke test on production; tag `v1.0.0`; GitHub release; switch on the freeze (VERSIONING §7)
- Email: URL, repo link, README attached, optional conversation log, cold-start note if Render was used

## Explicitly not planned (README "next steps" material)
time-aware strategy (ADR-008, TRAVEL-MODEL.md) · Stock reservation and concurrency (ADR-006) · selectable objective (ADR-008) · multiple customer
locations with real routing · admin CRUD · auth · ILP for large networks · refitting the model
offline on real volume.
