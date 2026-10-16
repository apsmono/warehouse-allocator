# Decision Log (ADRs)

Each ADR records **one** decision in a fixed order: **Status → Context → Decision → Consequences**,
plus **Alternatives considered** where there were real ones.

Status values:
- `Proposed`: planner suggestion, no human verdict yet.
- `Accepted (date)`: the human owner (Arif / Amalia) agreed. A later change is either noted in place
  as an amendment or recorded as a new ADR.
- `Superseded by ADR-x`: replaced; kept for history.

**Every `Proposed` ADR needs an explicit agree / change / reject before v1.0.0**, and the outcome
goes into `submission/ai-collaboration-log.md`. That log is the honest raw material for the
submission README's "AI-assisted" section.

## Status summary (2026-10-16)

| ADR | Decision | Status | Needed by |
|---|---|---|---|
| 001 | Stack: TypeScript + Express + Postgres | Accepted | M0 |
| 002 | Exhaustive subset search | Accepted | M1 |
| 003 | Hosting: Vercel + Neon | Accepted | M2/M3 |
| 004 | Cold chain needs storage AND fleet | Accepted | M1 |
| 005 | Per-shipment overhead (20 km-eq / 30 min) | Accepted | M1 |
| 006 | Decision only, no stock reservation | Accepted (for now) | M5 (README "next steps") |
| 007 | Deterministic template explanations | Accepted | M1 |
| 008 | Time-aware objective = vehicle-minutes | Accepted | M4 |
| 009 | Public repo; two READMEs | Accepted (amended) | First push |
| 010 | Vanilla HTML UI | Accepted | M3 |

---

## ADR-001 Stack: TypeScript + Express + Postgres, not Rails
**Status.** Accepted (2026-10-16)

**Context.** The company's own stack leans Rails + Vue; the job ad lists Rails / Node / NestJS as
nice-to-haves. Arif's production experience is Node/TypeScript (GetGoing), his SQL evidence is
Postgres (tower-planner), and he has built an Express service before (peta-gudang). Rails and
NestJS are both zero. The challenge leaves the stack open but expects the choice to be explained.

**Decision.** Build in the strongest stack, because correctness and explainability are being
graded, not framework choice.

**Consequences.** Interview answer: "I picked what I could make correct and defend line by line in
the time. The engine is a pure function with no framework coupling, so porting it to a Rails
service object is mechanical."

**Alternatives considered.** Rails: matches the company, but zero experience under a one-week
deadline. NestJS: adds a learning curve under deadline with no grading upside.

## ADR-002 Exhaustive subset search, not a greedy heuristic
**Status.** Accepted (2026-10-16)

**Context.** Warehouse selection is a small set-cover / facility-selection problem: 8 warehouses,
5 products, one customer location.

**Decision.** Enumerate all 2^8 − 1 subsets and rank them lexicographically (ALGORITHM.md §2).

**Consequences.** Provably optimal for the stated objective, trivially testable, fast (< 1 ms). It
does not scale past ~16 warehouses; the README names greedy or ILP as the next step.

**Alternatives considered.** Greedy nearest-first: simple, but can miss the best combination and
is harder to defend as "optimal". ILP solver: scales, but adds a dependency and is overkill at 255
subsets.

## ADR-003 Hosting: Vercel + Neon
**Status.** Accepted (2026-10-16)

**Context.** The deployment must stay up about 30 days after submission. Free-tier traps: Render
Postgres free **expires after 30 days**; Supabase free **pauses after 7 idle days**; Render web
services sleep (allowed, but a worse first impression).

**Decision.** Vercel (no sleep, cold start ≈ 1 s) + Neon free Postgres (scales to zero, does not
delete idle projects) + a weekly keep-alive health check.

**Consequences.** Express-on-Vercel must be verified in M3 on day one, not on submission day.
Verify Neon's current free-tier terms at signup.

**Alternatives considered.** Render (documented fallback; mention the cold start in the email).
Supabase free (rejected: 7-day idle pause).

## ADR-004 Cold chain needs storage AND fleet
**Status.** Accepted (2026-10-16). Golden cases G03 and G05 depend on it.

**Context.** Two warehouses (W02, W06) have refrigerated storage but standard vehicles, and they
hold vaccine stock. This looks deliberate in the data.

**Decision.** A vaccine is eligible only from a warehouse with both. W02/W06 vaccine stock is
excluded **and the exclusion is shown**, not hidden.

**Consequences.** This is the most likely "trap" in the challenge. The README should say: in
reality you might add a cold-van hand-off between warehouses, but that is out of scope.

**Alternatives considered.** Storage alone is enough: W02 (12 km) would then ship vaccines in a
standard van, breaking the cold chain. If chosen instead, `golden.json` must be regenerated before M1.

## ADR-005 Per-shipment overhead instead of "always prefer a single warehouse"
**Status.** Accepted (2026-10-16), value kept at 20 km-eq / 30 min. Changing it later means regenerating `golden.json` first.

**Context.** A rule like "single warehouse if possible, otherwise split" sends 350 paracetamol
90 km from Malang (W05) when W01 (5 km) + W04 (30 km) could do it.

**Decision.** cost = Σ (overhead + travel) per shipment, with overhead 20 km-eq (distance
strategy) / 30 min (time-aware strategy) (PRD A5).

**Consequences.** One tunable constant. G09 demonstrates it. The owner should be able to argue the
value: "20 km ≈ 30 min of city driving ≈ the cost of an extra dispatch and receiving check".

**Alternatives considered.** Single warehouse first (see Context). No overhead at all: splits
become free, so the engine would happily split across many warehouses for tiny gains.


## ADR-006 Decision only; no stock reservation in v1
**Status.** Accepted for now (2026-10-16), going with the planner's recommendation. Can be
revisited before M5 if time remains after M4; it feeds the submission README's "next steps".

**Context.** A real system would reserve stock when an order is confirmed (concurrency, double
allocation). The challenge asks for a *decision*.

**Decision.** No reservation. The demo stock stays constant, so every reviewer sees the
same results for 30 days.

**Consequences.** This is the strongest "next step" to talk about, and it is Arif's strength (data
correctness under concurrency): a `reservations` table, conditional `UPDATE … WHERE quantity >= $n`
in one transaction, an idempotency key on confirm, and expiry of unconfirmed holds.

**Alternatives considered.** Implement reservation in v1: shows concurrency skill, but costs about
a day and makes the demo stock drift as reviewers place orders, so they see different results.

## ADR-007 Explanations are deterministic templates, not LLM text
**Status.** Accepted (2026-10-16)

**Context.** Every decision must come with an explanation of why. This is a medical-supply
decision: the explanation has to match what the engine actually computed. Golden tests need
byte-stable output.

**Decision.** Generate `summary`, `reasons` and `whyNot` from structured data with templates. No
LLM or AI calls at runtime (AGENTS.md §5).

**Consequences.** Testable, free, no hallucinated justification. Less fluent wording is an
acceptable trade.

**Alternatives considered.** LLM-written explanations: more fluent, but non-deterministic, needs an
API key and cost, and can justify something the engine did not do.

## ADR-008 Time-aware objective = vehicle-minutes, with the arrival trade-off shown
**Status.** Accepted (2026-10-16). Applies to M4 (bonus) only.

**Context.** The bonus uses delivery history: travel time depends on weekday and hour (metro rush
hour roughly triples city trips). Once time is in play there are two reasonable objectives:
operator cost (total vehicle-minutes) or hospital waiting time (latest arrival). They disagree on
P005×350 at Mon 08:00 (TRAVEL-MODEL.md §4).

**Decision.** The time-aware strategy minimises total vehicle-minutes plus a 30-minute overhead per
shipment, the same structure as the distance strategy. The alternative that arrives sooner is
surfaced in `alternatives[]` with its arrival time, not hidden.

**Consequences.** One objective across both strategies keeps the engine simple. On Mon 08:00 it
picks W05 (one truck, 130 min) although W01+W04 would arrive sooner (70 min); the README states
this honestly. A selectable objective is a "next step".

**Alternatives considered.** Minimise latest arrival (service-time objective): arguably better
for urgent medical orders, deferred as a selectable option.

## ADR-009 Public repo, neutral name, challenge text kept out; two READMEs
**Status.** Accepted (2026-10-16), amended in review.

**Context.** Source must be on GitHub, public or with access granted. A public repo must not
contain the challenge text, and the challenge is confidential. The challenge also requires the
submission README (approach, assumptions, AI use, next steps) to be **attached to the reply
email, not committed**. In review, the owner asked that the repo still have a README with a
description and a walkthrough, so a reviewer landing on GitHub understands the project.

**Decision.**
- Repo `warehouse-allocator`, public, no company name anywhere in tracked files.
- **Repo `README.md` (committed):** a short description of what the system does, a walkthrough
  (using the UI, one API example, the three example orders), then setup / run / test / deploy.
  No design essay and no challenge text; it links to `docs/` for rationale.
- **Submission README (`submission/README.md`, git-ignored):** approach and reasoning,
  assumptions, AI-assisted parts, next steps. Attached to the email, never committed.
- Only structured data derived from the challenge (seed JSON, normalised CSV) is committed.

**Consequences.** Reviewers get orientation on GitHub without going against the
attach-not-commit instruction. Risk of duplication between the two READMEs: keep the repo one
short. The walkthrough is written at M3 (it needs the UI) and finalised at M5. PRD §8 and
ARCHITECTURE §2 updated to match.

**Alternatives considered.** Commit the full submission README (the first idea in review):
rejected, it goes directly against the instruction to attach it rather than commit it. Private
repo with reviewer access: avoids exposure, but needs their GitHub usernames.

## ADR-010 Vanilla HTML UI
**Status.** Accepted (2026-10-16)

**Context.** A UI is required, but only basic order input and result display. Grading weight is on
the backend. Arif's strongest UI skill is React.

**Decision.** A single static page (`public/index.html`) with plain HTML/CSS/JS, served by
Express. No framework, no build step.

**Consequences.** Matches the stack lock (AGENTS.md §4), keeps every hour on the backend. Must
still meet the accessibility basics in M3.

**Alternatives considered.** React + Vite: Arif's strength, but adds a build step and deploy
config for no grading gain.
