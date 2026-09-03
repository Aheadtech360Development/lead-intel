---
id: 0021
title: Splitting the dashboard from the worklist
stage: refactor
date: 2026-08-25
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (UI redesign request)
labels: ["ui", "information-architecture", "dashboard", "filters", "live-found", "cost-control"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - apps/web/app/dashboard/page.tsx (new — overview, pipeline, breakdowns, spend)
 - apps/web/app/records/page.tsx (rewritten — sidebar filters, one filtering model, 7 columns)
 - apps/web/app/ui.tsx (FilterSection, FilterOption, ScoreBars, Funnel, NextAction; Dashboard in nav)
 - apps/web/app/globals.css (.work-layout / .work-filters — the media query inline styles cannot express)
 - apps/web/app/page.tsx (root now lands on the dashboard)
 - apps/web/app/records/enrich/page.tsx (reads f_from; stops applying the gate to non-gate views)
 - apps/jobs/trigger/analyse-run.ts (new), apps/jobs/trigger/discovery.ts, apps/web/app/records/analyse-actions.ts
tests:
 - 475 passing (core 381, providers 86, db 8); typecheck clean across 6 workspaces; web build exit 0
 - Live: 121 imported businesses crawled across four passes; 94 → ok, DNS retries at concurrency 3/2/1
---

## Prompt

"acha ye file wale ko analyse q nhi kia matlab saari cheezen iski bhi honi chahye na" — then:
"is system ki UI sahi karo koi acha sa dashboard banao jo samajh mai aye abhi to itni confusion
horahi hai kuch bhi samajh nhi araha hai poora proper way mai design karo, abhi to srif filters
lagaye hue hain usme itni confusion horahi hai iska proper dashboard banao"

## Response snapshot

**Two problems, and the second explained the first.**

The imported businesses had never been analysed because *nothing in the application could start an
analysis*. The importer's own confirmation said "run the website analysis to score them" — a thing
only possible from a terminal. Discovery had the same hole; every crawl so far had been started by
hand. So 121 rows sat reading "Not scored / Couldn't check", which is indistinguishable from 121
businesses whose websites are broken. A new `analyse-run` task chains crawl → PageSpeed → score
with waits between them (the existing run tasks fan out and return, which would have scored
businesses against an empty findings table), import and discovery both start it, and the leads page
carries a button for when the worker was not reachable.

**Then the UI.** The diagnosis was not "too many filters" — it was *three different filtering
affordances that did not look like each other*. Chips in a bar, bar charts that were secretly
links, and stat cards that were not clickable at all, stacked above the rows an operator was
supposed to work through. A page that read as a report behaved as a control panel.

So the two jobs were separated. `/dashboard` answers "how is this going": what to do next, the
pipeline as a funnel where each number is visibly a subset of the one before it, what the analysis
found, where the data came from, and what it has cost — read from the ledger, per provider.
`/records` answers "who do I call": one sidebar where every filter has the same shape, a count, and
a plain sentence under its heading, beside a list narrowed from nine columns to seven.

Every count in that sidebar is measured *against the filters already on*, not globally — a facet
count that ignores the current selection sends the operator to an empty list, which is the specific
way this kind of UI usually lies.

**Three honesty fixes fell out of it.** "Couldn't check" was a claim about a business's website
being made about businesses nobody had visited; those now say "not looked at yet". The
"Couldn't be scored" stat was counting both, and is now split. And the confirm screen for buying
paid data never read the `from` filter — the button says "Get paid data for all 121 shown" and the
query behind it returned all 330.

## Outcome

- ✅ Impact: the analysis can be started from the application at all; the summary and the worklist
  each do one job; a money screen stopped disagreeing with the list that sends people to it.
- 🧪 Tests: 475 passing, typecheck clean, production build exit 0, every route reachable.
- 📁 Files: 1 new page, 1 new task, 1 rewritten page, 5 edited.
- 🔁 Next prompts: the three that are still the operator's — YouTube API, Lusha coverage, and
  twenty real calls.
- 🧠 Reflection: "the UI is confusing" was reported as a styling problem and was an information
  architecture problem. Adding explanations to the chips — which is what the previous round did —
  could not have fixed it, because the confusion was that three different things looked like three
  different things while doing the same job.

## Evaluation notes (flywheel)

- Failure modes observed:
  - **A pipeline with no way to start it.** Every stage after import existed and worked; the button
    did not. The gap was invisible in tests because the tests exercise the tasks directly.
  - **A confirm screen filtered on four of five facets.** `f_from` was added to the list and not to
    the screen that prices a purchase from it. Same class as the export route's stale `gated`
    parameter found in PHR 0020 — a filter added on one side of a boundary and not the other, twice
    in two increments. Worth a checklist item: a new list filter is not done until export and
    enrich both read it.
  - **This machine's DNS again.** 67 of 121 imported crawls returned `dns_temporary` at concurrency
    3. Passes at 3, 2 and 1 brought it to 94 `ok`. Nothing was ever called dead.
- Graders: full suite (PASS), typecheck (PASS), build (PASS), route reachability (PASS — 7 routes,
  all linked), live crawl of the imported set (PASS — 121 audited, 0 failed).
- Next experiment: the render itself is unverified beyond compilation — the dev server redirects an
  unauthenticated request before a page renders, so nothing here proves the new dashboard draws
  correctly with real data. A seeded session for smoke-testing pages would close that gap.
