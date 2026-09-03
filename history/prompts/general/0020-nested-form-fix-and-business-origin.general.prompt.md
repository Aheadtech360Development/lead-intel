---
id: 0020
title: Nested form fix and business origin
stage: green
date: 2026-08-25
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (bug report + feature request)
labels: ["bugfix", "hydration", "provenance", "csv-import", "ui", "migration", "live-found"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - apps/web/app/records/page.tsx (formAction instead of nested forms; Where-from filter; origin per row)
 - packages/db/drizzle/0008_business_origin.sql (new — origin + import_batch_id, backfilled from evidence)
 - packages/db/src/schema.ts, packages/shared/src/enums.ts (BUSINESS_ORIGINS + labels)
 - apps/web/app/records/import/actions.ts (stamps origin, redirects to the imported set alone)
 - apps/web/app/records/new/actions.ts, apps/jobs/src/repo.ts (the other two creation points)
 - apps/web/app/records/[id]/page.tsx (Where from, with the filename)
 - apps/web/app/records/export/route.ts (origin column; stale `gated` param fixed)
tests:
 - 475 passing (core 381, providers 86, db 8); typecheck clean; web build exit 0
 - Migration applied live and verified: 207 discovered, 2 manual; security advisors clean
---

## Prompt

"In HTML, `<form>` cannot be a descendant of `<form>` … ye teen error arahe hain isko sahi karo or
jo mai abhi Import a list of businesses kerke analyse karaonga to usko 209 business ke saath nhi
milana usko alag se rakhna ta ke mujhe pata ho ke mene konse files se dye the or konse khud nikal
ker analyse karaye hain to isko bana do"

## Response snapshot

**The nested form was not only a warning.** The leads table *is* a form — that is how row selection
reaches the enrich screen without any client-side JavaScript — and the Claim button had its own
form inside it. Browsers drop the inner form, so pressing Claim submitted the **outer** one and
navigated to the enrich screen instead of claiming anything. `formAction` on the button overrides
its form's action without nesting, which is exactly the shape this needed. A sweep of the other
pages found their multiple forms are siblings, not nests.

**Origin is about creation, not contribution.** `field_metadata.source_name` has always recorded
where each *field* came from, but that cannot be filtered or counted, and it cannot answer "show me
what I imported". A `business_origin` enum on the business row can. The distinction it draws earns
its place: an imported record has no Google `place_id`, so SEO and REP never clear the coverage
floor, and a Problem score of 78 built from four areas looks identical in a column to one built
from six.

The backfill was taken from evidence rather than assumed. `discovered_in_run` is written only by
the discovery job, so its absence marks a record that arrived another way — 207 with a run, 2
without, and those two turned out to be "Aheadtech360" and "AF Apparel" carrying `manual_entry`
field sources, which is precisely what the rule claims about them.

A row that merges into a business found by search stays `discovered`, and the import's confirmation
message says so out loud. The file added fields to that record; it did not create it.

**One thing found on the way.** The export route filtered on a `gated=true` parameter that the list
has never sent — the list says `view=everything` for "show all" and omits it otherwise, the exact
opposite polarity. So every download quietly ignored the filter on screen. Fixed alongside adding
`from`, because a filtered list whose download disagrees with it is the quietest kind of wrong
answer: the file looks fine.

## Outcome

- ✅ Impact: Claim works again; imported businesses are a set the operator can see, filter, export
  and land on directly after an import, with the filename on every row.
- 🧪 Tests: 475 passing, typecheck clean, web build exit 0, migration applied and verified live,
  security advisors show nothing new.
- 📁 Files: 1 migration, 2 package modules, 5 web files, 1 job file.
- 🔁 Next prompts: whether to buy `place_id` lookups so imported records can be scored on all six
  areas ($0.035 each).
- 🧠 Reflection: the bug report was about a console warning and the actual damage was a dead button.
  Worth remembering that "just a hydration warning" describes the symptom, not the cost.

## Evaluation notes (flywheel)

- Failure modes observed:
  - **A form inside a form, silently disabling a button.** React reported it as a hydration warning,
    which reads as cosmetic; the browser's response is to discard the inner form entirely.
  - **An export filter keyed on a parameter nothing sends.** `gated` was this route's own
    invention, so the download had been ignoring the on-screen filter since it was written. Found
    only because adding `from` meant reading the parameter list.
- Graders: full suite (PASS), typecheck (PASS), web build (PASS), migration + backfill verified
  against live data (PASS — 207/2, matching the field-source evidence), form-nesting sweep of all
  web pages (PASS — remaining multi-form pages are siblings), security advisors (no new findings).
- Next experiment: the same question as PHR 0019 — nothing in the UI yet says a Problem score was
  computed from four areas rather than six on a *per-row* basis; it is said once, in a banner, when
  the imported filter is active. A per-row marker on the score itself would be stronger.
