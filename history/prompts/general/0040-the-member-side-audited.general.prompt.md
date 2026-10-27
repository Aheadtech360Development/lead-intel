---
id: 0040
title: The member side, audited
stage: refactor
date: 2026-10-20
surface: agent
model: claude-opus-5
feature: multi-user
branch: main
user: Aheadtech360Development
command: ("LEAD INTEL — FINAL USER SIDE UX AUDIT & IMPROVEMENT" — a 48-section brief)
labels: ["design", "member", "audit", "information-architecture", "accessibility", "density"]
links:
  spec: specs/multi-user/user-side-functionality.md
  ticket: null
  adr: null
  pr: null
files:
 - design/ui/lead-intel-user.html — 26 screens to 27, 10 drawers to 12, 10 modals to 11
 - specs/multi-user/user-feature-inventory.md — a second section: what the audit found and what was done
 - republished to https://claude.ai/artifact/H5eMJxoQLTrT2JrBLLFGoi (version 2)
tests:
 - every screen, drawer and modal re-opened in a real browser — 0 page errors
 - 0 layout faults, 0 horizontal scroll at 390px, every data-go target resolves
 - contrast swept across every text element in both themes — 0 under 7:1
 - the sidebar's user chip asserted on screen at 760px tall
---

## Prompt

A 48-section brief: audit the member side already built, fix what is confusing, duplicated,
hard to find or wrongly placed, and keep 100% of the supported functionality. *"If it is not
appropriate for the main dashboard, MOVE IT. Do not delete it."*

## Response snapshot

The audit was run against the file rather than from memory — grepping the markup for each
capability the specification lists. It found six real holes, and the first two were the kind that
only an audit catches, because nothing on screen looks wrong:

1. **The analysis had no home.** Coverage, the 64 checks and the pages that failed existed only
   inside a single lead, so a member could not ask *which of mine are standing on nothing* or
   *what could not be read*. A **Website analysis** screen now answers both, from figures the
   product already holds. The per-lead tab is untouched.
2. **`explainBusiness` was missing entirely** — a supported ~0.3¢ feature with no way to reach it.
   A paid feature that cannot be reached is a removed feature. It is back, with a confirm step,
   because every other purchase has one.
3. **No way to type in an Instagram handle**, though `saveInstagramUrl` is built and free — and a
   wrong handle is what wastes the 0.26¢.
4. **Claim was reachable only by ticking a row.**
5. **Nine destinations were unreachable on a phone** behind five fixed buttons.
6. **Tasks sat beside Instagram under "Find out more"** — a piece of work filed under learning.
   The navigation is now Workspace · Intelligence · Work · Data · Reference · Shared, with the
   states gallery moved under *For this preview only*, since it is a preview aid and not a screen
   in the product.

**Smaller faults, all real:** `.act` ran a title into its own detail — *"Logged a call — Kirra's
BraidsInterested · call back Friday"*; priority rules showed **drag handles** on rules a member
cannot reorder; the spend ledger was a dead end, and now every charge links to the lead, the task
or the pages it paid for; the clear-selection button carried `color:#fff` inline and measured
**1.2:1** on the act bar in dark mode; the sidebar grew to sixteen destinations and pushed the user
chip off a laptop screen, so the destinations scroll and the chip is pinned.

**Density was taken seriously and typography was not touched.** Table rows, cards, sections and the
sidebar each lost two or three pixels. No type size changed — the text is already at the size this
product reads best at, and shrinking it would undo the contrast work rather than add information.

## Outcome

- Impact: 27 screens, 12 drawers, 11 modals; 42 of 42 preservation items still located; 0 admin
  capabilities present; 0 text elements under 7:1 in either theme.
- Pending: the operator's review. Nothing has been built against it.
