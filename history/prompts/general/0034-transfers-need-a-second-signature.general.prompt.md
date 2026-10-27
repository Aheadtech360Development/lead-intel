---
id: 0034
title: Transfers need a second signature
stage: spec
date: 2026-10-15
surface: agent
model: claude-opus-5
feature: multi-user
branch: main
user: Aheadtech360Development
command: ("kisi user ko doosre user ko leads transfer kerni hon to woh option bhi add kerdo, woh user transfer per dale lekin admin ke approval ke bagher transfer na ho")
labels: ["multi-user", "transfers", "showcase", "spec"]
links:
  spec: specs/multi-user/spec.md
  ticket: null
  adr: null
  pr: null
files:
 - specs/multi-user/spec.md — four answered questions, a new section 5, renumbered throughout
tests:
 - none — still a structure. Nothing built.
---

## Prompt

The three questions left open at the end of the structure, answered, plus one requirement that was
not in the original list:

> 1. ager koi apni banayi hui settings wagera share kerna chahye to woh bhi ker sakta hai.
> 2. Woh User jisne daali hai aur Admin cher sakte hain.
> 3. woh admin ke pass show hojayen phir admin ko jo kerna ho woh kare.
>
> Aik cheez mai aur add kerna chah raha tha ke kisi user ko doosre user ko leads transfer kerni
> hon to woh option bhi add kerdo, woh user transfer per dale lekin admin ke approval ke bagher
> transfer na ho, jese admin reject kerde to woh leads na jayen doosre user ko.

## Response snapshot

**Showcase carries methods as well as results.** A post can attach a lead (only the fields the
author ticks), a saved view, or — for the admin, who is the one who writes them — an ICP, a
checklist rule or a priority rule. The distinction that fell out of writing it down: a lead is
somebody's **data** and is shared in part, while a saved view or a rule is a **method** and is
shared whole, with a button to copy it onto your own list. Posts are edited and taken down by
their author and the admin.

**Transfers, and why they are not the same as letting a lead go.** Releasing a lead back to the
pool needs nobody's permission — it costs only the person giving it up, and the admin redistributes
it. Handing one to a *named* colleague is a decision about somebody else's work and somebody else's
commission, which is exactly the kind that wants a second signature. So: the sender ticks leads and
asks; the leads stay with them and stay fully usable while the request waits; the admin approves or
refuses on the Team screen, and a refusal carries a reason the sender reads.

One case had to be written down because it will happen: a lead that is no longer the sender's by
the time the admin looks — released, or moved by the admin — is skipped, and the decision says so.
A request never resurrects a claim that has already lapsed.

**A person leaving** hands their leads to the admin rather than deleting them or orphaning them,
marked as having come from that person.

## Outcome

- Impact: the structure is complete enough to design against; `lead_transfers` joins the schema
  and transfers join Phase 2 beside assignment.
- Pending: three smaller questions in §13 — whether transfers are open to anyone or only to
  admin-paired colleagues, whether a refused request can be re-sent, and whether a pending request
  should chase the admin or wait to be found.
