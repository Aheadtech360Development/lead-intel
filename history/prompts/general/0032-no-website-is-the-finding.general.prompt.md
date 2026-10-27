---
id: 0032
title: No website is the finding
stage: general
date: 2026-10-15
surface: agent
model: claude-opus-5
feature: none
branch: main
user: Aheadtech360Development
command: ("Problem score — how much is wrong ye abhi bhi sahi score nhi ker raha hai … jab task done hojaye to auto reload hojaye aur task done ka notification 5 sec ke lye ajaye")
labels: ["scoring", "presence", "jobs", "progress", "toast", "ui"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - packages/core/src/scoring/score.ts (+ 4 tests) — a listing Google says has no website scores as the problem it is
 - apps/web/lib/job-runs.ts — loadJustFinishedJobs, JUST_FINISHED_MS, REFRESH_WHILE_RUNNING_SECONDS
 - apps/web/app/running-jobs.tsx — FinishedToast, and the refresh moved from 60s to 10s
 - apps/web/app/ui.tsx — the toast on every screen
 - apps/web/app/globals.css — a toast that takes itself away after five seconds, with no JavaScript
tests:
 - 680 tests across 41 files, all passing; six workspaces typecheck clean
 - live before: 49 businesses whose Google listing has no website averaged Problem 53.4, down to Priority 4
 - live after: the same 49 average Problem 90.4, Priority 1–3; 36 businesses moved, Priority 3 205 → 241
 - the toast measured in a real browser: opacity 1 at 0.9s, opacity 0 and visibility hidden at 5.7s
---

## Prompt

> woh task wala system to sahi hogaya hai lekin "Problem score — how much is wrong" ye abhi bhi
> sahi score nhi ker raha hai to isko sahi karo proper karo aur aik main cheez ye hai ke jab task
> done hojaye to auto reload hojaye aur task done ka notification 5 sec ke lye ajaye

## Response snapshot

**The score.** 193 of 559 businesses sit at `unclear` — "couldn't check" — and 49 of them are there
for a reason that is not uncertainty at all: **Google's listing has no website**. S6 fires on
exactly that, and it is a fact Google reports rather than an inference from a failed crawl.

`classifyPresence` refuses to return `no_website` on purpose — §4 wants three checks, the listing
field, a Facebook lookup and a name search, and only the first exists. That refusal is right about
*certainty* and was wrong about *consequence*: those 49 averaged **Problem 53.4 and Priority 3**,
when "no website at all" is the biggest problem a local business can have and the clearest thing
this agency sells.

So the certainty stays exactly where it was — the status is still `unclear`, the record is still
flagged for a human — and the score stops pretending the question is open. §6.2's presence override
gains a fourth case, and the reason line says what is known and what is not: *"Google's listing
carries no website at all. Confirming it absolutely would also need a Facebook check and a name
search, which this system cannot do yet — so treat it as very likely rather than certain."*

The 49 now average **90.4**. 36 businesses moved up. A site that loads is explicitly excluded — the
test that caught that confusion is in the suite.

**The task notification.** Two halves that only work together: the page comes back by itself every
**10 seconds** while something is running (not 60, which was most of the reason for the complaint;
not 5, which was tried and made the product feel broken), and a **toast** says what just happened —
otherwise a page that quietly reloads with new numbers looks exactly like a page that was always
like that.

It carries the task's name, what it produced, and a link to where the result lives, and it takes
itself away after five seconds through a CSS animation with `forwards`, so the last frame is
invisible and un-clickable. No JavaScript, like everything else here. Measured in a real browser:
opaque at 0.9s, gone at 5.7s.

## Outcome

- Impact: the strongest web-development leads in the list are priced as such; a finished task
  announces itself and the screen refreshes without being asked.
- Pending: confirming "no website" outright still needs the Facebook check and the name search
  neither of which exists; until then the record stays flagged.
