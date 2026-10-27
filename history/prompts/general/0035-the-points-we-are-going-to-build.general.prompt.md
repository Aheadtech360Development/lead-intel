---
id: 0035
title: The points we are going to build
stage: tasks
date: 2026-10-15
surface: agent
model: claude-opus-5
feature: multi-user
branch: main
user: Aheadtech360Development
command: ("Design abhi nhi banao pehle mujhe proper points likh kerdo jo hum abhi banayenge")
labels: ["multi-user", "notifications", "transfers", "tasks", "plan"]
links:
  spec: specs/multi-user/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/multi-user/spec.md — three answers recorded, section 10 added for notifications
 - specs/multi-user/tasks.md (new) — nine stages, 58 points, each with a check
tests:
 - none — still planning. Nothing built.
---

## Prompt

> 1. User kisi ko bhi bhej sakta hai.
> 2. Reject hui request aik din ke baad dubara bhej sakte hain.
> 3. Aik notification bhi bana do … jo jo task done hojaye aur jo jo functionality done, assign,
>    delete aur jo jo hai woh sab notifiaction mai ajaye. Admin ko apne notification ayen aur users
>    ko apne apne.
>
> Design abhi nhi banao pehle mujhe proper points likh kerdo jo hum abhi banayenge.

## Response snapshot

The three answers went into the spec, and the notification requirement turned out to be larger
than a feature: it is the thing that makes the rest of the system legible once more than one
person is using it. Section 10 lists nine events that write one, and sets the shape — **a list,
not an alarm**. The five-second toast stays as it is, because that is for the thing in front of
you; the notification list is for what happened while you were elsewhere. Read is a state per row,
and opening the panel does not blanket-clear it: a notification nobody has acted on should still
be there tomorrow.

`specs/multi-user/tasks.md` is the answer to what was actually asked — **58 points in nine
stages**, each with a check written so it can be shown on screen or run as a query rather than
argued about ("Pressing *See the leads* after a 10-lead task shows 10 rows, not 559").

The ordering is by dependency, and one stage moved because of it: notifications are built at
Stage 4, before transfers, because transfers, deletions and budgets all write to them and building
those first would mean coming back three times.

Five conditions run across every stage rather than sitting in one: no regression in what the admin
has today; the service-role key never enters `apps/web`; every refusal explains itself; an unknown
fact is never treated as a no; tests stay green.

## Outcome

- Impact: an agreed, checkable build list. Nothing is left to be interpreted at build time.
- Pending: the operator's go-ahead, then Stage 0 — the refresh fault, which is small and is
  annoying them daily.
