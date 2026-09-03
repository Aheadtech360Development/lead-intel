---
id: 0017
title: Finishing the buildable work and simplifying the UI
stage: refactor
date: 2026-08-20
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (continuation — "jo mujhe kerne ka hai ... unko chor ker jitna kaam hai forun complete karo")
labels: ["phase-2", "phase-6", "ui", "cost-control", "idempotency", "docs"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - apps/web/app/records/export/route.ts (new — CSV export)
 - apps/web/app/records/[id]/outcome-actions.ts (new — Phase 6 outcome logging)
 - apps/web/app/records/[id]/page.tsx (rewritten — call-first, progressive disclosure)
 - apps/web/app/records/page.tsx (rewritten — "ready to call" default view)
 - apps/jobs/src/listing.ts (idempotency checked BEFORE the paid call, not after)
 - packages/core/src/outreach/opener.ts (opener variety across a run of calls)
 - SETUP.md §8 (rewritten — no billing, no Geocoding, PageSpeed added)
tests:
 - 394 across three packages (core 308, providers 78, db 8) — all passing
 - npm run typecheck — clean across all 6 workspaces
 - Next.js production build — exit 0
 - Live: re-running a bought listing returns `already_bought` at zero cost
---

## Prompt

"jo mujhe kerne ka hai or jo jo nhi hosakta usko chor ker jitna kaam bhi bacha hai forun khatum
karo phir iski UI bhi sahi kerni hai ye bohot complicated design hai adhi cheezen mujhe samajh ati
hain or adhi nhi" — finish everything that isn't mine to decide, isn't paid, and isn't impossible;
then fix the UI, which is too complicated and half of it isn't understandable.

## Response snapshot

**A paid call was being bought twice.** `provider_calls` was written *after* the Places lookup with
`onConflictDoNothing`, so the ledger recorded the duplicate but the money had already gone. Both
schema.ts's own comment on that table and build guide §3.5 say the opposite: the key is looked up
**before** the call, and a job that finds it reuses the stored result. Now it does — a re-run
returns `already_bought` at zero cost, verified live.

**Phase 2 was one item short of its own definition of done** — "the team can work entirely from the
tool" — because there was no CSV export. Added, reading through the user's own session so RLS
decides what leaves the system exactly as it decides what is displayed. Every nullable column
writes a labelled state rather than a blank, because a blank cell in a spreadsheet reads as zero
and null here means "we could not measure it". Fields beginning `=`, `+`, `-` or `@` are prefixed
with an apostrophe: this data comes from Google listings and strangers' web pages, and a business
named "+1 Printing" would otherwise be executed as a formula.

**Phase 6 existed as a table with no way to write to it.** The business page could show outreach
history but nothing could log any. The form captures channel, result, objection and — the field
the whole feedback loop turns on — which finding the opener used, pre-filled from the recommended
service.

**The UI.** The business page had grown to nine sections of equal visual weight: scores,
provenance, identity keys, every check that passed. The effect was that the two things a caller
actually needs — the phone number and the sentence to open with — were buried in the middle of it,
and the phone number was not shown at all outside the raw identity-keys dump.

Rebuilt around the fifteen seconds before dialling: **who they are and their phone number**, then
**what to say**, then **why**, then **log what happened**. Everything else is behind `<details>` —
available on demand, silent otherwise. Spec references, "not measured", "coverage floor" and the
rest of the internal vocabulary are gone from what the operator reads; the same ideas are there in
their own words ("Not enough data to score — we could only measure 36% of this area").

The list defaults to **"ready to call"** rather than the whole database, and its three rows of
filter chips became one line. Twenty controls above a table made it look like a settings screen
rather than a queue.

## Outcome

- ✅ Impact: everything buildable without a decision, a payment, or an unavailable data source is
  now done. The tool can be used end to end by someone who has not read the spec.
- 🧪 Tests: 394 passing, typecheck clean across 6 workspaces, Next.js production build exit 0.
- 📁 Files: 2 new routes/actions, 2 pages rewritten, 1 cost bug fixed, 1 setup doc corrected.
- 🔁 Next prompts: three things remain and none is mine — a search-ranking provider (§14 item 3),
  whether the Meta Ad Library returns anything useful for a small US business (§14 item 4), and
  **Phase 0**, the 40 manual calls the spec says gate Phase 5.
- 🧠 Reflection: the UI problem and the honesty work are the same problem seen twice. Showing
  everything at equal weight is not transparency — it is a different way of hiding the important
  thing, and it happened here precisely *because* every section had been written carefully enough
  to feel worth showing.

## Evaluation notes (flywheel)

- Failure modes observed: writing the cost ledger after the spend rather than before, in code whose
  own schema comment described the correct order; and letting a page accumulate sections without
  ever asking what the reader is trying to do when they open it.
- Graders run and results: full suite (PASS), typecheck (PASS), production build (PASS), live
  re-run of an already-bought listing (PASS — zero cost).
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): the model has never been checked against a real reply.
  Weights, the gate at 55, and which opener works are all still the spec's estimates. Twenty logged
  outcomes would be the first real evidence, and `run-score.mjs` rescores the whole dataset from
  stored findings in seconds at zero cost — so the loop from "what actually got a reply" back to
  "what the model believes" is already short.
