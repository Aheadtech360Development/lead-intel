---
id: 0016
title: Listing checks, the WEB scoring fix, and opening lines
stage: green
date: 2026-08-20
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (continuation — "sahi hai ab age chalte hain" / "age berho or jo behter ho woh kerte hue complete karo")
labels: ["feature", "phase-5", "places-details", "scoring", "outreach", "spec-5.3", "spec-5.4", "spec-8.2", "verified-not-assumed"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/providers/src/google-places/place-details.ts (new)
 - packages/core/src/checks/listing.ts + test (new — S1/S3/S5/S6, R1/R2)
 - packages/core/src/outreach/opener.ts + test (new — §8.2's opening lines)
 - packages/core/src/scoring/areas.ts (W1-W3 excluded from the WEB area score)
 - packages/shared/src/pricing.ts (PLACES_DETAILS_COST_CENTS)
 - apps/jobs/src/listing.ts (new), run-listing.mjs (new — refuses to spend without --confirm)
 - apps/web/app/records/[id]/page.tsx (openers, Google listing, area scores)
tests:
 - 392 across three packages (core 306, providers 78, db 8) — all passing
 - npm run typecheck — clean across all 6 workspaces
 - Live: 75 listings bought for $2.62, 0 failures; openers spot-checked against the top six leads
---

## Prompt

"sahi hai ab age chalte hain", then "age berho or jo behter ho woh kerte hue complete karo" — go
on and finish it, using my own judgement on the open questions.

## Response snapshot

**Google listing checks.** S1, S3, S5, S6, R1 and R2 now come from Places Details. SEO and REP
were unscoreable for every business in the dataset; they are now scoreable for 75 and 74
respectively. The pass cost **$2.62 for 75 businesses**, every call in `provider_calls`, and the
runner prints a costed plan and buys nothing without `--confirm`. §9's gate is enforced twice —
in the selection query and again inside the function — because that query is what decides how much
a run costs, and one wrong loop elsewhere should not be able to spend the budget.

**Five of the eleven listing checks are unanswerable, established by measurement rather than
assumed.** `photos` and `reviews` return HTTP 200 with an *empty body* on this project's key —
tested against three of our own businesses and then against a Starbucks with 2,243 ratings, which
is what ruled out "these businesses simply have none". So S4, R3, R4 and R5 report themselves
unmeasured with that reason, and S2 does too because Places has no claimed/unclaimed field at all.
A test asserts all five, so the day a source exists the test fails and someone notices.

`listingFound` is `boolean | null` rather than a boolean, which is the whole difference between
"Google has no listing for this business" (S1 firing at 40 points) and "the lookup failed". Two
bugs in my own first wiring came from not having that third state.

**The WEB scoring fix, taken as a judgement call.** W1/W2/W3 restate the §4 presence verdict and
already drive §6.2's override; leaving them in the area sum counted the same fact twice, in the
direction that suppressed it — all three *pass* for any site that loads, contributing 290 of
WEB's 468 points to the denominator and nothing to the numerator. Measured before: WEB averaged
9.4 and could not exceed 19.9 for any working site, however slow or broken. After: **28.1 average,
64.7 peak**, and `web_development` went from 8 routes to 20.

**I estimated that change would move about 5 businesses. It moved 12.** The estimate was run
before the listing data landed and against a different set of competing area scores; I should have
said it was conditional on that rather than quoting it as a figure.

**Opening lines (§8.2 item 5).** Two per business, one for a call and one for a message, each
naming the finding it was built from. §8.3's rule is the design: *"If it cannot, none is
generated."* So there is no template of last resort and no "I noticed a few things about your
website" — a business whose routed area has no usable finding gets no line and a sentence saying
why. The line is drawn from the **routed** area rather than the heaviest finding overall, because
routing has already decided what is being sold and an opener about tracking pixels would undercut
a call meant to sell a rebuild. A test asserts no opener can promise a result, a percentage, or a
ranking — an opener that oversells is worse than none, because the operator has to walk it back
live.

## Outcome

- ✅ Impact: the list is now usable for outreach end to end — every gated business has a tier, a
  Problem and Intent score, a recommended service, the evidence behind it, and two opening lines
  quoting that evidence. SEO and REP went from unscoreable to scored.
- 🧪 Tests: 392 passing (306 core, 78 providers, 8 db), typecheck clean across 6 workspaces.
- 📁 Files: 1 provider, 2 core modules, 1 job helper, 1 runner, 1 page.
- 🔁 Next prompts: S7/S8 need a search-ranking provider, which spec §14 item 3 still lists as
  undecided. The BEST EFFORT social reads (O3/O5/O7/O8) need no new decision and would lift SOC.
- 🧠 Reflection: the honest-naming thread from PHR 0015 continued — `listingFound: boolean | null`
  is the same lesson as `dns_temporary` and `no_score`. Three increments in a row, the bug was a
  missing third state for "we do not know", and each time the two-state version silently produced
  the system's most confident finding.

## Evaluation notes (flywheel)

- Failure modes observed: quoting an impact estimate ("about five businesses") without stating what
  it was conditional on — it was measured against a scoring picture that changed underneath it an
  hour later. The number was right when computed and wrong when repeated.
- Graders run and results: full suite (PASS), typecheck (PASS), live probe of `photos`/`reviews`
  against a control place (FOUND that they are unavailable, before any code depended on them),
  5-business costed trial (PASS), 72-business pass (PASS, 0 failures), openers spot-checked against
  the top six leads (PASS — every line names its finding and reads as something a person would say).
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): five of the top six leads open with the same O1 line,
  because "no social links at all" fires very widely in this dataset. Worth checking whether the
  opener should prefer a *distinctive* finding over the heaviest one when several businesses in a
  batch would otherwise get identical scripts.
