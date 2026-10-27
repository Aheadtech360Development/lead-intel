---
id: 0030
title: The run had already expired
stage: general
date: 2026-10-14
surface: agent
model: claude-opus-5
feature: none
branch: main
user: Aheadtech360Development
command: ("ab ye kia ker raha hai abhi tak start hi ker raha hai abhi tak start nhi kia??")
labels: ["jobs", "trigger.dev", "reconciliation", "honesty", "environments"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - apps/web/lib/job-runs.ts — reconcileStuckJobs, settlePlatformStatus, NOT_PICKED_UP_AFTER_MS, jobIsIdle
 - apps/web/app/ui.tsx, apps/web/app/tasks/page.tsx — a row that stopped reporting is checked before it is drawn
 - apps/web/app/running-jobs.tsx — "waiting to start" is no longer printed under the words "a task is running"
tests:
 - 676 tests across 41 files, all passing; six workspaces typecheck clean
 - live: the stuck row reconciled itself on the next page load — "Never started — it waited ten minutes for a worker and then expired"
 - live: local worker started (20261014.1); a free match-icps-run executed end to end — COMPLETED in 85s, 289 matched
---

## Prompt

> ab ye kia ker raha hai abhi tak start hi ker raha hai abhi tak start nhi kia??

With a screenshot of the new Tasks screen: "Waiting to start · 9m 34s", under a banner reading
"A task is running".

## Response snapshot

The answer was not in our code at all, and asking the platform was the only way to find it:

    "status": "EXPIRED",
    "error": { "message": "Run expired because the TTL (10m) was reached" }

The task had been handed to Trigger.dev correctly. **Nothing was listening**, so ten minutes later
the platform expired the run. The run was dead; our row said "queued" for nineteen hours, and then
for nine more minutes on the second attempt.

Two reasons it was not listening, and they are different things:

- The local web app's key is `tr_dev_…`, so a task started from localhost is queued in the **dev**
  environment, which only has a worker while `trigger dev` is running on this machine. The worker
  deployed yesterday is the **production** one, a separate queue. The local worker is now running
  and was proved end to end: a free ICP re-match executed in 85 seconds.
- Our own screen could not have known. **A job row cannot report its own death** — whatever would
  have written the obituary is the thing that is gone.

So the screen now asks the one place that does know. Any row that is queued or running and has
said nothing for two minutes is looked up on Trigger.dev before it is drawn, and a run the platform
calls EXPIRED, CANCELED, FAILED, CRASHED, TIMED_OUT or COMPLETED ends our row with that reason in
the operator's words. A healthy product makes no extra calls at all, and a network failure writes
nothing — recording "the API was unreachable" as "the job failed" would be the same lie pointing
the other way.

Alongside it, two wording faults the screenshot showed plainly: the heading said "A task is
running" above a task that was not running, and a nine-minute wait was still called "Waiting to
start". There is now a **Not picked up yet** state after two minutes, which says what it is waiting
for and that `trigger dev` has to be running for anything local to pick it up; the spinner only
spins when something is actually working.

## Outcome

- Impact: a task that dies on the platform now ends on screen, with the reason, within two minutes
  — rather than claiming to be queued for ever.
- Pending: the local worker runs only while `npm run dev --workspace=@lead-intel/jobs` is going;
  the deployed worker covers the production site.
