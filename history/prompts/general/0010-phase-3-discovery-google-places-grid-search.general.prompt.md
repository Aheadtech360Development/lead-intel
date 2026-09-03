---
id: 0010
title: Phase 3 discovery — Google Places grid search
stage: green
date: 2026-08-17
surface: agent
model: claude-sonnet-5
feature: none
branch: master
user: umeradnan7106
command: (plan mode → approved plan → implementation)
labels: ["feature", "phase-3", "discovery", "google-places", "trigger-dev", "grid-search"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/providers/ (new workspace — Google Places Text Search + Geocoding adapters, Zod schemas)
 - packages/core/src/discovery/grid.ts (adaptive grid-search math)
 - packages/core/src/discovery/resolve.ts (discovery-time identity resolution)
 - packages/core/src/discovery/idempotency.ts
 - packages/shared/src/pricing.ts (verified Google pricing constants)
 - packages/shared/src/enums.ts (+GRID_CELL_STATUSES)
 - packages/db/src/schema.ts (+runs.maxBusinesses/maxSpendCents, +run_grid_cells table)
 - packages/db/drizzle/0003_phase3_discovery.sql (applied via Supabase MCP)
 - apps/jobs/ (new workspace — Trigger.dev discovery task, Drizzle-backed DiscoveryRepo)
 - apps/web/app/search/ (search form, cost-estimate confirm step, run status view)
 - apps/web/app/records/page.tsx (added "Find businesses" nav link)
 - .env.example (fixed TRIGGER_API_KEY → TRIGGER_SECRET_KEY; documented dual-API key)
 - SETUP.md (Phase 3 account setup + first-run sections)
tests:
 - npm run test --workspace=@lead-intel/core — 88/88 (grid coverage/depth-cap, resolve.ts against
   an in-memory fake repo, idempotency key determinism)
 - npm run test --workspace=@lead-intel/providers — 17/17 (mocked-fetch: search-text pagination/
   error mapping, geocode success/failure paths, raw-place-to-DiscoveredBusinessInput mapping)
 - npm run typecheck — clean across all 6 workspaces (core, db, providers, shared, jobs, web)
 - Migration applied via Supabase MCP, then verified live: columns confirmed via
   information_schema, table+RLS confirmed via list_tables, adversarial RLS test (non-admin
   authenticated: 0 rows visible, insert blocked) — not just trusted from apply_migration's
   {"success":true}
 - Dev server smoke test: typecheck-clean build, server starts without crash, /login and the
   auth-redirect on /search/confirm both behave correctly; full authenticated render NOT yet
   verified in a real browser (pending user click-through)
---

## Prompt

Phase 3: Google Places discovery (Recommended) — chosen via AskUserQuestion after confirming the
phone-validation fix (PHR 0009) worked. Followed by: "Dono nahi bane abhi tak" (neither Google
Cloud nor Trigger.dev accounts exist yet) in response to a clarifying question about account
status, and "Sirf Places field record karein (Recommended)" in response to a clarifying question
about how much of spec §4's three-check "no website" presence classification to attempt this
pass (the other two checks — Facebook lookup, business-name web search — have no decided tool,
and CLAUDE.md's "do not invent APIs" rule applies).

## Response snapshot

Entered plan mode given the scope (two new external services, two new workspace packages, a
grid-search algorithm). Verified Google's current API surface directly rather than assuming from
training data (CLAUDE.md's authoritative-source mandate) — fetched live docs/pricing pages and
found: Places API (New) Text Search is the right endpoint (not searchNearby, which uses a fixed
place-type taxonomy incompatible with an arbitrary niche keyword); the Circle radius hard limit
is 50,000m; the field mask needed (phone/website/rating/reviewCount/businessStatus) lands on the
**Enterprise** SKU at $35/1,000 requests, not the cheaper Pro tier; Geocoding is $5/1,000. These
verified numbers replaced the spec's own placeholders.

Built, bottom-up:
- **packages/providers** — Places Text Search + Geocoding adapters, Zod-validated, mapping raw
  results to the shared `DiscoveredBusinessInput` contract. Error mapping distinguishes
  PROVIDER_RATE_LIMITED (retry) from PROVIDER_QUOTA_EXHAUSTED (circuit-break) by HTTP
  status/gRPC status string.
- **packages/core/discovery/grid.ts** — adaptive grid-search math. Found and fixed a real
  geometric bug during testing: the spec's own "split into 4" pseudocode is not achievable — a
  circle of radius R cannot be covered by 4 circles of radius R/2 (proven via a coverage
  property test, not just asserted). Refactored both the initial grid and subdivision to share
  one proven tiling algorithm; empirically subdivision produces ~9 children, not 4 — documented
  as a real cost consequence (up to 9³=729 sub-searches for one cell at max depth), not just a
  cosmetic difference from the spec's illustrative number.
- **packages/core/discovery/resolve.ts** — the discovery-time identity resolution step, built on
  the *existing* buildIdentityKeys/evaluateLateMerge (no new merge logic invented). Correctly
  implements insert-and-catch (never a pre-check) for the genuinely concurrent grid-cell case,
  unlike the manual-entry form's single-human pre-check. Tested via an in-memory fake repo:
  new business, re-discovery of the same place_id, rank-2 domain auto-merge, weak-key-only
  manual review, and a genuine multi-way conflict (keys from one result pointing at two
  different existing businesses).
- **Database** — `runs.maxBusinesses/maxSpendCents` (spec §10.3's run ceilings) and a new
  `run_grid_cells` table (per-cell resumability + honest saturation tracking, per
  pre-build-risks-and-api-limits.md §2.1). Applied via Supabase MCP, then verified live — schema
  confirmed via `information_schema`, RLS confirmed both by policy definition AND an adversarial
  transactional test (non-admin: 0 rows visible, insert blocked) — not just trusted from
  `apply_migration`'s success response, matching this session's established discipline after the
  Phase 2 EXECUTE-grant bug.
- **apps/jobs** — first use of Trigger.dev in this repo. Verified the current v4 SDK API against
  live docs rather than assumed (`task()`/`defineConfig` from `@trigger.dev/sdk`, not
  `/v3`; `TRIGGER_SECRET_KEY` not `TRIGGER_API_KEY` as the stale `.env.example` had it; the CLI
  reads env vars from `apps/jobs/.env`, not the repo root, and handles its own auth separately
  from that file). The `discoveryTask` orchestrates geocode → grid → per-cell search/paginate/
  subdivide → `resolveBusinessForRawResult` → exclusion match → aggregate counters, all via a
  Drizzle-backed `DiscoveryRepo` implementing packages/core's injected interface.
- **apps/web/app/search** — Stage 0 (Plan): a form, then an honest cost-estimate range (grid
  geometry only, never guessed real density) before anything is created, then `createRun` +
  `tasks.trigger()`, then a run status view reading the aggregate counters/spend.

## Outcome

- ✅ Impact: Phase 3's scope per spec §12 ("Places grid search, deduplication wired in, presence
  classification, run limits") is built and internally verified; every non-key-dependent piece
  (grid math, identity resolution, adapters, schema, UI, cost estimate) is real and tested.
  Deliberately scoped OUT: full three-check presence classification (Phase 4), since two of the
  three checks have no decided tool — recording only the raw Places signal keeps `website_status`
  honestly at "unclear" rather than inventing an API contract.
- 🧪 Tests: 105/105 unit tests (core 88, providers 17), typecheck clean across 6 workspaces,
  migration verified live including an adversarial RLS test.
- 📁 Files: 2 new workspace packages, 1 schema migration, 5 new web routes, SETUP.md extended.
- 🔁 Next prompts: neither Google Cloud nor Trigger.dev accounts exist yet — SETUP.md §8-10 walks
  through creating both (quota limits BEFORE the first call, per pre-build-risks-and-api-limits.md
  §0). Once both exist, the plan is exactly pre-build-risks §4's small test run: 10-mile radius,
  one niche, one city, then read back real numbers instead of the estimate.
- 🧠 Reflection: two "verify, don't assume" moments materially changed the build — Google's field
  mask pricing (Enterprise, not the cheaper tier the spec's placeholder implied) and Trigger.dev's
  actual env-var/CLI conventions (a stale `.env.example` had the wrong variable name entirely,
  which would have been a real setup-time dead end). The grid-subdivision geometry bug is the
  more interesting one: it wasn't caught by *reasoning* about the spec's "split into 4" language —
  it was caught by writing a coverage property test and watching it fail with real uncovered
  points. Worth carrying forward: for any spatial/geometric claim in a spec, a property test that
  samples the space beats trusting the pseudocode's stated fan-out number.

## Evaluation notes (flywheel)

- Failure modes observed: (1) exactOptionalPropertyTypes mismatches at every boundary where an
  optional-and-nullable field crosses into a function expecting present-but-nullable — now a
  recognizable, quickly-fixed pattern (`?? null` or a spread-guard), not a surprise. (2) A test
  data bug (forgetting to vary lat/lng alongside city/state) produced a false test failure that
  looked like a resolve.ts logic bug — traced back correctly by checking what `evaluateLateMerge`
  actually compares (locationHash, which is coordinate-derived) rather than assuming the test's
  intent matched its data.
- Graders run and results: grid coverage property test (FAIL → root-caused → PASS), resolve.ts
  7/7 scenario tests (PASS after one test-data fix), providers 17/17 (PASS), full-workspace
  typecheck (PASS), live RLS adversarial test (PASS).
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): once Trigger.dev exists, run the task against a
  *mocked* Places response first (point `GOOGLE_PLACES_API_KEY`-consuming code at a local stub)
  to exercise the full discovery.ts orchestration path (pagination, saturation, subdivision,
  ceiling-stop) before spending anything on the real API — none of that orchestration logic has
  been exercised end-to-end yet, only its individual pieces in isolation.
