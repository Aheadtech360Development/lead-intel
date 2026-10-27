---
id: 0028
title: Run it, and make the filters the drawer
stage: general
date: 2026-10-13
surface: agent
model: claude-opus-5
feature: none
branch: main
user: Aheadtech360Development
command: ("chala lo masla nhi hai bus sab kuch sahi chalna chahye aur ye filter wesa q nhi banaya jesa design mai banaya tha")
labels: ["scoring", "regression", "demand", "filters", "drawer", "ui", "deploy"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - packages/core/src/scoring/score.ts (+ 3 regression tests) — the demand rescue applies after area scoring too
 - apps/jobs/run-listing-facts.mjs (new, free, local) — apply stored Google facts, then re-score everyone
 - apps/web/app/records/page.tsx — one Filters drawer instead of eleven dropdowns
 - apps/web/app/globals.css — .scrim, .drawer, .fgroup
tests:
 - 676 tests across 41 files, all passing; web and jobs typecheck clean
 - live: listing facts answered for 338 businesses, everyone re-scored twice (once before the regression was found, once after)
 - live: Priority 1 29 → 10 (regression) → 61; businesses with no score 161 → 36; businesses with real R1/R2 79 → 414
 - worker deployed to Trigger.dev as version 20261013.1
 - /records?filters=1 renders and returns 200
---

## Prompt

> chala lo masla nhi hai bus sab kuch sahi chalna chahye aur ye filter wesa q nhi banaya jesa
> design mai banaya tha

## Response snapshot

**The run found a regression I had introduced an hour earlier, which is the point of running it.**

Scoring the Google rating and review count for every business — correct in itself — gave the REP
area a score for businesses whose website could not be read. That took them out of the branch the
demand rescue lived in, and because their review checks all *pass*, REP scored 0 and the Problem
score followed it down. Kiwi Beauty Supply — 4,858 reviews, 4.7 stars, no readable site — came out
at **Problem 0, Priority 4**. Nineteen of the best leads on the list did the same, and Priority 1
fell from 29 to 10.

The rescue now runs on the presence state rather than on "nothing was measured", which is what it
always meant: `unclear` is the one state that says the site could not be read, and a site that was
read lands on one of the other four. The Problem score takes whichever is higher, so the override
can only ever raise a business, never quieten one the checks found fault with. Three regression
tests hold it, including the one that keeps Michaels out.

Afterwards: 414 businesses have real reputation checks instead of 79, 36 are unscored instead of
161, and 61 are Priority 1 — more than the original 29, because the rescue now reaches businesses
whose listing had been bought as well.

**The filters are the drawer from the design.** One Filters button carrying a count, chips beneath
it for what is on, and every filter in a single panel that slides in from the right — ICP,
priority, website, reviews, where, Instagram and ads, origin, and the two that are switched off
with their reason. It is a URL (`?filters=1`), so it survives a navigation, can be linked to and
closes by going back; the scrim behind it is a link. Still no client-side JavaScript. The eleven
`<details>` dropdowns are gone: they were honest about state and wrong about shape — only one could
be open at a time, and the row wrapped onto three lines on a laptop.

## Outcome

- Impact: the list is scored on everything the product actually knows, the best leads are back at
  the top, and filtering is one place rather than eleven.
- Pending: the operator has not yet seen the drawer; Meta ads has still never been purchased once.
