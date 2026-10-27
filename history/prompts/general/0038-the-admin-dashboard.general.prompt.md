---
id: 0038
title: The admin dashboard
stage: plan
date: 2026-10-19
surface: agent
model: claude-opus-5
feature: multi-user
branch: main
user: Aheadtech360Development
command: ("COMPLETE ADMIN DASHBOARD — PROFESSIONAL UX/UI REDESIGN" — a 68-section brief)
labels: ["design", "admin", "dashboard", "information-architecture", "dataviz", "prototype"]
links:
  spec: specs/multi-user/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - design/ui/lead-intel-admin.html (new, ~3,270 lines) — 22 screens, 11 drawers, 15 modals
 - published at https://claude.ai/artifact/LaasoygK16bzJ1J2pdeUEd
tests:
 - every nav destination visited, every drawer and modal opened — no page errors
 - 0 table cells left broken, 0 elements overflowing their container, no horizontal scroll at 390px
 - light and dark both captured
 - the chart palette was run through the dataviz validator rather than eyeballed
---

## Prompt

A 68-section brief for a production-ready admin dashboard, with the existing system named as the
**functional** source of truth and explicitly not the visual one: *"Do not blindly follow the
existing template."*

## Response snapshot

Twenty-two screens, built on the product's own design system so this is a redesign of the
architecture rather than a second visual language.

**The navigation was rebuilt rather than copied.** Six groups in the order an administrator thinks:
what is happening · what I manage · what the system knows · what it is doing · what it costs · how
it is configured. Sixteen destinations, no group larger than four.

**The dashboard is an argument, not a wall of cards.** What is wrong comes first, because the brief
is right that making an admin discover problems is the failure. The top line is the real one this
system has: *no worker is running, so nothing can start* — with the consequence spelled out and the
fix a click away. Then the numbers, then what is running, then health, then the trend, then what
just happened.

**Charts followed the method rather than taste.** The dataviz validator was run on the candidate
palette and **failed it** — red↔amber separate by ΔE 1.9 under deuteranopia, teal↔green by 9.2 even
in full colour. That is the correct answer, and it settled the design: these are *status* colours
used one at a time with a label, never a categorical series set. So every chart is single-hue
magnitude, a status pair with a legend, or — for priority, which is a **rank** — four steps of one
hue in order. No chart exists that does not answer a question an admin asks.

**Two faults the render caught that reading could not.** `.src` is an inline-flex source marker,
and putting it on a `<td>` stops that cell being a table cell — four columns of the tasks table
were scattered and it looked like a styling whim. And a subtitle marker jammed against its heading
in two places. Both now have a guard rather than a correction, so the next use cannot repeat them.

**Nothing was dropped.** Every capability in the system has a location: the 64 checks appear
grouped by area with per-group scores and individual checks behind a disclosure; the 17 that no
connected source can answer say so with their reason; the paid lookups keep their price, provider
and cap; AI output stays violet and labelled; roles are a permission matrix grouped by what is
being managed; the worker, the providers and the two unconnected ones all appear under
Integrations with what each one blocks.

## Outcome

- Impact: an admin design that covers the system as it actually is, including the parts that cannot
  answer and the parts that are currently broken.
- Pending: the operator's review. Nothing has been built against it.
