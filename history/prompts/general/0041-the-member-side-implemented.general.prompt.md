---
id: 0041
title: The member side, implemented
stage: green
date: 2026-10-20
surface: agent
model: claude-opus-5
feature: multi-user
branch: main
user: Aheadtech360Development
command: ("Now take the finalized Member/User Side design and implement it as the actual production-ready interface")
labels: ["multi-user", "roles", "rls", "member", "implementation", "verification"]
links:
  spec: specs/multi-user/user-side-functionality.md
  ticket: null
  adr: null
  pr: null
files:
 - apps/web/lib/viewer.ts (new) — getViewer, leadScope, requireAdmin
 - apps/web/app/analysis/page.tsx (new) — website analysis across the whole list
 - apps/web/app/calls/page.tsx (new) — a person's own call history
 - apps/web/app/priority-rules/page.tsx (new) — read-only, from the live constants
 - apps/web/app/notifications|transfers|showcase/page.tsx (new) — agreed, not built, and labelled so
 - apps/web/app/ui.tsx — NAV rebuilt to the approved six groups; NotBuilt and AdminOnlyNotice
 - apps/web/app/{dashboard,records,records/[id],instagram,tasks,spend,icps,checklists}/page.tsx — scoped
 - apps/web/app/{icps,checklists,search/confirm}/actions.ts — requireAdmin on 8 server actions
 - apps/web/app/globals.css — overflow-x clip; the phantom 196px scrollbar
 - apps/web/lib/job-runs.ts — job queries take a person
tests:
 - a real member account created and signed in: 19 screens, all 200, 0 page errors
 - "Find businesses" absent from a member's navigation; /search answers with the reason
 - 0 horizontal scroll on every screen (was 196px on all of them)
 - verified twice — with the member owning nothing, and owning twelve real leads
 - tsc --noEmit clean on apps/web after every step
---

## Prompt

Implement the approved member side for real: keep the information architecture, preserve every
supported capability, respect the admin boundary, never fake what is not built.

## Response snapshot

**The role was in the database and nothing read it.** `user_roles` has existed since the first RLS
migration; `apps/web` had never looked at it, because there was one account. `lib/viewer.ts` is now
the single place that asks — `getViewer`, `leadScope`, `requireAdmin` — so no screen can disagree
with the navigation about what a member may see. Least privilege where it is unclear: a signed-in
account with no row is a **member**, never an admin.

**The navigation is the approved one**: Workspace · Intelligence · Work · Data · Reference ·
Shared, with Find businesses present only for an administrator. Three new screens carry real data
(**Website analysis**, **Calls & history**, **Priority rules**, the last two read-only), and three
are drawn as what they are — agreed, not built — rather than faked: notifications, transfers,
Showcase.

**The boundary is in three layers, not one**: the link is hidden, the page refuses the address with
a sentence rather than a 403, and eight server actions call `requireAdmin`. The lead detail returns
*not found* for a lead that is not yours, because telling someone a record exists but is not theirs
leaks the list.

**Three faults that only running it could find.**

- **`businesses.place_id` does not exist.** Two of my own queries selected it, PostgREST refused
  them, and both pages silently rendered zeroes. The Google listing id is a row in
  `identity_keys`. Typescript cannot see this; a member signing in did.
- **A member's dashboard was reading the whole company's numbers** — *"95 Instagram accounts not
  looked up"*, *"email found on 298 sites"* — because `field_metadata`, `outcomes` and
  `identity_keys` are keyed by business, not by person, and were pulled whole. Every one of them is
  now cut to the viewer's own businesses before a figure is counted.
- **Every screen in the product had a 196px horizontal scrollbar**, for a hover message nobody was
  hovering: the help tooltip is a 300px fixed pseudo-element and it widened the page. `overflow-x:
  clip` (not `hidden`, which would break every sticky heading).

Two smaller ones worth naming: the leads list told a member with no leads *"Nothing matches — no
business fits every filter"*, which is the wrong empty state and the one the design says must never
be collapsed; and the product still said **51 checks** in eight places.

**Verified as a real member.** A test account was created, given `role = member`, signed in
locally, and walked through all nineteen screens twice — once owning nothing, once owning twelve
real leads — with screenshots. Afterwards the twelve were released and the database left exactly as
it was found: four claimed leads, as before.

## Outcome

- Impact: the member side exists in the product, not only in the prototype, with the boundary
  enforced in the app and every screen scoped.
- Pending: the lead detail's Overview order, the leads table's phone layout, and budgets — which
  cannot be built until an admin can set one.
