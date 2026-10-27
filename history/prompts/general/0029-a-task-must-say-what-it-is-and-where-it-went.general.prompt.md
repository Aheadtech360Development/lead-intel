---
id: 0029
title: A task must say what it is and where it went
stage: general
date: 2026-10-14
surface: agent
model: claude-opus-5
feature: none
branch: main
user: Aheadtech360Development
command: ("mene aik task chalaya tha ab mujhe nhi pata ye chal raha hai ya ruk gaya hai ya complete ho chuka hai … wahan jane ka button ya define to ho humne task kis cheez ka chalaya tha")
labels: ["jobs", "progress", "honesty", "navigation", "ui"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - apps/web/lib/job-runs.ts — JOB_KINDS, jobTarget, jobState, JOB_STATE_WORDS
 - apps/web/app/running-jobs.tsx — the state in a word, what the kind does, where its result lives, a still bar when nothing is happening
 - apps/web/app/tasks/page.tsx (new) — every task, running and finished
 - apps/web/app/ui.tsx — Tasks in the sidebar, under a new Activity group
tests:
 - 676 tests across 41 files, all passing; six workspaces typecheck clean
 - the live example that prompted this: an audit-site row queued 19h 54m, never picked up, nothing spent
---

## Prompt

> acha ab ye dekho mene aik task chalaya tha ab mujhe nhi pata ye chal raha hai ya ruk gaya hai ya
> complete ho chuka hai or ab mujhe ye bhi nhi pata ke ye kis cheez ka chalaya tha to isko sahi se
> banao aur jis cheez ke baare mai banaya hai wahan jane ka button ya define to ho humne task kis
> cheez ka chalaya tha

With a screenshot: the banner reading "A task has gone quiet — Reading Eva's Braiding & Beauty
Supply website, page by page · waiting to start · 19h 54m".

## Response snapshot

Three omissions, all in the same line of the screen.

**1. The state was never said.** The row carried a label, a striped bar that moves whatever is
happening, and the words "waiting to start" — for nineteen hours. There are six states worth
telling apart and the screen showed none of them, so every job looked alike:

- **Waiting to start** — queued, normal, moments old
- **Never started** — queued for hours. Nothing picked it up, which almost always means no worker
  was running when the button was pressed. This is the live row, and the old screen called it
  "waiting", which is the opposite of true
- **Running · Gone quiet · Finished · Stopped**

Each is now a word in its own colour, and the bar stops moving when the job is not. A stripe that
animates while nothing is happening is not a neutral choice — it is the screen saying something
untrue.

**2. What the task was for.** `JOB_KINDS` gives each of the seven kinds a name and a sentence in
the operator's words — what it does, and whether it costs anything. One run's label names the
business; the kind explains the work.

**3. Where its result lives.** Every row carries a button to it: a job about one business opens
that business, and otherwise the kind decides — a search goes to Find businesses, a purchase to
Data & spend, an ICP pass to ICPs. It is almost never the screen the job was started from, which
is why it could not be guessed.

And the gap underneath all three: when a task **finishes**, the banner disappears and there was
nowhere in the product to look it up afterwards. "Did that import actually work?" had no answer.
`/tasks` is now a record of every run, newest first, with its state, what it was, what it produced
or why it ended, what it cost, and the same link onward.

## Outcome

- Impact: a running task can be told from a stuck one and from a finished one, in a word, without
  waiting; and every task says what it was for and where to look.
- Pending: the 19h row is left as it is — nothing was spent and Stop now explains itself, so
  clearing it is the operator's call. The worker is deployed, so a task started now will be picked
  up.
