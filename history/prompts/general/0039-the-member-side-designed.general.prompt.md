---
id: 0039
title: The member side, designed
stage: plan
date: 2026-10-20
surface: agent
model: claude-opus-5
feature: multi-user
branch: main
user: Aheadtech360Development
command: ("LEAD INTEL — COMPLETE USER / MEMBER SIDE UX/UI DESIGN" — a 72-section brief)
labels: ["design", "member", "user-side", "prototype", "accessibility", "information-architecture"]
links:
  spec: specs/multi-user/user-side-functionality.md
  ticket: null
  adr: null
  pr: null
files:
 - design/ui/lead-intel-user.html (new, ~4,630 lines) — 26 screens, 10 drawers, 10 modals
 - specs/multi-user/user-feature-inventory.md (new) — the brief's 42-item audit, with evidence
 - published at https://claude.ai/artifact/H5eMJxoQLTrT2JrBLLFGoi
tests:
 - every screen visited, every drawer and modal opened, in a real browser — 0 page errors
 - every data-go target resolves to a real screen; every drawer and modal reference has a panel
 - 0 elements overflowing their container, 0 broken table cells, 0 horizontal scroll at 390px
 - contrast measured on every text element in both themes rather than judged by eye
---

## Prompt

A 72-section brief for the complete member side, with the user-side functionality document named as
the source of truth and four standing rules: do not remove functionality, do not give a member an
admin's, do not invent what the spec marks as missing, and do not simply strip items from the admin
dashboard.

## Response snapshot

**The navigation is the argument.** An administrator's six groups are about managing a system; a
member manages nothing, so the groups are the four questions in a salesperson's day — *my day ·
find out more · get leads in · how this works* — plus the one shared place. Fourteen destinations,
none of them admin.

**The dashboard opens with what to do, not with what exists.** Five lines, each justified by a
figure the product already holds, each with one button: 11 Priority 1 ready to call · 12 never
looked at · 8 with an unopened Instagram link · 31 imported leads Google cannot answer for · 3 with
a follow-up date. The numbers come after, and each one is a door into the filtered list.

**The lead screen leads with the argument.** Why this business is worth a call, what is wrong with
the evidence beside it, what to say — built from the findings and marked *not written by a model* —
and then the next action. The measurements are below that and the 64 checks are a tab away, grouped
by area with the 17 that nothing we can connect to can answer saying so, each with its reason.

**Nine things are agreed but not built.** They are drawn, because the operator needs to see them,
and every one wears *Not built yet* rather than pretending: notifications, transfers, Showcase,
budgets, assignment, task filters, saved views, task-scoped leads, priority rules as an ordered
list.

**Four faults the render caught that reading could not.**

- A grid with no explicit columns gets an auto track, and an auto track is sized by its content
  rather than its container — one card holding a 560px table dragged a whole column off a phone.
- The act bar's seven buttons pushed the leads page 464px sideways at 390px, and sat under the
  bottom navigation.
- **Contrast was computed, not judged.** White on the accent is 2.4:1 in dark mode, and the
  inverted act bar was 1.2:1. `--on-accent` fixes the first; the bar takes its ink from `--app`.
- `--good`, `--warn`, `--bad` and `--ai` are mark colours — right for a 6px dot, about 4.7:1 as
  11px type on their own tint. Four label inks were added, every status label routed through them,
  and the scale's two palest inks darkened, because this product sets 10–12px type in them
  everywhere. Every text element on every screen now clears 7:1 in both themes; small print clears
  about 9:1.

One more honesty fix the measurement did not catch: an intent check that *fires* is good news, so
`$` wears the money colour rather than the colour of a problem.

## Outcome

- Impact: the member side exists as something clickable in both roles' absence — 26 screens, 42 of
  42 brief items with a location, 0 admin capabilities present.
- Pending: the operator's review. Nothing has been built against it.
