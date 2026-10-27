---
id: 0036
title: Nine things defined for a design prompt
stage: plan
date: 2026-10-15
surface: agent
model: claude-opus-5
feature: multi-user
branch: main
user: Aheadtech360Development
command: ("ye 9 stages ko proper definition ke saath do … mujhe new design ke lye prompt likhwana hai phir us prompt ko tumhe doonga phir tum design banana")
labels: ["multi-user", "design", "definitions", "plan"]
links:
  spec: specs/multi-user/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/multi-user/design-brief.md (new) — the nine defined for design, plus what changes in the design that exists
tests:
 - none — definitions only. Nothing built, nothing designed.
---

## Prompt

> ye 9 stages ko proper definition ke saath do ke hum ab ye 9 new cheezen add karenge current
> project mai, q ke mujhe new design ke lye prompt likhwana hai phir us prompt ko tumhe doonga phir
> tum design banana. Hum jo current system design hua wa hai shayad usko bhi thora change karenge.

## Response snapshot

Nine definitions, each written to the shape a design prompt needs rather than the shape a build
list needs: what it is, who it is for, **what screens it adds, what screens it changes**, and the
design problems worth naming out loud.

Two things were added because the request mentioned the existing design might move.

**A preamble naming the single change that runs through all nine.** Lead Intel was built for one
person looking at one list, and every screen assumes it. From here there are two kinds of person
and a question attached to every object on screen — *whose is this?* — which has to be answerable
at a glance without turning the product into a permissions console, and must never be answered by
showing one person another's work. The same screen now means two different things depending on who
opened it, and that is one screen being honest, not two screens.

**A table of the existing surfaces and how each one moves** — sidebar, top bar, dashboard, leads,
lead detail, tasks, spend, ICPs, How it works, and empty states. The last of those is the quiet
one: "nobody has looked yet" and "you have not been given any yet" are different sentences that
currently share one.

Each definition carries the problems a designer will hit rather than leaving them to be
discovered: assigning 423 leads to four people is a split and not a form; a pending transfer must
read as "asked for" and not "gone"; a score is measured while a priority is decided and the same
screen shows both; a shared lead and a shared saved view are different kinds of thing and should
not look alike.

Closed with six things a design must not break, each of which was the fix for something that went
wrong earlier: refusals explain themselves, the third answer stays three states, prices name who
bills them, violet means a model wrote it, small print is read rather than squinted at, and no
client-side JavaScript beyond the one exception.

## Outcome

- Impact: the operator has what they need to write the design prompt in their own words.
- Pending: their prompt, then the design. No build has started.
