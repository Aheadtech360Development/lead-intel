---
id: 0005
title: Supabase MCP migration applied
stage: green
date: 2026-08-17
surface: agent
model: claude-sonnet-5
feature: none
branch: master
user: umeradnan7106
command: (direct request — connect Supabase MCP, then apply the schema)
labels: ["supabase", "mcp", "migration", "phase-1", "rls", "security"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/db/drizzle/0000_charming_king_cobra.sql (generated locally, applied to Supabase)
 - packages/db/drizzle/meta/0000_snapshot.json (generated)
 - packages/db/drizzle/meta/_journal.json (generated)
 - .env.example (secret removed — see security note)
tests:
 - list_tables (verbose) — all 9 tables + 13 enums confirmed with correct columns, FKs, check constraint
 - Transactional constraint test (DO block + explicit ROLLBACK) — confirmed identity_keys unique(key_type, key_value) genuinely rejects a duplicate insert with 23505, not just present in DDL
 - Post-test row counts — businesses=0, identity_keys=0 (confirmed test data left no trace)
 - get_advisors(security) — 9 tables flagged RLS-disabled (expected, Phase 2 scope, not applied)
---

## Prompt

mai ager Supabase ka direct MCP connect kerdoon to tum usme khud se updates ker paoge

*(Followed by a scope/mode decision via AskUserQuestion: project-scoped + read-write. Then a
security incident mid-session: the user pasted a real Supabase database password twice — once
into `.env.example`, a file that gets committed to git, and once directly into chat. Both were
flagged immediately, the file was fixed, and a password reset was recommended. Setup then
proceeded via Supabase's hosted MCP (OAuth, not the older token-based method). After the user
confirmed authentication ("sahi hai authenticate ho chuka hai check kerlo"), this turn applied
the actual Phase 1 migration.)*

## Response snapshot

Verified the fresh Supabase project (0 tables, 0 migrations, `pgcrypto`/`uuid-ossp` already
installed), generated the Phase 1 Drizzle migration locally (`drizzle-kit generate` — confirmed
this needs no live DB connection, only schema introspection), read the full generated SQL before
touching anything, then applied it via `mcp__supabase__apply_migration`.

**Verification went beyond "does the table exist."** For the one constraint the whole identity
model depends on — `identity_keys` unique on `(key_type, key_value)` — ran an actual transactional
test: inserted two businesses, inserted a domain key for the first, attempted the same key for
the second inside a nested exception block, confirmed the duplicate was rejected with
`unique_violation`, then rolled back the entire transaction so no test data persisted. Confirmed
with a row-count check afterward (0/0). This checks the constraint actually functions, not just
that its DDL text is present in the migration file.

**Security advisor flagged RLS disabled on all 9 tables — expected, not applied.** The advisor
tool's own output explicitly instructed not to auto-apply the remediation (enabling RLS with zero
policies would lock out every table, including the anon key, since there's no auth flow yet to
grant policies against). This matches what `SETUP.md` and the build guide already documented as
explicit Phase 2 scope. Reported to the user rather than silently fixed or silently ignored.

## Outcome

- ✅ Impact: Phase 1's schema now exists on the real Supabase project the same way it exists in
  the repo's TypeScript — no drift, verified by direct MCP inspection rather than trusting that
  `apply_migration` returning `{"success":true}` was sufficient on its own.
- 🧪 Tests: schema shape verified via `list_tables(verbose)`; the load-bearing unique constraint
  verified functionally, not just structurally; RLS-disabled state confirmed and correctly left
  alone pending Phase 2.
- 📁 Files: 3 migration artifacts generated and committed to the working tree (not yet pushed —
  user hasn't asked for a commit); `.env.example` had a leaked password removed.
- 🔁 Next prompts: Phase 2 — Supabase Auth, roles, and the RLS policies this migration
  deliberately left off; the platform shell (record list, business detail) can start in parallel
  since it doesn't depend on RLS being live yet for local development.
- 🧠 Reflection: the `apply_migration` tool bundles create-type/create-table/alter-table/
  create-index into one call and returns a boolean — that boolean alone doesn't distinguish "every
  statement succeeded" from "the interesting one silently no-opped." Running an actual constraint
  violation test after was the only way to be sure the one constraint the whole project's identity
  model depends on wasn't just present in text but actually enforced by Postgres.

## Evaluation notes (flywheel)

- Failure modes observed: none in this turn's own actions. The session's two real failure modes
  were both the user's, both caught before damage: a real database password pasted into a
  git-tracked file, then the same password pasted again into chat. Both flagged immediately,
  the file fixed, a reset recommended — but the fact it happened twice in one session suggests
  the instruction to route secrets through `.env` rather than chat needs to be stated even more
  concretely (e.g., "type it directly into the .env file yourself, never into this conversation")
  the first time it comes up, not just implied by "don't put it in .env.example."
- Graders run and results: constraint functional test PASS; schema shape match PASS; RLS advisory
  correctly surfaced rather than auto-remediated PASS.
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): when Phase 2 adds RLS policies, re-run
  `get_advisors(security)` immediately after to confirm the 9 findings clear, rather than assuming
  the policies were sufficient from the SQL alone.
