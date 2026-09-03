---
id: 0015
title: Phase 4 PageSpeed, W6 and W7
stage: green
date: 2026-08-20
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (continuation — "age kaam kerte hain" / "enable kerdia hai check karo age kaam karo")
labels: ["feature", "phase-4", "pagespeed", "lighthouse", "spec-5.1", "live-found", "model-limit"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/providers/src/pagespeed/{types,run-pagespeed}.ts + test (new — 15 tests)
 - packages/core/src/checks/performance.ts (new — W6/W7, extracted from web.ts)
 - packages/core/src/checks/types.ts (PerformanceEvidence)
 - packages/core/src/normalize/shared-domain.ts (9 more platforms, 3 more chains)
 - packages/providers/src/crawl/crawl-site.ts (retry once before a DNS failure stands)
 - apps/jobs/src/pagespeed.ts (new), trigger/pagespeed.ts (new), run-pagespeed.mjs (new)
tests:
 - 349 across three packages (core 263, providers 78, db 8) — all passing
 - npm run typecheck — clean across all 6 workspaces
 - Live: 209 businesses measured, 134 scored, 0 job failures, 13 minutes
---

## Prompt

"age kaam kerte hain", then "enable kerdia hai check karo age kaam karo" — build PageSpeed, and
run it once the API was switched on.

## Response snapshot

W6 and W7 now come from Google PageSpeed Insights, run against every business whose own site is
worth measuring. 134 real measurements; **129 of 134 sites fire W6** and **128 fire W7**. Only
five live sites load their main content inside Google's 2.5-second bar.

Three decisions worth naming:

**W6 reads Largest Contentful Paint specifically.** §5.1's thresholds — 2.5s and 4s — are not
numbers someone picked: they are Google's own LCP boundaries between good, needs-improvement and
poor. Reading any other timing would be answering a different question than the spec asked. W7
likewise uses the Lighthouse score, whose 50/90 bands are Lighthouse's own.

**Mobile, not desktop.** The check is literally "Slow on mobile", and for a local business the
phone is where the customer is.

**PageSpeed is deliberately not gated by the crawl's page-content blind spot** — the one place in
this system where an app shell is not an obstacle. Lighthouse drives a real browser, so it
measures a single-page app exactly as a visitor experiences it, and it succeeds on sites whose bot
protection turned our own crawler away. Those are among the sites most worth measuring; tying this
to a successful crawl would have excluded precisely them.

A PageSpeed pass writes only W6 and W7 and then rescores from stored findings, so it costs no
crawling and re-runs on its own.

**Three things the live run found.**

*Skips were invisible.* A business with no website was skipped without recording anything, so it
looked identical to one never attempted — every future pass would select it again, and the record
would show W6/W7 blank with no reason. Now the skip and its reason are stored, and 67 businesses
carry one.

*A category with the message thrown away.* Four sites came back `invalid_response` and the
evidence read exactly that and nothing more — the same failure this project criticised on the
Geocoding API, reproduced in new code. `detail` is now preserved alongside `providerMessage`.

*And then the message showed the category was wrong.* With the detail visible, two of those turned
out to be HTTP 200, no runtimeError, `score: null`, no audits — Lighthouse ran and could not
measure the page. `invalid_response` blames our parser for a fact about the page and would send
someone hunting a bug that is not there, so those now report `no_score` with that wording.

Also closed the DNS follow-up from PHR 0014: a DNS failure is retried once before it is allowed to
stand, because it is the only crawl outcome that produces "dead" on its own, at 100 points, with
no manual review.

## Outcome

- ✅ Impact: Phase 4's checks are complete. 209 businesses measured, 134 scored, 67 skipped with a
  stated reason, 8 unmeasurable with a stated reason, 0 job failures, 13 minutes.
- 🧪 Tests: 349 passing (263 core, 78 providers, 8 db), typecheck clean across 6 workspaces.
- 📁 Files: 2 new provider modules, 1 new core module, 1 new job helper, 2 tasks, 1 runner.
- 🔁 Next prompts: the paid checks (S1–S8, R1–R5), which are what make SEO and Reputation
  scoreable at all — and, before that, the WEB-area question below.
- 🧠 Reflection: two of the three bugs here were about *naming a failure honestly*, not about
  getting a computation right. A wrong label is not cosmetic — it decides where the next person
  looks.

## Evaluation notes (flywheel)

- Failure modes observed: recording an outcome only on the paths that produce data, so "we chose
  not to" became indistinguishable from "we never tried"; and reaching for a plausible failure
  name (`invalid_response`) instead of the accurate one.
- Graders run and results: full suite (PASS), typecheck (PASS), 5-business trial (FOUND a chain
  domain missing from the deny list), full 209 run (FOUND the unrecorded skips and the discarded
  detail), retry pass (FOUND the mislabelled `no_score`), final retry (PASS — every remaining
  outcome is a genuine fact about the site).
- Prompt variant (if applicable): n/a
- **Next experiment, and it is a question about the model rather than the code:** for a site that
  loads, the WEB area cannot score above about 20. W1/W2/W3 carry 290 of its 468 possible points
  and all three pass for any working website, so W4–W12 together — every quality problem the
  system can find — can only ever reach 178/468. Measured across the live dataset: WEB averages
  **9.4** and peaks at **19.9**, against ADS at **73.1**. A site scoring 3/100 on PageSpeed with a
  27-second load will therefore never be routed to Web development. §6.2's override still forces
  that route when a site is absent or dead, so the catastrophic case is covered — but "your
  website is slow and unusable" is currently unsellable by the router. This is §6.1 and §5.1
  behaving exactly as written; whether that is intended is the operator's call.
