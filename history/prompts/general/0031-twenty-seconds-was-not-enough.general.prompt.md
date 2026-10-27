---
id: 0031
title: Twenty seconds was not enough
stage: general
date: 2026-10-14
surface: agent
model: claude-opus-5
feature: none
branch: main
user: Aheadtech360Development
command: ("abhi mujhe ye batao ager mai koi task chalaon to kia woh task chalega aur cheezen nikaal ker dega")
labels: ["render", "playwright", "timeout", "audit-site", "verification", "deploy"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - packages/providers/src/render/render-page.ts — NAVIGATION_TIMEOUT_MS 20s → 35s, with the measurement that forced it
 - apps/jobs/src/audit-site.ts — the home page gets one retry on a timeout, and only the home page
tests:
 - 676 tests across 41 files, all passing; six workspaces typecheck clean
 - reproduced: ninjatransfers.com rendered 13.9s cold through the worker's own code, then timed out past 20s on the next attempt
 - after the change: three consecutive renders at 9.2s, 11.3s, 11.9s — all ok, 1.9 MB each
 - end to end on the live worker: audit-site for Ninja Transfers COMPLETED in 256s — 8 pages, 6 readable, 6 critiqued, 2 screenshots, website status corrected to live, re-scored to Problem 22.1 / Priority 2 on 39 measured checks, 0.342¢ with Google AI Studio
 - local dev worker 20261014.1 running; production worker redeployed as 20261014.1
---

## Prompt

> abhi mujhe ye batao ager mai koi task chalaon to kia woh task chalega aur cheezen nikaal ker dega

## Response snapshot

Checked rather than claimed — and the check found the next fault, in the operator's own two runs
from a few minutes earlier. Both had executed properly and both had produced **nothing**:

    The home page could not be read (timeout), so there was nothing to find the other pages from.

One of them was **Ninja Transfers**, a busy working business whose site the plain crawler reads
fine. Reproduced through the worker's own code: the home page rendered in **13.9 seconds** cold and
went past twenty on the next attempt, against a 20-second navigation budget. So the budget was
sitting exactly on the edge of normal, and every heavy site was being written up as broken — which
reads as a verdict about the business and was nothing of the kind.

Two changes. The budget is now **35 seconds**, which costs nothing on a healthy site because
navigation ends when the document does, and only spends the extra on the sites that need it. And
the **home page gets one retry** on a timeout — only the home page, because a timeout there does
not cost one page, it costs the whole site: every other page is found by following links from it.

Then the actual task was run on the live worker rather than described. It read 8 pages, 6 of them
fully, had the model judge all 6, kept 2 screenshots, corrected the website status to live and
re-scored the business — for **0.342¢** with Google AI Studio. The home page took **21.2 seconds**,
which is the old limit plus 1.2.

The answer to the question, in full: website analysis, browser reads, AI critique, scoring, ICP
matching, PageSpeed and YouTube all work and were exercised. The paid lookups have their keys and
ask before spending — Meta ads has still never been bought once. DataForSEO and Lusha are not
connected and will not run. And a task started from localhost needs `trigger dev` going, because
that key is `tr_dev_`.

## Outcome

- Impact: heavy sites are read instead of being recorded as broken; the first real browser audit
  since the fix produced eight pages and a new score.
- Pending: Meta ads untested as a purchase; the local worker lives only as long as its terminal.
