---
id: 0014
title: Phase 4 scoring, routing and the Stage 5 gate
stage: green
date: 2026-08-20
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (continuation — "acha ab age kaam kerte hain")
labels: ["feature", "phase-4", "scoring", "routing", "gate", "spec-6", "spec-9", "live-found"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/shared/src/enums.ts (AREA_WEIGHTS, coverage floor, tier/gate thresholds, shared_domain)
 - packages/core/src/scoring/{areas,score}.ts + score.test.ts (new — 36 tests)
 - packages/core/src/normalize/shared-domain.ts + test (new — platform and chain domains)
 - packages/core/src/presence/classify.ts (dns_temporary is not dead)
 - packages/providers/src/crawl/{types,fetch-page}.ts (EAI_AGAIN split from ENOTFOUND)
 - packages/db: schema.ts + drizzle/0005_phase4_scoring.sql, 0006_shared_domain_review_reason.sql
 - apps/jobs/src/scoring.ts (new), src/audit.ts, trigger/score-run.ts (new), run-score.mjs (new)
 - apps/web/app/records/page.tsx + [id]/page.tsx (tier/Problem/Intent/pitch, area scores)
tests:
 - 319 across three packages (core 244, providers 67, db 8) — all passing
 - npm run typecheck — clean across all 6 workspaces
 - Registry point totals asserted against the spec's own tables rather than a comment
 - Live: all 209 scored, ranking read back and spot-checked by hand
---

## Prompt

"acha ab age kaam kerte hain" — continue, following the stated next step: §6 scoring, which is
what turns 7,942 findings into a ranked list.

## Response snapshot

§6.1 area scores with the coverage floor, §6.2 Problem, §6.3 Intent, §6.4 tiers, §6.5 routing and
§9's Stage 5 gate — all pure functions over stored findings, all with the spec's numbers named
rather than inlined.

Two design choices carry most of the weight:

**Scoring reads findings back out of the database rather than scoring in memory after the audit.**
§6's weights, the coverage floor and the gate cut-off are all expected to move — §10.3 names the
cut-off as *the lever*: "when a run would cost too much, raise the gate cut-off." Tuning any of
them must not cost 209 crawls, so `score-run` rescores the whole dataset from what is already
stored, in seconds and at zero cost. It also means what an operator sees on the page is exactly
what was scored.

**The coverage floor divides by every check in the catalogue, including the PAID ones nothing runs
yet.** That is the whole point of it. Counting only the checks that happen to be built would make
every area look fully covered on the day it was built. The consequence is stated rather than
avoided: **SEO and REP cannot be scored at all today** — 36% and 7% coverage against a 40% floor —
because you cannot judge local search without a Google listing and rankings, or reputation without
reviews. A test asserts both, so the day those are built the number moves visibly.

Three refusals are built in and tested: no area over the floor → no Problem score, no tier, no
route (not a zero); a winning area with nothing fired → no route at all, per §6.5's "a
recommendation with nothing to show is not a recommendation"; and anything unsettled goes to a
human with the reason attached.

**Then the first scored ranking exposed two live bugs.**

**One of only two Tier 1 leads in the entire dataset was `local.targetoptical.com`.** Google
Places returns whatever website a listing declares, and for many small businesses that is a
booking-platform profile (`booksy.com`, a `.square.site` subdomain) or a chain's store-locator
page. Every check runs happily and produces findings — about Booksy, or about Walmart, filed under
a barber in Mesquite. Six such records had passed the gate. `sharedPlatformDomain` now flags them:
the score is still computed, because it accurately describes what was crawled, but the record is
held back from the gate and flagged `shared_domain`, because spending money on paid lookups
because a chain's store locator has no Meta Pixel is spending on a finding that was never about
this business. **The identity keys are deliberately left alone** — `identity_keys` is unique per
domain, so these entries are also distorting deduplication, and unpicking that is a data decision
for a human, not a side effect of scoring.

**And the worst bug in the project so far.** A three-record spot check came back with three
previously-live sites marked `dead`. `cleareye.com` and `tsocampbowie.com` were answering HTTP 200
at that moment. The cause: `classifyFetchError` mapped `ENOTFOUND` and `EAI_AGAIN` to the same
outcome. `ENOTFOUND` is NXDOMAIN — the name really is not there. **`EAI_AGAIN` is "temporary
failure in name resolution": the resolver could not be reached, which is a fact about us.** A
flaky local network was therefore producing "this business's website is dead" — the single most
actionable and most expensive finding the system makes, the one an operator acts on by phoning
someone and offering to rebuild their site. Re-auditing every DNS-condemned record found **three
of six were alive.**

## Outcome

- ✅ Impact: 209 businesses now carry Problem, Intent, tier, route and a gate decision, each with
  a sentence saying why. 143 scored, 66 honestly unscorable, 77 through the gate — and the gate
  list contains no chains and no booking-platform profiles.
- 🧪 Tests: 319 passing (244 core, 67 providers, 8 db), typecheck clean across 6 workspaces. The
  registry's point totals are asserted against the spec's tables, which is how a wrong expectation
  of mine (ADS as 140 rather than 120) was caught.
- 📁 Files: 4 new core modules, 2 migrations, 1 new job helper, 1 new task, 1 runner, 2 pages.
- 🔁 Next prompts: PageSpeed for W6/W7 finishes Phase 4. Then the paid checks, which is what makes
  SEO and REP scoreable and will change the routing distribution substantially.
- 🧠 Reflection: every area's route distribution today is skewed toward Advertising and Social
  simply because SEO and REP are excluded — the two areas that would normally outrank them are not
  in the running. Worth remembering before reading anything into the current mix.

## Evaluation notes (flywheel)

- Failure modes observed: (1) treating two error codes as one because they occupy the same
  category in the mind — DNS failure — when they say opposite things about who is at fault;
  (2) accepting a provider's field at face value: Places returns *a* website, not necessarily
  *their* website, and every check downstream inherited that assumption.
- Graders run and results: full suite (PASS), typecheck (PASS), registry totals vs the spec
  (FOUND my own arithmetic error), first live scoring run (FOUND the chain-domain contamination at
  Tier 1), three-record spot check after that fix (FOUND the EAI_AGAIN bug), re-audit of all six
  DNS-condemned records (3 of 6 were alive), rescore (PASS).
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): the DNS bug says a single failed attempt is thin
  evidence for a 100-point finding. Before `dead` is concluded from DNS at all, the crawler should
  retry once after a pause — the per-business budget has room, and the asymmetry justifies it.
