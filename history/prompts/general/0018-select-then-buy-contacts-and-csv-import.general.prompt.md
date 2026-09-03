---
id: 0018
title: Select-then-buy, contacts already in hand, and CSV import
stage: green
date: 2026-08-21
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (plan mode → approved → implementation)
labels: ["feature", "cost-control", "enrichment", "csv-import", "contacts", "youtube", "live-found", "research"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/shared/src/enrichment.ts (new — every paid source, its rate, its key)
 - packages/core/src/enrichment/estimate.ts + test (new — pricing before spending)
 - packages/core/src/checks/contacts.ts + test (new — email, web phone, owner name)
 - packages/core/src/import/parse-csv.ts + test (new — CSV grammar and validation)
 - packages/providers/src/youtube/find-channel.ts + test (new — O8)
 - apps/jobs/src/enrich.ts (new), trigger/enrich-run.ts (new), src/listing.ts, src/audit.ts
 - apps/web/app/records/enrich/{page,actions}.ts (new — the confirm screen)
 - apps/web/app/records/import/{page,actions}.ts (new), records/page.tsx (checkboxes)
 - packages/db/drizzle/0007_import_batches.sql
 - data-sources-and-costs.md (new — the operator's own cost document, in Roman Urdu)
tests:
 - 470 across three packages (core 376, providers 86, db 8) — all passing
 - npm run typecheck clean across 6 workspaces; Next.js production build exit 0
 - Live: CSV path tested against real records (4 merged, 4 created, 2 rejected with reasons)
---

## Prompt

Four things, in Roman Urdu: get the *owner's personal* number rather than the business line; scrape
LinkedIn and Instagram including who a business follows; explain the five pipeline stages; and
write one file saying what is free, what is paid, and what it all costs. Then, after seeing the
plan: **"jo cheez hume paid wali cheez nikalni ho to hum unko select karen or phir nikalen …
sabka na nikalen"** — let me choose which businesses to buy data for, rather than buying it for
everyone.

## Response snapshot

**The last request reframed the whole increment, and it was right.** Places listing details were
being bought automatically for every business past the Stage 5 gate — 77 businesses, $3.08, cheap
enough that the shape of it went unnoticed. The next source is not cheap: an owner's mobile is
$0.73, which is $60 for those same 77 and **$2,044** for the 2,800 in §10.2's worked example.
Buying that for businesses nobody intends to ring is money set on fire.

So paid data is now **select, price, confirm**. Tick businesses on the leads list, see a screen
that counts what would be bought and what it costs, then spend. Three things make the number
trustworthy: already-bought businesses are free and *say so* (the ledger check runs before every
call), an unconnected source shows its **real** price rather than $0.00 while being unbuyable, and
the spend cap is shared across sources so two ticked boxes cannot each spend the whole limit.

§9's gate stops being an instruction and becomes what it always should have been: advice about who
looks worth calling.

**On the research, three answers the operator needed and one they did not expect.**

*The follower graph cannot be obtained.* Instagram's official API returns `followers_count` and
only for accounts you own; there is no endpoint for anyone else's followers at any price.
LinkedIn's largest data reseller, Proxycurl, was sued by LinkedIn/Microsoft and shut down on
4 July 2025. Both are now written down with their evidence rather than left as an open request.

*The owner's mobile is buyable but doubly awkward.* Lusha $0.73, RocketReach $0.64, Apollo too
slow at this scale — all priced in the document. But US TCPA treats **every** mobile as
residential; the B2B exemption covers business landlines only, at $500–$1,500 per violation, with
class-action filings up 23% this year. And Apollo and Lusha index corporate professionals, so
coverage for a braiding salon in Mesquite is an open question. The adapter is deliberately **not
built**: the UI shows the option and the price, and the next step is Lusha's 40 free credits
against eight real businesses to measure the hit rate before anything is bought.

*And the thing nobody was looking for:* the crawler has been extracting emails from these sites
since Phase 4, storing them inside a check's `detail`, and showing them nowhere. They are now
first-class contact fields, alongside a phone taken from `tel:` links and an owner's name — the
last only where the page states it outright, never inferred.

**CSV import** reuses the existing identity keys rather than inventing a second notion of "the same
business", and revealed a real limitation while being tested: a CSV has no coordinates, so its
name+location key is `place:us:tx:dallas` where a Maps result's is `geo:32.99:-96.84`. Those can
never match. Strong keys (domain, phone) merge correctly; name-and-town matches are surfaced as
**possible duplicates for a human**, which is exactly what §7 says to do with rank-5 evidence.

## Outcome

- ✅ Impact: paid data is now a priced, per-business decision; 50 contact emails and 30 phones that
  were already in the database are visible for the first time; lists can be imported from outside
  Google Maps; and there is one document saying what everything costs.
- 🧪 Tests: 470 passing (376 core, 86 providers, 8 db), typecheck clean, production build exit 0.
- 📁 Files: 5 new core/shared modules, 1 provider, 2 job modules, 3 web routes, 1 migration, 1 doc.
- 🔁 Next prompts: enable YouTube Data API v3 (2 minutes, free) to switch on O8; Lusha's free tier
  to measure mobile coverage before buying; and still, above all, twenty real calls.
- 🧠 Reflection: the operator's instinct about paid data was better than the plan I brought them.
  I had priced the sources correctly and still designed the buying as a batch job, because that is
  how the existing one worked.

## Evaluation notes (flywheel)

- Failure modes observed, all found by running against real data:
  - **A customer review read as the owner's name.** `maatiibeautysupply.com` says *"I love the new
    management/owner - Happy Customer Neet"*, and the extractor returned "Happy Customer Neet" —
    the precise failure the module's own doc comment promises not to make. The tell was the
    character before the label: a real label begins a phrase, so it never follows a slash or the
    tail of another word. Both the live sentence and the one genuine name from the same run
    (`founded by Zoey`) are now regression tests.
  - **112 of 209 crawls returned `dns_temporary`** — this machine's resolver buckling under eight
    concurrent crawls, not 112 dead domains. Nothing was called dead; every one reported "a
    temporary failure on our side, which says nothing about the site". That guard, built two
    increments ago for a different reason, is the only thing standing between a flaky home network
    and 112 businesses being told their website is dead. A `--outcome` selector now re-runs exactly
    those at a lower concurrency.
  - **I quoted 73 emails to the operator and the current data holds 50.** The 73 was measured
    before the app-shell and DNS honesty fixes changed which sites are considered readable. The
    figure was true when taken and wrong when repeated — the same error as the "five businesses"
    estimate in PHR 0016, which is now twice.
- Graders: full suite (PASS), typecheck (PASS), production build (PASS), CSV path against real
  records (PASS — 4 merged on domain, 4 created, 2 rejected with row numbers), owner-name
  extraction on live sites (FOUND the review bug), DNS re-run (47 → 100 crawled, and continuing).
- Next experiment (smallest change to try): stop quoting figures measured in an earlier state of
  the data without re-checking them. Both times it has happened, the number was right when taken
  and stale by the time it reached the operator — a habit of re-running the query before repeating
  its answer would have caught both.
