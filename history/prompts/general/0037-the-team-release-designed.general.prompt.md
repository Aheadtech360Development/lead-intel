---
id: 0037
title: The team release, designed
stage: plan
date: 2026-10-19
surface: agent
model: claude-opus-5
feature: multi-user
branch: main
user: Aheadtech360Development
command: ("esa kro tum complete design banao phir mai dekhta hoon usko age kia kerna hai")
labels: ["multi-user", "design", "prototype", "roles"]
links:
  spec: specs/multi-user/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - design/ui/lead-intel-team.html (new, ~2,050 lines) — 13 screens, 7 drawers, 6 modals, a role switch
 - published at https://claude.ai/artifact/8toMFdShV2SZwwLt4aZzgv
tests:
 - rendered in a real browser at 1440px and 390px — no page errors, no horizontal scroll on mobile
 - role separation asserted rather than eyeballed: as a member, 0 elements marked admin-only are
   visible; as an admin, 0 marked member-only are
 - light and dark both captured
---

## Prompt

> esa kro tum complete design banao phir mai dekhta hoon usko age kia kerna hai

## Response snapshot

Built from `design-brief.md` rather than from a prompt, on the same design system as the existing
prototype — the stylesheet was extracted from `lead-intel-app.html` programmatically so the two
cannot drift.

**The role switch is the design.** The brief's central problem was that the same screen now means
two different things depending on who opened it, and that this must be one honest screen rather
than two products. So the prototype carries a switch — *Preview as Admin · Member* — and every
screen answers to it: the sidebar loses Find businesses and Team, Leads loses the owner column and
the whose-segment, the bulk bar swaps Assign for Transfer, Spend changes from everyone's total to
your own budget, and ICPs and Priority rules become a read-only "this is how it is set up".

Two faults the preview caught that reading could not:

- `hidden` is `display:none` at the weakest specificity, so every `.navitem` and `.btn` in the file
  was beating it — a member could see the admin's controls. One `[hidden] { display: none
  !important }` and the switch actually switches. Now asserted in the check rather than trusted.
- A leak of exactly the kind decision 6 forbids: the filter row read **“29 of 559 match”** to a
  member who has 84 leads. Every count on the screen is now role-aware, including the ones inside
  the filters drawer.

The screens that needed an argument rather than a layout got one: assigning is a **split** that
shows who gets how many and what is left over; a pending transfer reads "asked for" and never
"gone", and the partial case is drawn — *Approve (2 of 3)*, with the skipped one explained; the
rule builder states that unknown never passes and names the 229 businesses it quietly excludes; and
Showcase draws the distinction the spec arrived at, a lead **shared in part** in quiet grey against
a rule **shared whole** in petrol, because a method is not somebody's data.

## Outcome

- Impact: every one of the nine is now visible and clickable, in both roles and both themes, before
  a line of it is built.
- Pending: the operator's review. Nothing has been built.
