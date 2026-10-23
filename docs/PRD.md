# PRD — Warehouse Allocator

| | |
|---|---|
| Status | **Approved for build** (planning v1, 2026-10-16) |
| Owner | Arif Eko Pramono (applicant) · operated by Amalia |
| Planner / reviewer | Claude · Executor: Antigravity (Gemini) |
| Target release | `v1.0.0` = the build submitted to the reviewer |
| Deadline | **Sun 25 Oct 2026.** Target send: **Sat 24 Oct** (Sunday is buffer only) |

> The original challenge text lives in `.private/BRIEF.md` (git-ignored). **Never copy it into a
> tracked file, comment, commit message or the public README.** This PRD restates the requirements
> in our own words.

---

## 1. Problem

A medical-supply distributor moves stock from 8 warehouses to one customer location (a hospital,
clinic or pharmacy). When an order arrives (one or more products, each with a quantity), the system
must decide **which warehouse or warehouses fulfil it** and explain the decision in plain language.

## 2. Goals

| # | Goal | Measured by |
|---|---|---|
| G1 | Every decision is **correct**: it never ships a product from a warehouse that cannot legally or safely deliver it, and never allocates more than the stock on hand | Golden scenarios G01–G13 pass. Property tests: Σ allocated ≤ stock, cold-chain rule never violated |
| G2 | Every decision is **explainable**: a reviewer understands *why this warehouse* and *why not the obvious alternative* | Response has `summary`, `reasons[]`, `excluded[]`, `alternatives[]`. UI shows all four |
| G3 | Every decision is **deterministic and reproducible** | Same input gives byte-identical `decision` output. Decision log stores the request, the response and `engineVersion` |
| G4 | It is **deployed and stays up for 30+ days** after submission | Public URL. Weekly health check passes through day 35 |
| G5 | The **reasoning is defensible in interview**: Arif can explain every rule and trade-off without notes | Interview-prep checklist in `submission/` is complete |

## 3. Non-goals (v1.0)

- User accounts or authentication. The brief explicitly rules them out.
- Multiple customer locations or real geocoding/routing. There is one customer, and distances are given.
- **Committing or reserving stock.** v1 returns a *decision*; it does not decrement inventory (see DECISIONS.md, ADR-006).
- Admin CRUD for products, warehouses or stock. Seed data only.
- Pricing, invoicing and delivery scheduling beyond an estimated travel time.
- Any LLM or AI call at runtime. Explanations are deterministic templates.
- Mobile app, i18n, a polished design system. "Simple UI" means simple.

## 4. Users

| User | Need |
|---|---|
| **Reviewer at the company** (the real user) | Opens the URL, types an order, sees a sensible decision with a clear why, then reads the code and README |
| Dispatcher (fictional, shapes the UI) | Enters an order quickly and sees which vans go where |

## 5. Domain facts and assumptions

### 5.1 Given data
5 products (P001–P005) and 8 warehouses (W01–W08), each with a distance from the customer,
cold-storage and fleet capabilities, and stock levels. The canonical copy is `data/seed.json`.
Historical deliveries (38 rows) are in `data/delivery_history.csv`.

### 5.2 Assumptions (each must also appear in the submission README)

| ID | Assumption | Why |
|---|---|---|
| A1 | **Vaccines (P002, P004) need an unbroken cold chain.** A warehouse can ship them only if it has **both** refrigerated storage **and** refrigerated vans | Storage alone does not help if the vaccine warms up in a standard van. This rules out **W02 and W06**, which hold vaccine stock but have standard fleets |
| A2 | Cold-chain need is a **product attribute** (`requiresColdChain`), not derived from the category | Paracetamol is "Pharmaceutical" but is shelf-stable. Category is a poor proxy |
| A3 | Non-cold items may ride in a refrigerated van | Standard practice. It lets W04/W07/W08 ship mixed orders |
| A4 | Cost is **per shipment (per trip)**, not per unit. Each extra shipment has a fixed overhead: dispatch, a second receiving and QA check at the hospital, more paperwork | This is why a split is not free, and also why one 150 km trip does not automatically beat two short ones |
| A5 | Overhead = **20 km-equivalent** (distance strategy) or **30 minutes** (time-aware strategy) | 20 km ≈ 32 min at the observed metro off-peak rate (~1.6 min/km), so the two settings are consistent. Both are configurable constants |
| A6 | Stock figures are **current and accurate** at decision time | No reservation layer in v1 |
| A7 | When the order cannot be fully covered, **ship what can be shipped and report the shortfall per product** (status `PARTIAL`). Never silently drop a line | A hospital would rather get 108 vials now and know 12 are back-ordered than get nothing |
| A8 | Splitting is **allowed by default** but can be switched off per order (`allowSplit: false`). Some receivers accept one delivery only | Gives the reviewer a visible lever for the "can't cover from one warehouse" question |
| A9 | History records carry a weekday and a clock time only, with no date and no timezone. Times are local (WIB) | That is all the data has |

## 6. Functional requirements

| ID | Requirement | Priority | Milestone |
|---|---|---|---|
| FR-1 | Accept an order of 1–20 lines `{productId, quantity}`, with quantity an integer from 1 to 100 000. Merge duplicate product lines | Must | M1 |
| FR-2 | Reject invalid input with HTTP 422 and a field-level error list (unknown product, bad quantity, empty order, too many lines) | Must | M2 |
| FR-3 | Apply the eligibility rules (stock > 0, cold chain) and record **why** each warehouse was excluded for each ordered product | Must | M1 |
| FR-4 | Choose the warehouse set by the algorithm in `ALGORITHM.md`: maximise units filled, then minimise total cost, then apply the deterministic tie-breaks | Must | M1 |
| FR-5 | Return `status` (`FULL` / `PARTIAL` / `UNFULFILLABLE`), shipments, shortfalls, `summary`, `reasons[]`, `excluded[]` and the top-2 `alternatives[]` with their cost difference | Must | M1 |
| FR-6 | Option `allowSplit` (default `true`) | Must | M1 |
| FR-7 | Persist every decision (request, response, engine version, strategy) and expose it as `GET /api/v1/allocations/:id` | Should | M2 |
| FR-8 | `GET /api/v1/catalog` returns products, warehouses and stock, so the UI is not hard-coded | Must | M2 |
| FR-9 | Simple web UI: add/remove order lines, toggle split, submit, show decision, reasons, exclusions and alternatives. Show stock reference | Must | M3 |
| FR-10 | `GET /api/v1/health` returns app version, git SHA and DB reachability | Must | M2 |
| FR-11 | **Bonus**: time-aware strategy. With `strategy: "time-aware"` and `dispatchAt {day, time}`, cost uses travel minutes predicted from history (`TRAVEL-MODEL.md`). Each shipment shows predicted minutes, the data source and the sample size | Could — **not built** | — (dropped 2026-10-19) |
| FR-12 | **Bonus**: `GET /api/v1/travel-model` exposes baselines, multipliers and sample sizes for transparency | Could — **not built** | — (dropped 2026-10-19) |

## 7. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | Engine latency < 50 ms for 8 warehouses (2^8 = 256 subsets). API p95 < 500 ms when warm |
| NFR-2 | The engine is a **pure function**: no I/O, no clock, no randomness. It takes `(order, catalogSnapshot, options)` and returns a decision |
| NFR-3 | Abuse limits: JSON body ≤ 10 KB; 60 requests per minute per IP on POST; at most 20 lines |
| NFR-4 | TypeScript `strict`. No `any` in `src/engine/**` |
| NFR-5 | Test coverage of `src/engine/**` ≥ 90 % lines. All golden fixtures pass |
| NFR-6 | Free-tier hosting that **does not expire within 35 days** (see ADR-003) |
| NFR-7 | The repo contains **no confidential brief text**. A CI step greps for marker phrases kept outside the repo (AGENTS.md §6) |
| NFR-8 | All user-facing text and docs are in English |

## 8. Success criteria for `v1.0.0` (Definition of Done)

- [ ] All Must FRs are implemented, and every golden scenario passes in CI
- [ ] Deployed URL works from a fresh browser: order G07 (HepB 10 + gloves 100) shows W01 + W04 and names W02 as excluded for "no refrigerated fleet"
- [ ] `GET /api/v1/health` returns `200` with `db: "ok"`
- [ ] The repo README has a short description, a walkthrough (UI, one API example, the three example orders) and setup / run / test / deploy; no design essay, no brief text (ADR-009)
- [ ] `submission/README.md` is complete: approach, assumptions A1–A9, AI-assisted parts with what was corrected or debated, next steps, URL plus cold-start note
- [ ] The `v1.0.0` tag and GitHub release exist; CHANGELOG is updated
- [ ] Arif has done the interview-prep walkthrough (`submission/interview-prep.md`)

## 9. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Free DB or host deletes or pauses the project within the 30-day window | Reviewer sees a dead link | Neon free tier (no inactivity deletion) plus a weekly GitHub Actions health ping. Do **not** use Render Postgres (expires after 30 days) or Supabase free (pauses after 7 idle days) |
| Executor drifts (extra features, a new framework, rewritten spec) | Sprawling diff, missed deadline | AGENTS.md dependency allowlist, read-only spec files, one milestone per handoff |
| Bonus eats the time needed for the core | Weak core | M4 starts only after M3 is deployed and tagged `v0.3.0` |
| AI-written code Arif cannot explain | Fails the interview | Interview-prep doc, plus an AI log kept *during* the build, not reconstructed afterwards |
| Brief leaked into the public repo | Breaks the confidentiality request | `.private/` is git-ignored, plus the CI grep check |

## 10. Related docs

`ALGORITHM.md` · `TRAVEL-MODEL.md` · `API.md` · `ARCHITECTURE.md` · `DECISIONS.md` ·
`ROADMAP.md` · `VERSIONING.md` · `../AGENTS.md`
