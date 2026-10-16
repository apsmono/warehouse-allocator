# AGENTS.md — warehouse-allocator

Group: **Projects** (independent, so GetGoing's Variable Continuity rules do not apply).
Planner/reviewer: Claude. Executor: you (Antigravity). Handoffs: `.agents/handoff/` in this project (protocol: `~/Developer/.agents/handoff/README.md`).

## 1. Read before any work, in this order
1. The active handoff plan (`ACTIVE.md`). It defines *this* task's scope.
2. `docs/PRD.md` → `docs/ALGORITHM.md` → `docs/ARCHITECTURE.md` → `docs/API.md`
3. `docs/VERSIONING.md` before committing; `docs/TRAVEL-MODEL.md` only in M4.

## 2. Scope discipline
- Do **only** the milestone in the active plan. Do not start the next one, even if it "only takes a minute".
- Touch only files listed under the plan's *Files in scope*. If another file must change, stop and explain in REPORT.md.
- No drive-by refactors, renames or reformatting of files you were not asked to touch.

## 3. Read-only files (never edit)
`docs/**` · `data/seed.json` · `data/delivery_history.csv` · `test/fixtures/golden.json` ·
`.private/**` · `submission/**` · this file.
If you believe a spec or fixture is wrong, **do not "fix" the test or the fixture to make it pass.**
Write the disagreement, with the input, expected and actual output, into REPORT.md and stop.

## 4. Stack lock
Exactly the stack and dependency allowlist in `docs/ARCHITECTURE.md §1`. No other packages, no
ORM, no UI framework, no bundler, no CSS framework. Need something else? Ask in REPORT.md.

## 5. Engine rules
- `src/engine/**` is pure: it must not import `pg`, `express`, `node:fs`, `node:http`, `../db`,
  `../api`; it must not call `Date.now`, `new Date()`, `Math.random`, `process.env` or `console.*`.
  `test/purity.test.ts` enforces this.
- Deterministic tie-breaks exactly as ALGORITHM.md §2 Step 4. Never depend on object-key or `Set` iteration order for ranking.
- No `any`. Domain types live in `src/engine/types.ts`.
- **No LLM or AI calls anywhere at runtime.**

## 6. Confidentiality
- Never copy text from `.private/BRIEF.md` into a tracked file, code comment, test name, commit message or the repo README.
- Do not put the hiring company's name in tracked files.
- CI runs `scripts/check-no-brief.sh`, which fails if any tracked file contains a marker phrase
  (case-insensitive). The phrases are **not** stored in the repo, since listing them would leak them:
  the script reads them from the `LEAK_MARKERS` env var (a GitHub Actions secret, newline-separated)
  or, locally, from `.private/leak-markers.txt`. If neither exists it prints a warning and exits 0.
- `.private/`, `submission/`, `.env*` (except `.env.example`) must stay git-ignored.

## 7. Git
- Conventional Commits (docs/VERSIONING.md §3). Commit after each plan step that passes its checks.
- Work on the branch the plan names. **Do not push, tag or merge to `main` unless the plan says so.**
- Never commit `node_modules/`, `dist/`, `.vercel/` or coverage output.

## 8. Quality bar before writing REPORT.md
```
npm run typecheck && npm run lint && npm test
```
All three must exit 0. Paste the tail of their output into REPORT.md, with **actual** numbers
(tests passed, coverage %), not "all good".

## 9. REPORT.md must contain
Status (DONE / BLOCKED / PARTIAL) · files touched (from `git diff --stat`) · how each acceptance
criterion was verified · deviations from the plan and why · open questions · anything you
noticed but deliberately did not do.

## 10. Style
English everywhere. Small functions. Errors are typed classes mapped to API.md codes in one
middleware. No commented-out code. Comments explain *why*, not *what*.
