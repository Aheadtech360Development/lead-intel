---
id: 0019
title: Dry run of a real import file
stage: green
date: 2026-08-25
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (question — "will this import correctly?")
labels: ["csv-import", "identity", "dedup", "live-found", "verification", "scoring-coverage"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/core/src/normalize/shared-domain.ts (bigfrog.com, instantimprints.com added to CHAIN_DOMAINS)
 - packages/core/src/identity/build.ts (a bare shared domain no longer becomes a rank-2 key)
 - packages/core/src/identity/build.test.ts (+5 regression tests, both rows verbatim from the file)
 - apps/web/app/records/import/actions.ts (sharedWebsites surfaced in the preview)
 - apps/web/app/records/import/page.tsx (panel explaining why those rows are not analysed)
tests:
 - 475 passing (core 381, providers 86, db 8); typecheck clean; web build exit 0
 - Live: the operator's own 129-row file parsed, keyed, and checked against the 209 records
---

## Prompt

"acha ye teeno kaam kerta hoon lekin pehle ye dekho ke mai kuch is terhan ki files import kerke
analytics kerwaonga to ye sahi se kerdega na" — attached: `20260821_leads_instantly.csv`, 129
screen-printing and DTF companies across 18 states, exported from Instantly.

## Response snapshot

The question deserved a run, not an opinion. The file was already on disk, so it went through the
real parser, the real `buildIdentityKeys`, and a read-only query against the live 209 records.

**The parse was clean** — 129 of 129 accepted, `company_name` matched, `"KT Sublimation, DTF & More
LLC"` survived its embedded comma, six rows correctly recognised as businesses already held.

**The identity keys were not.** Two Big Frog franchises — Buckhead in Atlanta and Green Hills in
Nashville — arrived as `bigfrog.com/buckhead` and `bigfrog.com/greenhills`. `normalizeDomain`
strips paths, because a website is identified by its host, so both held the identical rank-2 key
and the second would have been merged into the first: two shops 350 miles apart collapsed into one
record with nothing in the UI to show it had happened.

The fix is one line and a rule that was already implicit in the codebase. `sharedPlatformDomain`
exists to say "this domain does not belong to this business"; a domain that does not belong to the
business is not rank-2 evidence *about* the business. So a **bare** shared domain no longer becomes
a key. The test is equality, not a match — `rjgraphicsanddesign.myshopify.com` names exactly one
shop and keeps its key, while `bigfrog.com` and `booksy.com` name all of them at once and do not.
Those records still dedupe on phone and name+town, which is the evidence that genuinely
distinguishes them.

**The larger finding is not a bug and cannot be fixed for free.** Every SEO and REP check reads the
Google listing, and Places Details needs a `place_id` a CSV cannot carry. Both areas therefore fall
below the coverage floor and score `null` — 36% of the Problem weight. The system handles this
honestly on its own: `score.ts` renormalises over the areas that cleared the floor, so imported
businesses are scored on WEB/CON/SOC/ADS rather than penalised, and the enrich screen already
refuses `places_details` for them at $0 with "no Google listing to look up". What the operator
loses is real all the same — two of six pitches can never be recommended for an imported record.

## Outcome

- ✅ Impact: a silent two-into-one merge caught before the operator's first real import; the import
  preview now names the rows whose website will not be analysed and says why.
- 🧪 Tests: 475 passing (was 470), typecheck clean across 6 workspaces, web build exit 0.
- 📁 Files: 2 core modules, 1 test file, 2 web files.
- 🔁 Next prompts: whether to build a Places Text Search lookup ($0.035/business, $4.52 for this
  file) to give imported records a `place_id` and unlock SEO/REP.
- 🧠 Reflection: the operator asked "will this work?" about a file they had not uploaded yet. Every
  previous production bug in this project was found by running against real data, and this one was
  found the same way — before it reached the database rather than after.

## Evaluation notes (flywheel)

- Failure mode observed: **a strong identity key built from a domain that identifies a chain.** The
  `sharedPlatformDomain` module has flagged these since the `local.targetoptical.com` incident, but
  flagging happens at scoring time and merging happens at write time, so the flag could not prevent
  the merge. The two mechanisms had never been connected because until this file no dataset
  contained two locations of one chain.
- Also measured, and left alone: two phone collisions inside the file. DTFXPRESS and Denver DTF
  Supply share a phone *and* the email `dtfxpress@gmail.com`; Custom Print AZ and DTF Transfer
  Arizona share a Phoenix number. Merging those is correct, and reporting them without changing
  them was the right call — they are the mechanism working, not failing.
- Graders: full suite (PASS), typecheck (PASS), web build (PASS), 129-row parse (PASS, 0 rejected),
  collision re-check after the fix (PASS — chain collision gone, phone collisions retained),
  live overlap query (6 merge, 123 new, all six on domain).
- Next experiment: the composition warning. This list is 11 toll-free national wholesalers among
  129 rows, in 18 states — not what [[system-is-local-business-not-dtc]] describes. Nothing in the
  UI says so, and a Problem score computed from four areas looks identical to one computed from six.
