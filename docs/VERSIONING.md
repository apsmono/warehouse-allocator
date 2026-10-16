# Versioning & Change Control

## 1. Three version numbers, three meanings

| What | Where | Bumped when |
|---|---|---|
| **App version** (SemVer) | `package.json` → shown by `/api/v1/health` and the UI footer | Every milestone and release (table below) |
| **Engine version** (SemVer) | `src/engine/version.ts` → stored on every decision | Any rule change that alters output for some input: MAJOR = objective/ranking changed, MINOR = new strategy or option, PATCH = wording of explanations only |
| **API version** | URL prefix `/api/v1` | Only on a breaking contract change. None is planned |

DB schema version = the highest applied file in `db/migrations/` (tracked in `schema_migrations`).

## 2. Release plan

| Tag | Milestone | Meaning |
|---|---|---|
| `v0.0.1` | M0 | Scaffold: tooling, CI green, data files in place |
| `v0.1.0` | M1 | Engine complete; all distance + no-split golden tests pass (no API yet) |
| `v0.2.0` | M2 | API + Postgres + decision log; runs locally |
| `v0.3.0` | M3 | UI + **deployed**. Core requirement done (submittable) |
| `v0.4.0` | M4 | Bonus: time-aware strategy (engine `1.1.0`) |
| `v1.0.0` | M5 | **The submitted build.** Frozen |
| `v1.0.x` | post | Bug fixes only during the ~30-day review window |

Pre-1.0, MINOR = milestone and PATCH = fix within a milestone.

## 3. Commits — Conventional Commits

```
<type>(<scope>): <imperative summary, ≤ 72 chars>

[body: why, not what]
```
Types: `feat` `fix` `test` `refactor` `docs` `chore` `ci` `perf`.
Scopes: `engine` `api` `db` `ui` `model` `ci` `deps` `docs`.
One logical change per commit; tests go in the same commit as the code they cover.
**Never** put brief text, secrets or the company name in a commit message.

## 4. Branches

- `main` is always green and always deployable. Vercel deploys from it.
- Work happens on `m<N>/<slug>` (e.g. `m1/engine`), merged with `--no-ff` after the planner
  reviews the handoff, then tagged on `main`.
- No force-push to `main`. No rewriting tagged history.

## 5. Tags and releases

- Annotated tags only: `git tag -a v0.1.0 -m "M1: allocation engine"`.
- A GitHub Release per tag, with notes copied from CHANGELOG.
- Tagging and pushing happen **only when the handoff plan says so**. The executor never tags on
  its own initiative.

## 6. CHANGELOG

[Keep a Changelog](https://keepachangelog.com) format. Every merged milestone moves `Unreleased`
entries under the new version heading with the date. Group entries as Added / Changed / Fixed / Removed.

## 7. Post-submission freeze (from v1.0.0)

- No feature work on `main` until the review is over. Further experiments go on a `next` branch with
  no deploy.
- Allowed: a security fix, a dependency fix if the deploy breaks, or a keep-alive fix. Each one is a
  `v1.0.x` with a CHANGELOG line.
- The URL, endpoints and seed data stay unchanged, so a reviewer opening it on day 29 sees what was
  submitted.
