---
id: 0027
title: What was connected and what was not
stage: general
date: 2026-10-13
surface: agent
model: claude-opus-5
feature: none
branch: main
user: Aheadtech360Development
command: ("jo jo functions banaye hain unko test karo … score change q nhi hota woh sab aik aik kerke check kerna hai")
labels: ["audit", "scoring", "findings", "providers", "performance", "jobs", "correctness"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - packages/core/src/checks/paid-social.ts (+ test) — D5, N2, O5, N5 finally have a producer
 - packages/core/src/checks/listing.ts (+ test) — N3/N4/N7/N8 reported; S5 and S6 refuse when the source never carried the field
 - packages/core/src/scoring/coverage.ts (+ test) — how much of a business has actually been checked
 - apps/jobs/src/listing-facts.ts (new) — scores the Google rating and review count already stored
 - apps/jobs/src/meta-ads.ts, apps/jobs/src/instagram.ts — purchases now write findings
 - apps/jobs/src/scoring.ts — scoreManyAndStore: bulk reads, overlapping writes
 - apps/jobs/trigger/score-run.ts, youtube.ts, analyse-run.ts — scoped to what changed
 - apps/jobs/src/job-progress.ts — every report stamps a heartbeat
 - packages/db/src/schema.ts, packages/db/drizzle/0022_job_runs_heartbeat.sql, supabase migration 0022_job_runs_heartbeat
 - apps/web/lib/job-runs.ts, apps/web/app/running-jobs.tsx — a stalled job says so and stops the refresh
 - apps/web/app/ui.tsx, apps/web/app/records/page.tsx, apps/web/app/records/[id]/page.tsx — every score says what it was made of
tests:
 - 673 tests across 41 files, all passing; six workspaces typecheck clean
 - live, read-only: 559 active businesses examined — 196 scored on 5 checks or fewer, 48 of those at Problem 90 / Priority 1
 - live, read-only: 338 businesses would gain real R1/R2 findings from data already stored (63 at R1's full 35 points, 25 at R2's full 30)
 - live, read-only: provider_calls shows Instagram 167 calls / 43¢ and Meta ads 0 calls ever
---

## Prompt

> acha abhi aik kaam ye karo jo jo humne functions banaye hain na unko test karo aur dekho ke kia
> kia cheezen connected hain aur chal nhi rahi hain aur task jab koi lagate hain to itna time leta
> hai ke poora din bhi lagao tab bhi chali raha hota hai to in sabko dekho aur sabse main baat ke
> jab humne kisi business ko check nhi kia hua hota tab uska score dikh raha hota iske requirements
> ke related phir jab hum check kerte hain to phir aur cheezen ane ke baad score change q nhi hota
> woh sab aik aik kerke check kerna hai aur sab kuch sahi chalna chahye, jo nhi chal raha hai usko
> sahi karo

## Response snapshot

Three faults, each with a measurement behind it.

**1. Bought data could not move a score.** Scoring reads `findings`. The Meta Ad Library purchase
(11.6¢, the dearest thing here) and the Instagram purchase (0.26¢ × 160 businesses, 43¢ spent)
wrote `field_metadata` and nothing else, so D5, N2, O5 and N5 had no producer in the codebase at
all. Both now write findings; where a source genuinely cannot answer — the profile actor returns no
post dates — the finding is written as unmeasured carrying that reason, so the limit is on the
record instead of being silent.

**2. Free data already stored was never scored.** 414 businesses carry a Google rating and review
count from the Maps search that found them; only 79 had ever had the listing checks run, because
R1 and R2 were produced solely by the paid Place Details path. 338 businesses were missing the two
heaviest reputation checks with the answers sitting one table away — and an area with nothing
measured drops out of §6.1 entirely, so for most of the list the Problem score was the website
alone. `applyStoredListingFacts` fixes that for nothing, and S5/S6 learned to refuse rather than
fire on a field the search result never carried.

**3. Jobs did whole-list work behind single-business requests.** Analysing one business re-scored
all 422 (13.9 minutes, five round trips each, to a database in another region) and ran a whole-list
YouTube pass against a 100-a-day quota. Scoring is now one bulk pass, and both steps are scoped to
what was actually analysed. Separately, `job_runs` gained a heartbeat: a worker that dies left its
row saying "running" for 28 hours, with the banner on every screen and every reading page reloading
behind it.

And the question underneath all three: a business nobody has checked **should** show a score —
the demand rule is right that a listing with 336 reviews and no website is the best lead on the
list — but the screen showed it in the same ink as a score built from forty measurements. Every
score now carries what it was made of.

## Outcome

- Impact: paid lookups can change a score for the first time; 338 businesses can be scored properly
  for free; a single-business analysis no longer costs a whole-list pass.
- Pending: the worker must be redeployed for any of the job changes to take effect, and a free
  whole-list analyse run afterwards applies the stored listing facts. Meta ads has never been
  called once — the wiring is tested, the purchase is not.
