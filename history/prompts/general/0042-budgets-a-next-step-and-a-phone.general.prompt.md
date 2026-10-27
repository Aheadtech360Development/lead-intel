---
id: 0042
title: Budgets, a next step, and a phone
stage: green
date: 2026-10-20
surface: agent
model: claude-opus-5
feature: multi-user
branch: main
user: Aheadtech360Development
command: ("jo abhi baki hain unko bhi banao phir mai saari cheezen chala ker check karoonga")
labels: ["multi-user", "budgets", "responsive", "money", "verification"]
links:
  spec: specs/multi-user/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/db/drizzle/0023_member_budgets.sql (new, applied) — member_budgets + RLS
 - apps/web/lib/budget.ts (new) — budgetFor, canAfford, the window maths
 - apps/web/app/spend/team-budgets.tsx, spend/actions.ts (new) — the administrator's half
 - apps/web/app/spend/page.tsx — a member sees their allowance, not the company's total
 - apps/web/app/records/enrich/{page,actions}.tsx — refused before anything is bought
 - apps/web/app/records/[id]/page.tsx — the next step, from the record rather than from a guess
 - apps/web/app/records/page.tsx, app/ui.tsx, app/globals.css — cards and a bottom bar on a phone
 - apps/web/lib/job-runs.ts — startJobRun stamps who started it
tests:
 - signed in as a real member: 19 screens, 200, 0 errors, 0 horizontal scroll
 - allowance shown, spent counted, refusal seen with its own wording for zero vs unset
 - the administrator's budget table verified with a real member row, then the row removed
 - a phone: 8 lead cards, the table hidden, the bottom bar and its sheet, sign-out reachable
 - database left as found — 4 claimed leads, 2 accounts, 1 budget row
---

## Prompt

> jo abhi baki hain unko bhi banao phir mai saari cheezen chala ker check karoonga

## Response snapshot

**Budgets, end to end.** A table, two policies and the arithmetic that decides whether a purchase
may go ahead: `member_budgets` holds an amount, a period and when it started, and nothing else —
spend is counted, never stored, because a stored total is a second source of truth that goes wrong
the first time a row is deleted. The administrator sets it from the spend screen; the member sees
what is left; the buying screen says so before anything is ticked and the action refuses again
before anything is queued.

**Where a member's spend comes from, and why it is not the ledger.** `provider_calls` has no owner
column — the worker writes it and the worker has no user session. Threading a user id through six
call sites in the worker would buy a number that already exists one level up: a task carries what
it cost, and a task knows who started it. So a member's spend is the sum of their own tasks, and
the screen says so in those words. The administrator's company total still comes from the ledger.

**`job_runs.created_by` had never been written.** The column has existed since the table did and
`startJobRun` never set it, so every task belonged to nobody — which means last session's "your
tasks only" and "your spend only" were filtering on a column that was always null. Found while
building the budget on top of it.

**A next step on every lead**, read from the record rather than invented: nothing has been read ·
a call is already booked · you have spoken to them · the listing has never been bought · there is
an Instagram account nobody has opened · ring them. Six rungs, every one a fact already on the
page.

**A phone gets the product, not a squeezed copy of it.** The sidebar is gone below 900px and a
bottom bar takes its place — four places and a sheet holding everything else, including **Sign
out**, which a phone could not reach at all before. The leads table becomes one card per lead.

**The fault that only the screenshot caught**: the card rules sat *after* the phone block in the
stylesheet, so `display: none` won on a phone — the table was hidden and the cards were hidden too,
and the list disappeared completely while every count still said twelve. A render shows that; a
DOM query saying "12 cards exist" does not.

**Verified against a real member account**, with twelve leads claimed to it and then released, and
with the administrator's budget table checked against a throwaway member that was deleted
afterwards. The database is as it was found: four claimed leads, two accounts, one budget row.

## Outcome

- Impact: budgets exist and bite, every lead says what to do next, and the product is usable on a
  phone including signing out of it.
- Pending: the operator's own walkthrough.
