---
id: 0023
title: Wiring O8 and a theory that was wrong
stage: green
date: 2026-08-27
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (operator enabled the YouTube API; "ab bacha kia hai")
labels: ["youtube", "o8", "quota", "bugfix", "live-found", "measurement", "unwired-feature"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/providers/src/youtube/find-channel.ts (+test — cheaper calls, playlistItems schema)
 - packages/core/src/checks/social.ts (runVideoChecks — O8 had no implementation at all)
 - packages/core/src/index.ts (export the social module)
 - apps/jobs/src/youtube.ts (new), apps/jobs/run-youtube.mjs (new)
 - apps/jobs/trigger/youtube.ts (new), apps/jobs/trigger/analyse-run.ts
tests:
 - 483 passing (core 384, providers 91, db 8); typecheck clean; all builds green
 - Live: 92 businesses looked up before the daily quota stopped the pass cleanly
---

## Prompt

"mene Youtube ki API connect kerdi hai, calls mai kerloonga baad mai ab bacha kia hai"

## Response snapshot

**The API worked; the feature did not exist.** I had been telling the operator for several rounds
that enabling YouTube would "switch on O8". Enabling it did nothing, because `findYouTubeChannel`
was built, tested, exported — and called by nothing. There was no check function for O8 either,
only a registry entry. The same shape as `/records/import` being unreachable and the analysis
having no button: finished parts, unconnected.

Now wired end to end: `runVideoChecks` in core, `youTubeBusiness` as a job, a runner, a Trigger.dev
task, and a place in the `analyse-run` chain — deliberately last, because it is the only step that
can *run out* rather than finish.

**Two real bugs found by running it rather than trusting it.**

The first pass reported "never posted" for every channel it found. Checking the API directly, the
business in question had uploaded that same week. The cause: a playlist item's `id` is a **string**
where a search result's is an **object**, and I had reused the search schema, so every parse failed
silently and every channel came back empty. Left in, O8 would have told every prospect with a
channel that they had never posted anything on it — a false statement about the exact thing the
check exists to report, and the third instance this month of a check concluding from evidence it
had not actually read.

The second was quota. `search.list` costs **100 units** of a 10,000/day allowance and I was calling
it twice per business; `channels.list` and `playlistItems.list` cost **1 unit each** and answer the
same question. 200 units became 102, and a day went from ~50 businesses to ~98.

**And a theory that measurement killed.** I had proposed R6 as the next fix — 161 businesses told
"no reviews or testimonials anywhere", which looked like the same unread-page bug the operator had
just caught in the social family. Nine of those sites: **none** linked to a reviews page. A second
pass looked for review widgets R6 might not recognise and appeared to find two, but the Yotpo on
`crystaldtf.com` is `yotpo-loyalty-rewards` — a loyalty app, not reviews — which the existing
pattern correctly declines to match. R6 is right. No fix was built, and saying so is the outcome.

## Outcome

- ✅ Impact: O8 produces findings for the first time — 51 with no channel, 48 who post video, 1
  honestly unmeasured. A channel that last uploaded in 2019 is now visible on a lead's record.
- 🧪 Tests: 483 passing (+5), typecheck clean, all builds green.
- 📁 Files: 2 provider, 2 core, 4 job.
- 🔁 Next prompts: the remaining 230 businesses take three more daily passes; then the operator's
  own three.
- 🧠 Reflection: I asked the operator to do a setup step for a feature that was not connected, and
  only discovered it when they came back having done it. Checking that a capability is *reachable*
  before asking someone to enable it is the same discipline as checking a route is linked.

## Evaluation notes (flywheel)

- Failure modes observed:
  - **A built, tested, exported adapter that nothing called.** Third occurrence of this pattern in
    this project. The tests all passed the entire time.
  - **A schema reused across two endpoints with different shapes**, failing silently into a
    plausible answer. `safeParse` returning `success: false` was treated as "no data" rather than
    "this did not parse", which is exactly how a false finding gets manufactured.
  - **My own proposal, wrong.** R6 was presented to the operator as "the same bug, 161 businesses"
    on the strength of a pattern match, before measuring. Two measurements said no.
- Graders: full suite (PASS), typecheck (PASS), builds (PASS), live YouTube pass (PASS — 92
  looked up, clean quota stop, 230 correctly left unwritten), R6 exposure sample (NEGATIVE — no fix
  warranted).
- Next experiment: before proposing work off the back of a pattern, measure the exposure first and
  quote the number. The socials bug was found that way; the R6 theory was killed that way; the gap
  between them was one loose grep that matched a substring.
