---
id: 0012
title: Phase 4 crawler and presence classification
stage: green
date: 2026-08-18
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (plan mode → approved plan → implementation)
labels: ["feature", "phase-4", "crawler", "presence", "spec-13", "user-found"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/providers/src/crawl/{policy,types,fetch-page,robots,crawl-site}.ts (new)
 - packages/providers/src/crawl/{fetch-page,robots,crawl-site}.test.ts (new — 31 tests)
 - packages/core/src/presence/classify.ts + classify.test.ts (new — 18 tests)
 - apps/jobs/trigger/audit-website.ts (new — one task per business)
 - apps/jobs/trigger/audit-run.ts (new — batchTrigger fan-out)
 - apps/jobs/src/field-metadata.ts (extracted from repo.ts, now shared by discovery and audit)
 - apps/web/app/records/page.tsx (presence filter)
tests:
 - 172 across three packages (core 113, providers 51, db 8) — all passing
 - npm run typecheck — clean across all 6 workspaces
 - Live smoke test against real sites before any batch: aheadtech360.com and tshirtsflorida.com
   live, a non-resolving domain dead, a fabricated domain dead
 - Live audit across all 209 discovered businesses
---

## Prompt

"Phase 4 — website analysis (Recommended)" — chosen after Phase 3 discovery produced 209 real
businesses, every one of them still carrying `website_status = 'unclear'`.

Two scoping answers followed: the crawler should identify itself as `aheadtech360.com`, and the
first increment should be the crawler and presence classification rather than all ~40 checks at
once.

## Response snapshot

Built the crawler under spec §13's rules, treating them as constraints rather than suggestions:
an honest user agent naming AheadTech360 with a contact URL, robots.txt fetched first and
respected, one request at a time per host at least two seconds apart, a page cap, a per-request
timeout and a per-business time budget, GET only. Every rule is a named constant in
`policy.ts` so there is one place to read to know how this crawler behaves.

The fetch result is a **discriminated union**, not `{ html, error? }`. §13's central rule is that
a blocked or failed fetch is recorded as *not measured*, never as a pass — and a shape where a
caller can reach for `.html` without first handling failure is a shape that invites exactly that.
`html` does not exist on the type unless the fetch succeeded. A test asserts directly that no
failure path can ever yield `outcome: "ok"`.

`classifyPresence` in packages/core turns that evidence into a §4 state, and is deliberately
narrower than §4's five states: it **never returns `no_website` or `social_only`**. §4 requires
three checks — the Places field, a Facebook lookup, a name search — before a business may be
called website-less, and only the first exists. A business with no listed website comes back
`unclear` with a reason saying precisely why it is unconfirmed. "No website" is the most valuable
finding in the system and therefore the most expensive to be wrong about: someone acts on it in a
sales call.

Architecturally the audit is **one task per business**, fanned out with `batchTrigger` and bounded
by a queue concurrency limit, rather than discovery's single long loop. That loop already brushes
the 30-minute run cap (118 businesses took 17 minutes) and dies entirely when one record fails —
which is how the first live Dallas run ended. Per-business runs are seconds long, isolate crashes,
and let Trigger.dev's own retry and queue handling do work that would otherwise be hand-rolled.

**A real misclassification, caught by testing on ten businesses before running all 209.** iPrint
and Design USA came back `dead` on an HTTP 403. But 403 does not mean "nothing here" — it means
"I understood you and refused". Its robots.txt was refused too, which is the signature of bot
protection, not an abandoned site. The classifier was mapping every 4xx to dead. Corrected so
that only 404 and 410 mean dead; 401/403/429 mean we were blocked and produce `unclear` with a
reason telling the operator to open it in a browser. `pre-build-risks-and-api-limits.md` §2.3 had
already written this rule down — the code simply had not honoured it.

## Outcome

- ✅ Impact: 209 businesses move from a single undifferentiated "unclear" to real states, and the
  crawler that every remaining Phase 4 check depends on exists and behaves politely.
- 🧪 Tests: 172 passing (113 core, 51 providers, 8 db), typecheck clean across 6 workspaces, plus
  a live smoke test against real sites before anything ran in bulk.
- 📁 Files: 5 new crawler modules, 1 classifier, 2 Trigger.dev tasks, 1 extracted shared helper.
- 🔁 Next prompts: the HTML-derived FREE checks (K/S/O/D families and W8–W12) parse the page this
  crawler already fetches, and need the `findings` table. Then PageSpeed, then scoring and the gate.
- 🧠 Reflection: the 403 bug is the third time this session that a *live* run has found something
  no test could. The pattern is consistent — every one sat where the code met an external reality
  the tests had mocked: Drizzle's wrapped errors, the driver's bigint-as-string, a connection
  reset, and now HTTP semantics as real sites actually use them. The habit that keeps catching
  them is running against a handful of real records before running against all of them.

## Evaluation notes (flywheel)

- Failure modes observed: treating an HTTP status class as semantically uniform (all 4xx alike)
  when 403 and 404 say opposite things about the business. The unit tests asserted the code did
  what I intended; they could not tell me the intent was wrong. Only a real site did.
- Graders run and results: full suite (PASS), typecheck (PASS), live smoke test on 5 real domains
  (PASS — including a genuine dead domain), 10-business trial (FOUND THE 403 BUG), targeted
  re-audit after the fix confirming reclassification to `unclear` (PASS).
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): track the blocked-fetch rate as a first-class number.
  pre-build-risks §2.3 sets ~15% as the point where the free analysis stops seeing enough of the
  market to be trusted — right now that rate is computable from `crawl_outcome` rows but nothing
  surfaces or watches it.
