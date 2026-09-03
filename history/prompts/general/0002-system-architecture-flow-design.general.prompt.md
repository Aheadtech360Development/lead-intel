---
id: 0002
title: System architecture flow design
stage: general
date: 2026-08-13
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (direct request — design the full system flow, deployment, frontend and backend)
labels: ["architecture", "deployment", "frontend-flow", "backend-pipeline", "data-model", "diagrams"]
links:
  spec: lead-intelligence-enrichment-system-final-specification-v3.2.md
  ticket: null
  adr: null
  pr: null
files:
 - system-architecture.md (created)
 - Lead Intel Blueprint artifact — https://claude.ai/code/artifact/53fe385b-b5ab-4799-a09f-e41ee093f8c7 (published)
tests:
 - Every fact traced back to Spec v3.2, scoring model, audit catalogue, or build guide — no new decisions introduced (PASS)
 - Stage costs reconcile with §8.2.3 ceilings: $0.25 + $0.05 + $0.07 per record (PASS)
 - Signal and worker names match the build guide repository structure exactly (PASS)
---

## Prompt

mujhe claude design mai poora flow bana ker desakte ho ke konsi cheez kisse connect hogi or kahan deploy hogi ye sab, frontend ka bhi poora flow bana dena or backend ka bhi or backend ka ye bhi batana konsi cheez kahan deploy hogi, thora detail mai chahye hoga jisko dekhte hi samajh ajaye ke hum ker kia rahe hain.

pehle hum ye wala kaam kerlete hain phir hum development start kerne se pehle design kerlenge

*(Follow-up: "haan bana do file" — asked for the markdown companion in the repo.)*

## Response snapshot

Produced a visual architecture reference (published artifact) and a markdown companion in the
repo. Nine sections, five diagrams: deployment topology, requests-vs-runs, the pipeline funnel
with the Stage 2.5 gate, frontend data flow, and the ten-table ER diagram.

**Design decision that carried the page:** colour is semantic, not decorative — teal marks the
free path (class A checks, no per-record cost), amber marks anything metered, brick marks
blocked/failed. Because the entire architecture is shaped by the spend gate, encoding cost class
in colour means the deployment diagram answers "where does the money go" at a glance rather than
requiring the reader to cross-reference the cost model.

**Content:** four hosts with what breaks if each goes down; the requests-vs-runs comparison drawn
as a before/after because it is the highest-cost architectural mistake available; per-stage table
of reads/writes/external calls/cost; eight screens with the seven-read/one-spend asymmetry made
explicit; the three load-bearing backend mechanisms (identity keys table, provider call ledger,
field-level provenance); error taxonomy with operator-visible effects; crawl policy; secrets
matrix showing the service role key confined to Trigger.dev; build order mapped onto the
architecture; and a closing section naming the two soft assumptions the volumes rest on.

No new decisions were introduced — the document is a view onto the approved specification set.

## Outcome

- ✅ Impact: the system is now legible in one view. A developer can see where each piece deploys
  and what calls what; the CEO can see where the budget goes without reading the cost model.
- 🧪 Tests: three consistency passes (fact traceability, cost reconciliation, worker naming) —
  all passed.
- 📁 Files: 1 created in repo, 1 artifact published.
- 🔁 Next prompts: pre-development design pass (the user's stated next step); then §18 items 8/9
  provider tests and Phase 1 schema work.
- 🧠 Reflection: the funnel diagram was the one that could not be expressed in a standard
  diagramming grammar — the 3,700 → 1,100 → 325 narrowing had to be hand-drawn to make the ratio
  visible. The markdown companion substitutes a flowchart with the numbers on the edges, which
  states the same facts but does not show the proportion. Worth knowing that the two versions are
  not equivalent on that one figure.

## Evaluation notes (flywheel)

- Failure modes observed: first draft of the funnel had labels positioned inconsistently
  (one inside its band, two above), and a zero-width dead path left in the SVG. Caught on review
  before publishing.
- Graders run and results: fact traceability PASS; cost reconciliation PASS; naming consistency
  PASS.
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): once real gate pass rates exist, update §11's two
  assumption rows and re-derive the volumes — every number in the document flows from those two.
