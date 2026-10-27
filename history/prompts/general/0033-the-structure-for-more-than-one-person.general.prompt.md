---
id: 0033
title: The structure for more than one person
stage: spec
date: 2026-10-15
surface: agent
model: claude-opus-5
feature: multi-user
branch: main
user: Aheadtech360Development
command: ("ab kuch new cheezen daalni hain … pehle mujhe design se bhi pehle proper structure banao ke hum kese leker chalenge isko")
labels: ["multi-user", "rls", "permissions", "assignment", "priority", "tasks", "spec"]
links:
  spec: specs/multi-user/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/multi-user/spec.md (new) — the agreed structure, twelve sections
tests:
 - none — nothing was built. The one technical claim in the spec was proved rather than asserted:
   a meta refresh after a client-side navigation returned the browser to the URL the meta was
   parsed with (/login?moved-to-another-page=1 → /login), which is the reported fault.
 - the ground it stands on was read from the live database: user_roles holds one admin,
   private.is_admin() exists, and every table's SELECT policy is currently `true`
---

## Prompt

Five new requirements and one fault, then:

> acha ye kaam start kerne se pehle hum design karenge ke hume kese chalana hai poora system, to
> pehle mujhe design se bhi pehle proper structure banao ke hum kese leker chalenge isko phir hum
> design karenge phir hum development start karenge.

## Response snapshot

Seven questions first, because each one changes the shape of the product and none of them could be
answered from the code. The operator's answers, in their own words where they departed from the
options offered:

1. One record, first finder keeps it.
2. One set of ICPs, checklists and priority rules, written by the admin.
3. *"User bhi paid cheezen ker sake limit ke saath lekin data scrape srif Admin hi ker sake, baki
   file import wagera jo free hai woh sab user ker sakta hai."* — scraping is admin-only; paid
   lookups are open to members under a cap; free work is open to all.
4. The 559 existing businesses to the admin, then handed out.
5. The admin picks each person's budget.
6. *"Hum aik Showcase page bana denge … Baki kuch bhi na dikhe aik user ka doosre user ko."*
7. A member sees their own calls; the admin sees everyone's.

Answer 6 turned out to be the one that decides the most. It rules out the "12 of these are already
someone else's" line that would otherwise soften a search result, and with it every shared count,
every leaderboard and every incidental leak between colleagues — and it creates a screen that was
not in the original list, because a team with every window closed still needs one door.

Written to `specs/multi-user/spec.md`: roles and a permission table, ownership and the collision
rule, how leads are handed out, why adding a user has to run through the worker (the service-role
key never enters `apps/web`), priority as a written policy rather than a formula, money, Showcase,
the navigation fault with its proof, the database changes, six phases, and three questions still
open.

No code was written.

## Outcome

- Impact: a structure the next three stages can be built against, with every load-bearing choice
  traceable to an answer rather than an assumption.
- Pending: the operator's review, then design, then Phase 0 — the refresh fault, which is small,
  diagnosed, and currently annoying them daily.

📋 Architectural decision detected: multi-user ownership enforced in RLS, and a deliberate,
single-file exception to the no-client-JavaScript rule. Worth recording with
`/sp.adr multi-user-ownership-and-rls`.
