---
id: 0003
title: Sales enablement skill review
stage: explainer
date: 2026-08-13
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (direct request — review the added sales skill)
labels: ["sales-enablement", "skill-review", "phase-0", "outcome-taxonomy", "gap-analysis"]
links:
  spec: lead-intelligence-enrichment-system-final-specification-v3.2.md
  ticket: null
  adr: null
  pr: null
files:
 - (read only — no files modified)
 - .agents/skills/sales-enablement/SKILL.md
 - .agents/skills/sales-enablement/references/deck-frameworks.md
 - .agents/skills/sales-enablement/references/demo-scripts.md
 - .agents/skills/sales-enablement/references/objection-library.md
 - .agents/skills/sales-enablement/references/one-pager-templates.md
 - .agents/skills/sales-enablement/evals/evals.json
tests:
 - Checked every path the skill references for existence (product-marketing.md, tools/REGISTRY.md, introw.md) — all MISSING
 - Checked all six sibling skills named under "Related Skills" — all MISSING, including cold-email and revops
---

## Prompt

acha mene aik skill add ki hai sales ke lye to usme dekho kia best practices hain or kia bataya gaya hai ke kese sales nikali jati hain to isko sahi se dekh ker batao

## Response snapshot

**Scope correction first:** `sales-enablement` is a **collateral** skill — it produces decks,
one-pagers, objection docs, demo scripts, ROI calculators, proposals, playbooks, and persona
cards. It is not a lead-generation or prospecting skill. It covers the half of the funnel that
starts *after* a prospect replies. The Lead Intel project covers the half before that. The skill
itself defers cold outreach to a `cold-email` skill and lead lifecycle/scoring to `revops` —
**neither is installed**, and all six sibling skills it names are absent.

**Four core principles:** sales uses what sales trusts (if reps rewrite your deck, you wrote the
wrong deck); situation-specific not generic; scannable in 3 seconds not 30; every claim tied to
revenue, efficiency, or risk.

**The method it teaches:** discovery before demo, never the reverse. Its 30-minute discovery
script is SPIN in structure — Situation (7 min), Pain (10 min), Impact & Priority (5 min),
Buying process (3 min). Deck arc is Situation → Complication → Resolution. Objection framework
is acknowledge → reframe → proof → follow-up question, with "compared to what?" as the correct
first response to price.

**Four connections to the project that matter:**

1. Almost every talk track in the skill contains placeholders for evidence AT360 does not yet
   have — case studies, customer quotes, ROI figures, competitor switch stories. Phase 0 is
   precisely the exercise that generates them.
2. The record detail screen is effectively a **pre-filled discovery call**. Technographics answer
   "what tools do you use", findings answer "what's the biggest challenge", measured values
   answer "how much". This means Scene 2's open questions must be reframed as *confirmation*
   questions — asking a prospect what platform they use after opening with "I noticed you're on
   Shopify" undoes the research.
3. **Concrete spec gap found:** the outcome taxonomy (Spec §15.1) and the Phase 0 OUTREACH sheet
   log the outcome and the opener's finding domain, but not **which objection was raised**. The
   skill's six categories would make calibration able to distinguish "reputation findings get
   replies but always hit a status-quo objection" from a plain reply rate.
4. The skill is B2B SaaS shaped. Pricing tiers, SOC 2 sections, payback-period framing, and
   named-product competitor positioning transfer poorly to an agency selling services, whose
   real competitor is usually an in-house team or an existing freelancer.

**Most directly usable asset:** the Champion Enablement One-Pager, because at $500K–$10M DTC the
person reached by IG DM is often a marketing manager rather than the owner.

**Highest-leverage fix:** create `.agents/product-marketing.md`. It is the first thing the skill
looks for, it does not exist, and without it every invocation restarts from the same four context
questions.

## Outcome

- ✅ Impact: scope of the skill clarified, one concrete specification gap identified (objection
  category missing from the outcome taxonomy and the Phase 0 sheet), and the highest-leverage
  setup step named.
- 🧪 Tests: two existence checks run against paths and sibling skills the skill references — all
  missing, which changes how the skill behaves on first use.
- 📁 Files: none modified — analysis only.
- 🔁 Next prompts: create `.agents/product-marketing.md`; add the objection column to Spec §15.1
  and the Phase 0 OUTREACH sheet; consider installing `cold-email`, which sits exactly where the
  Lead Intel pipeline hands off.
- 🧠 Reflection: the useful finding was not in the skill's content but in the seam between it and
  the project — the pipeline's final output is cold outreach openers, and cold outreach is the one
  thing this skill explicitly excludes. That gap sits precisely at the handoff.

## Evaluation notes (flywheel)

- Failure modes observed: the request could easily have been answered as a summary of the skill's
  contents. The value was in checking what it references but does not have, and in mapping it onto
  the project's existing artefacts.
- Graders run and results: referenced-path existence check PASS (all missing, correctly reported);
  sibling-skill check PASS.
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): after Phase 0, replace the skill's generic 15-objection
  table with the objections actually heard from US DTC apparel brands — that single substitution
  is what turns it from a template into AT360's playbook.
