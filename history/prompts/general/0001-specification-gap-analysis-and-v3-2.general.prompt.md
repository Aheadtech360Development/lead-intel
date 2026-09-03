---
id: 0001
title: Specification gap analysis and v3.2
stage: general
date: 2026-08-13
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (direct request — analyse spec + build guide, identify gaps)
labels: ["spec-review", "gap-analysis", "scoring-model", "audit-catalogue", "cost-model", "identity-resolution"]
links:
  spec: lead-intelligence-enrichment-system-final-specification-v3.2.md
  ticket: null
  adr: null
  pr: null
files:
 - lead-intelligence-enrichment-system-final-specification-v3.2.md (created)
 - scoring-model-v0.1.md (created)
 - audit-test-catalogue-v0.1.md (created)
 - development-build-guide.md (revised in place)
 - .specify/memory/constitution.md (filled from template)
tests:
 - Citation integrity — every `Spec §x.y` in the build guide and scoring model resolves to a real v3.2 section (PASS)
 - Signal closure — 57 scoring-model signal IDs, 57 catalogue rows, no duplicates, no orphans (PASS)
 - Cost class distribution — 32 A + 21 B + 3 R + 1 C = 57 (PASS)
 - Gate computability — 29 class-A Problem signals feed `problem_free`; no B/C/R signal does (PASS)
 - Budget arithmetic — §8.2.3 ceiling column sums to exactly $800 (FAIL then FIXED: originally summed to $820)
---

## Prompt

@lead-intelligence-enrichment-system-final-specification-v3.1.md  @development-build-guide.md  ye dono files mai poora system kia banega or kese banega sab define hai ab jo missing ho na woh mujhe batana mai usko clear kerdoonga, abhi in dono files ko analyse karo or batao kesa system hai sahi cheezen dali hain ya nhi

*(Follow-up decisions supplied via structured questions: weekly qualified-lead target = 50–100/week; monthly provider budget = $300–800/month; draft scoring model v0.1 now rather than after Phase 0; produce the missing sections as spec addenda → v3.2.)*

## Response snapshot

**Verdict on v3.1:** structurally sound, definitionally incomplete. The hardest-to-retrofit
decisions were all correct — identity keys table with a unique constraint, field-level
provenance from commit one, exclusion before paid enrichment, deterministic scoring, Next.js
enqueues / Trigger.dev runs. The documents said *what* to produce and rarely *how a number is
computed* or *what the threshold is*, which is survivable in Phases 1–2 and fatal in Phases 3–5.

**Blockers found:** no scoring model (no signals, weights, or High/Low thresholds — so §10.2's
tier table and the default Tier 1–2 view were undefined); no routing rules; no audit test list
or thresholds; no revenue estimation method despite revenue being the ICP filter; no Phase 0
protocol though Phase 5 was gated on it; no provider selection or unit economics; "qualified
lead" defined as an activity metric while being the number that sizes the whole system.

**Design holes:** late merge undefined and would violate `unique(key_type, key_value)` at
insert; discovery vs post-enrichment filters conflated with real cost consequences; no
idempotency, so retries re-purchase provider data; refresh/retention job present in the spec
table but in no phase or folder; RLS vs application-layer authorization undecided; the record
detail view — the entire product promise — unspecified.

**Document errors:** the build guide cited `§4.5` (did not exist) and `§15.2` three times for
retention (that section is Success metrics), and asserted "Spec §15.2 permits indefinite storage
of `place_id`" — a provider-terms fact the specification never stated. Pattern consistent with
v3.0 numbering never re-checked. Also `social_only_ig` routed to two services from a six-item
list containing neither, and the constitution was an unfilled template.

**Risks the documents underestimated:** no proxy or crawl policy though first-party crawling is
load-bearing; Meta Ad Library commercial-ad API coverage assumed; Instagram account IDs treated
as obtainable identity keys; Phase 7 (Travel) treated as configuration when the discovery layer
does not transfer.

**Derived constraint that shaped the work:** 75 qualified/week ≈ 325/month → ~1,100 enriched →
~3,700 discovered. Against $300–800/month, tiered enrichment stops being optional, and the
Problem score must be computable from free signals alone so it can gate paid enrichment rather
than depend on it. That produced Stage 2.5 and the class A/B/C/R cost-class system.

## Outcome

- ✅ Impact: v3.1's definitional gaps closed. Scoring model, audit catalogue with thresholds,
  revenue method, late-merge rules, cost model with per-unit ceilings, interface contracts, and
  the record detail view now exist. Phases 1–2 are unblocked; only §18 items 8, 9, and 15 remain
  open, and none of them blocks Phase 1.
- 🧪 Tests: five verification passes run (see front matter). Four passed; budget arithmetic
  failed on first check and was corrected — the ceiling column summed to $820 against an $800
  envelope, fixed by reducing the enrichment credit line to $280 / $0.25 per record.
- 📁 Files: 3 created, 1 revised in place, 1 filled from template.
- 🔁 Next prompts: run the §18 item 8/9 coverage-and-pricing test; verify Meta Ad Library
  commercial-ad coverage and PageSpeed Insights quota; begin Phase 1 (Drizzle schema,
  normalisation, identity keys, late merge) per Build Guide §8.
- 🧠 Reflection: the most valuable finding was not any single gap but that the budget answer and
  the scoring model were coupled — a gate cannot be built from signals that cost money. Asking
  the volume and budget questions before drafting the model is what surfaced it; drafting first
  would have produced a model that could not gate spend.

## Evaluation notes (flywheel)

- Failure modes observed: an arithmetic error in a hand-built cost table survived drafting and
  was caught only by an explicit summation check. Any table asserting a total needs its
  arithmetic verified rather than read.
- Graders run and results: citation integrity PASS; signal closure PASS; cost-class
  distribution PASS; gate computability PASS; budget arithmetic FAIL → FIXED.
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): replace the two 30% assumptions in §8.2.1 (gate pass
  rate, qualified rate) with measured rates after the first month of runs — they are the cost
  model's softest inputs and both become observable immediately.
