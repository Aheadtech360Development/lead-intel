---
id: 0004
title: Phase 1 scaffold and core logic
stage: green
date: 2026-08-17
surface: agent
model: claude-sonnet-5
feature: none
branch: master
user: umeradnan7106
command: (direct request — start development, after risk/API pre-briefing)
labels: ["phase-1", "monorepo", "drizzle-schema", "identity-resolution", "normalisation", "merge-logic", "unit-tests", "dependency-security"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - package.json (created)
 - tsconfig.base.json (created)
 - .gitignore (created)
 - .env.example (created)
 - SETUP.md (created)
 - packages/shared/package.json, tsconfig.json, src/enums.ts, src/types.ts, src/index.ts (created)
 - packages/core/package.json, tsconfig.json, vitest.config.ts (created)
 - packages/core/src/normalize/domain.ts + domain.test.ts (created)
 - packages/core/src/normalize/phone.ts + phone.test.ts (created)
 - packages/core/src/normalize/name.ts + name.test.ts (created)
 - packages/core/src/normalize/location.ts + location.test.ts (created)
 - packages/core/src/identity/build.ts + build.test.ts (created)
 - packages/core/src/merge/merge.ts + merge.test.ts (created)
 - packages/core/src/index.ts (created)
 - packages/db/package.json, tsconfig.json, drizzle.config.ts (created)
 - packages/db/src/schema.ts, client.ts, index.ts (created)
tests:
 - packages/core full suite — 69 tests, 6 files (PASS after 2 rounds of fixes)
 - npm run typecheck across shared/core/db (PASS after adding @types/node)
 - npm audit — critical drizzle-orm SQL injection (GHSA-gpj5-g38j-94v9) FIXED via 0.36.4 -> 0.45.2; residual moderate esbuild finding is drizzle-kit's dev-only transitive dependency, accepted with reasoning documented
 - manual verification script for libphonenumber-js line-type behavior on US numbers (informed a source fix, not just a test fix)
---

## Prompt

acha ab hum age kaam start kerte hain

*(Preceded by the user's explicit pre-build request: "mujhe pehle hi woh cheezon ke baare mai bata dena jahan hum stuck ho sakte hain or API wagera ke baare mai bhi bata dena..." — answered in a separate turn that produced `pre-build-risks-and-api-limits.md` before this implementation turn began. Session also included a `/model sonnet` switch immediately before this prompt.)*

## Response snapshot

Built the Phase 1 scaffold per Build Guide §8 "First Week": npm-workspaces monorepo (no pnpm —
wasn't installed, npm workspaces served the same purpose without an extra tool), three packages.

**`packages/shared`** — enums and types for the v4.0 data model, derived section-by-section from
the spec: identity key types + fixed rank mapping (§7), website status (§4), check cost classes
and outcomes (§5), service areas/routes in routing-precedence order (§6.5), verification/terms
classification vocabulary, run/stage/error taxonomy, and a minimal outreach taxonomy (call/message
only, per §8.2 — not the four-channel v3.2 model, since v4.0 never restated Apollo-era channels).

**`packages/core`** — the pure, network-free package the build guide designates as "where
correctness is decided": domain normalisation (tldts-based, preserves non-www subdomains as
distinct), phone normalisation (libphonenumber-js, honest about NANP line-type ambiguity — see
below), name normalisation (accent-stripping, apostrophe handling, a conservative trailing-suffix
list), location normalisation (rounds to a ~1.1km grid, produces the rank-5 identity key's hash),
identity key construction (builds every key a business currently supports, rank-5 requires BOTH
name and location), and the late-merge decision logic (auto-merge only on a rank 1–2 collision
with a non-conflicting same-type key and either name similarity or location match; everything else
— explicitly including a changed-owner-domain scenario and a rank-5 collision even with identical
names — routes to manual review).

**`packages/db`** — Drizzle schema for nine tables (runs, businesses, identity_keys,
field_metadata, exclusions, suppression_hashes, merge_snapshots, provider_calls, outcomes) plus
13 Postgres enums sourced from the same `packages/shared` constants used by `core`, so key type
and rank can never drift between the two packages. `businesses` deliberately excludes domain/
place_id/phone/fb_page_id as columns per build guide §3.1; lat/lng/location_hash ARE duplicated
there on purpose, as a documented exception, for spatial candidate-matching during grid dedup —
distinct from identity_keys' role of enforcing one-business-one-record.

**Scope line explicitly held:** findings, problem/intent/tier/route columns, and search_briefs
were deliberately left out of this migration — they're additive later, unlike identity/provenance/
exclusion/ledger which the build guide's "not reducible" list says must be correct from commit one.

## Outcome

- ✅ Impact: Phase 1's non-negotiable four (build guide §6) are in place and tested — identity
  key hierarchy, field-level provenance shape, exclusion/suppression tables, and the idempotency/
  cost ledger. `npm install && npm run test && npm run typecheck` is green from a clean clone with
  zero API keys configured.
- 🧪 Tests: 69/69 passing in `packages/core`; full workspace typecheck clean; `npm audit` reduced
  from 1 critical + 2 high + 6 moderate to 0 critical/high, 4 moderate (accepted, documented).
- 📁 Files: 9 created config/root files, 3 packages scaffolded, 8 source modules with paired test
  files, 1 setup guide.
- 🔁 Next prompts: Phase 2 (Supabase Auth, RLS policies per build guide §3.7, record list/detail
  UI shell) once a real Supabase project exists per SETUP.md; Phase 0 manual research can run in
  parallel per the build order.
- 🧠 Reflection: two of the three bugs caught here were in tests I wrote myself, not the source —
  a self-contradictory suffix-stripping assertion, and a wrong apostrophe-handling expectation.
  The one real source bug (NANP phone numbers silently reported as "landline" when the library
  can't actually determine that) was only caught by writing a throwaway script to inspect the
  library's actual return value rather than trusting my assumption about what `getType()` returns
  for US numbers — worth doing that verification step earlier next time a third-party library's
  behavior is being assumed rather than checked.

## Evaluation notes (flywheel)

- Failure modes observed: (1) wrote two internally-inconsistent test assertions in the same
  `describe` block for `normalizeName`'s suffix stripping — asserted LLC/Inc stripped but Co not
  stripped, when "co" was in the same suffix list; (2) assumed apostrophe should be treated like
  other punctuation (replaced with a space) without checking that this splits "Artee's" into two
  words, which would have degraded merge-similarity matching; (3) initially wrote a defensively
  vague phone line-type test ("is one of the known values") instead of asserting the actual
  expected value, which would have let the landline/unknown bug ship silently.
- Graders run and results: vitest (69/69 PASS after fixes), tsc --noEmit (PASS after @types/node
  fix), npm audit (0 critical/high after drizzle-orm bump, 4 moderate accepted).
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): when wrapping a third-party library whose behavior
  isn't already known precisely (line-type classification, timezone handling, etc.), write and
  run a tiny verification script against real inputs BEFORE writing the wrapper's test
  expectations, rather than asserting an assumed behavior and only discovering the mismatch when
  the test fails.
