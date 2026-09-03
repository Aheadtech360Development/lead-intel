---
id: 0011
title: Phase 3 first live run — three bugs
stage: green
date: 2026-08-18
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (organic — first end-to-end discovery run against live Google + Trigger.dev)
labels: ["bug-fix", "phase-3", "discovery", "integration-boundary", "user-found"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/db/src/errors.ts (new — isUniqueViolation walks Drizzle's cause chain)
 - packages/db/src/errors.test.ts (new — 5 regression tests against the real error shape)
 - packages/db/{package.json,vitest.config.ts} (test setup added — package had none)
 - apps/jobs/src/repo.ts (use the shared helper instead of a local, broken check)
 - apps/jobs/trigger/discovery.ts (toCount coercion everywhere; crash handling; no-op guard)
 - packages/providers/src/google-places/resolve-center.ts (new — replaces the Geocoding adapter)
 - packages/providers/src/google-places/resolve-center.test.ts (new — 7 guard tests)
 - packages/providers/src/google-places/geocode.{ts,test.ts} (deleted — Geocoding needs billing)
 - packages/shared/src/pricing.ts (PLACES_CENTER_LOOKUP_COST_CENTS replaces GEOCODING_COST_CENTS)
 - packages/core/src/discovery/estimate.ts + test (new — honest request/cost ceiling)
 - apps/web/app/search/{page.tsx,confirm/page.tsx,confirm/actions.ts}
tests:
 - 118 across three packages (core 93, providers 20, db 5) — all passing
 - npm run typecheck — clean across all 6 workspaces
 - Live verification against the real Google API at each step, not mocks alone
 - Error shape probed against the live database rather than assumed (see Bug 2)
---

## Prompt

"Start discovery mene kara hai" — and, after the run silently did nothing, "acha to abhi masla kia hua hai".

*(The operator ran the first real end-to-end discovery: Google Places + Trigger.dev + Supabase,
10-mile radius, "screen printing" near Miami, FL.)*

## Response snapshot

Three separate bugs, each found only because a real run was made — none was reachable by the
existing tests.

**Bug 1 — the run did nothing and called itself "complete".**
Counters came back as `{"cellsDone":"0"}` — strings, not numbers. Postgres `count()` returns
bigint; the `postgres` driver hands that back as a **string**. `hasNoGridCellsYet` compared
`(row?.count ?? 0) === 0`, i.e. `"0" === 0`, which is `false` — so the code believed cells already
existed, never seeded the grid, found nothing pending, and reported success in 0.8 seconds.

Root cause was a lie in the type annotation: the query was declared `sql<number>`, so TypeScript
had no way to object. Fixed by annotating `sql<string>` (the truth) and routing every aggregate
through a `toCount()` helper. Added a second guard: a run that searched zero cells is now
`failed`, never `complete` — a run that did nothing must not look like one that succeeded.

**Bug 2 — the identity-collision mechanism had never worked.**
With the grid seeding, the run crashed on a genuine duplicate: two businesses sharing
`kingdtg.com`. That case is the entire reason `identity_keys` has a unique constraint — the
system is supposed to catch the `23505`, decide via `evaluateLateMerge`, and continue.

It didn't, because Drizzle wraps driver errors: the thrown `DrizzleQueryError` has
`code === undefined`, and the real `PostgresError` with `code: "23505"` sits one level down in
`.cause`. The check looked only at the top level, so it returned `false` for every real collision
and rethrew. Confirmed by probing the live database for the actual error shape rather than
reasoning about it. Fixed with a bounded cause-chain walk, moved into `packages/db` and covered
by 5 tests built from the captured shape.

Why no test caught it: `resolve.test.ts` uses an in-memory fake repo that signals collisions by
checking a Map. A fake never produces a wrapped driver error, so the integration boundary — the
one place the bug lived — was the one place untested. Same family as PHR 0009: correct logic,
wrong handling of what the real world returns.

**Bug 3 — a crashed task left the run "running" forever.**
When Bug 2 killed the task, the `runs` row kept saying "running". The status page showed an
in-progress run indistinguishable from a slow one. Wrapped the pipeline so any escaping error
marks the run `failed` with the reason, then rethrows so Trigger.dev still records the stack.

**Also this session (before the run):**
- The confirm screen's "$0.32–$0.95" was only the no-subdivision case. The real ceiling for the
  same 20-mile search is ~22,140 requests ≈ $775. Split into a likely range plus a separately
  labelled ceiling, with the spend limit defaulted rather than left blank.
- The Geocoding API turned out to require billing, which Places (currently) does not. Replaced it
  with Places-based centre resolution — but testing found that from Pakistan, "Springfield"
  resolves to a school in Karachi with entirely plausible coordinates. Added two guards on
  structured fields (country code, and area-vs-establishment place types); `regionCode: "US"`
  alone does **not** fix it. A rejected location now fails visibly instead of searching the wrong
  continent.

## Outcome

- ✅ Impact: the discovery pipeline went from "passes every test" to actually working. Two of the
  three bugs would have corrupted or silently skipped data rather than erroring loudly.
- 🧪 Tests: 118 passing (93 core, 20 providers, 5 db — the db package had no test setup before
  this and now does), typecheck clean across 6 workspaces.
- 📁 Files: 1 adapter replaced, 1 new shared error helper, 3 fixes in the discovery task.
- 🔁 Next prompts: re-run against the existing 31 discovered businesses so every result collides —
  the exact path Bug 2 broke. Then the pre-build-risks §4 measurements.
- 🧠 Reflection: all three bugs sat at boundaries the unit tests deliberately mock — the driver's
  error shape, the driver's return types, and process death. The tests were not wrong; they were
  testing the half of the system that was already correct. The general lesson: when a fake stands
  in for an external system, the fake's fidelity to *failure* shapes matters more than its
  fidelity to success shapes, because failure handling is what never gets exercised otherwise.

## Evaluation notes (flywheel)

- Failure modes observed: (1) a type annotation asserting something untrue about runtime data,
  which disables the compiler as a safety net; (2) a fake that models an outcome ("collision")
  without modelling the mechanism (a wrapped error) that signals it; (3) no terminal-state
  handling for the process itself dying.
- Graders run and results: live error-shape probe (PASS — confirmed the hypothesis before coding
  the fix), 5 new db tests (PASS), 7 new centre-resolution guard tests (PASS), full suite (PASS),
  live Google API verification at each step (PASS).
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): `provider_calls` records an idempotency key but never
  reads it before making a call — a retried cell re-pays Google. Build guide §3.5 calls for reuse.
  Closing it properly needs cached responses, which the retention rule currently forbids; worth
  resolving explicitly rather than leaving the ledger half-implemented.
