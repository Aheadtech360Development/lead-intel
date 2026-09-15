---
id: 0025
title: ICPs replace categories, and the three-step list
stage: general
date: 2026-09-15
surface: agent
model: claude-opus-5
feature: none
branch: main
user: Aheadtech360Development
command: (video walkthrough "info of system.mp4", then "haan tarteeb mai kerke phir kaam start kerte hain" … "ab age")
labels: ["icp", "migration", "sourcing", "filtering", "leads-list", "tabs", "panels", "stages", "ux"]
links:
  spec: null
  ticket: null
  adr: null
  pr: null
files:
 - supabase: migrations 0020_icps_replace_categories, 0021_checklists_scope_by_industry (packages/db/drizzle/0020_icps.sql, 0021_checklists_scope_by_industry.sql)
 - packages/db/src/schema.ts (icps table; businesses.icp_name/icp_id/icp_matched_at; page_checklists.industry)
 - packages/core/src/icp/{match,suggest}.ts (+tests; renamed from category/) — conditions: requiresWebsite, minReviews, places; searchTerms
 - packages/core/src/pages/checklist.ts (+tests) — scoped by industry
 - apps/jobs/src/match-icps.ts, apps/jobs/trigger/match-icps.ts (task id match-icps-run), analyse-run.ts, discovery.ts, critique-pages.ts
 - apps/jobs/run-match-icps.mjs, apps/jobs/try-icp-conditions.mjs (new, free, local)
 - apps/web/app/icps/* (renamed from categories; list + panel form, sourcing words, conditions, budget/revenue switched off)
 - apps/web/app/search/page.tsx, search/confirm/{page,actions}.ts, search/runs/[id]/page.tsx (search an ICP: one run per word, spend limit split)
 - apps/web/app/records/page.tsx, lib/lead-filters.ts, records/enrich/page.tsx (three steps, menus + chips, reviews/where filters, step 3 panel)
 - apps/web/app/records/[id]/page.tsx, [id]/audit-actions.ts (four tabs)
 - apps/web/app/checklists/page.tsx (form in a panel)
 - apps/web/app/ui.tsx (ICPs nav, StageStrip), globals.css (menus, chips, steps, sticky action bar)
 - wording across dashboard, instagram, spend, rules, import, imports/[id]
 - .gitignore (*.mp4, *.mov, *.mkv)
tests:
 - core 540 (5 new condition tests), providers 106, db 8 — all passing
 - monorepo typecheck clean; every touched page parsed with Next's own SWC parser
 - live: ICP matching re-run on 422 businesses — 0 changed ICP (migration faithful)
 - live, read-only: conditions tried on "Screen printing" — 94 → 89 website / 30 reviews / 30 Texas / 13 all three
---

## Prompt

The operator recorded a 6:45 Urdu walkthrough (info of system.mp4), transcribed locally with Whisper large-v3. Decisions they gave afterwards, verbatim where given:

- ICP: "Categories khatam, sirf ICP"
- Budget/revenue: "Isko abhi rehne do or is terhan se banana ke ye disabled ho bhi or dikhe bhi ke ye disable hai or hover karen to iska reason ajaye ke ye q disable hai."
- "video ko .gitignore mai daal do or mujhe start kerne se pehle ye batao ke hamara kitna kaam hua wa hai jo humne video mai baat kari usme se?"
- "haan tarteeb mai kerke phir kaam start kerte hain"
- "haan woh banao" · "dono step by step karo" · "ab age" · "ab age" · "sahi hai ab age"

## Response snapshot

Seven steps, in order:
1. Database and naming: category_rules → icps (industry, search_terms, requires_website, min_reviews, places); businesses carry icp_name/icp_id; checklist scope renamed to industry so three live rules kept matching.
2. ICPs screen: list only, form in a right-hand panel on Add/Edit/Preview; budget and revenue shown, switched off, reason on hover.
3. Matching verified on real data (no business moved); new conditions refuse unknown facts rather than pass them.
4. Find businesses searches an ICP: every word is its own run; the spend limit is split across words; partial starts are reported.
5. Leads list in three steps: filter menus with chips and a live count, Reviews and Where filters, budget/revenue off; one step-3 panel holding every action with its price and who bills it. Fixed two bugs found on the way (filters lost when opening step 3; buy screen ignoring the two new filters).
6. Checklists form in a panel; one business in four URL tabs (Overview, Website pages, Checks & scores, Calls & history).
7. StageStrip (Sourcing → Filtering → Analysis → Enrichment) on the stage pages; remaining operator-facing "category" wording replaced.

## Outcome

- Impact: product now uses the operator's own vocabulary and structure from the video; no paid run was started.
- Pending: worker redeploy (task id changed); operator review of the new screens in the browser (login-gated, not seen by the agent).
