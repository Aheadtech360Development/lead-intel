---
id: 0013
title: Phase 4 FREE checks and the findings table
stage: green
date: 2026-08-18
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (continuation — "jo remaining cheezen hain unko continue karo")
labels: ["feature", "phase-4", "checks", "findings", "spec-5", "spec-6.3", "coverage", "live-found"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/db/src/schema.ts + drizzle/0004_phase4_findings.sql (findings table, 3 enums, CHECK constraint, RLS)
 - packages/core/src/checks/{registry,types,parse,result,signatures,coverage}.ts (new)
 - packages/core/src/checks/{web,contact,seo,social,ads,intent,run}.ts (new — 34 FREE checks)
 - packages/core/src/checks/run.test.ts (new — 59 tests)
 - packages/providers/src/crawl/{crawl-site,robots,fetch-page,types,policy}.ts (multi-page, probes, X-Robots-Tag)
 - packages/providers/src/crawl/probe.ts (new — sitemap/favicon existence)
 - apps/jobs/src/{audit,findings}.ts (new), trigger/audit-website.ts (thinned to queueing)
 - apps/jobs/{run-audit,smoke-checks}.mjs (new — local runners over the same code path)
 - apps/web/app/records/[id]/page.tsx (findings, intent credits, and what could not be measured)
tests:
 - 250 across three packages (core 176, providers 66, db 8) — all passing
 - npm run typecheck — clean across all 6 workspaces
 - Adversarial SQL against the live findings CHECK constraint: 4 assertions, transaction rolled back
 - Live smoke test on 8 real sites before any batch, then 10 businesses, then all 209
 - Final state: 209/209 analysed, 7,942 findings — 1,607 fired, 3,131 passed, 3,066 not measured,
   138 not applicable. Every area sits at 54-65% measured, above §6.1's 40% coverage floor.
---

## Prompt

"jo remaining cheezen hain unko continue karo" — continue the remaining work, following the
approved next increment from PHR 0012: the HTML-derived FREE checks and the `findings` table.

## Response snapshot

**34 checks** now run against every business, transcribed from §5.1–§5.6 and §6.3: the
contactability family (K1–K8), the FREE half of local search (S9–S14), social links (O1, O2, O4,
O6), tracking and advertising (D1–D4, D6), reviews-on-site (R6), the site-quality checks
(W4, W5, W8–W12), the presence restatements (W1–W3) and the four FREE Intent credits (N1, N6, N9,
N10). The full catalogue — including every PAID and BEST EFFORT check nothing runs yet — lives in
one registry file, so check IDs and point values have exactly one source and the whole model is
readable on one page next to the spec it came from.

**§6.1's accounting rule is enforced in two places rather than promised in none.** A check that
could not run "is left out of both sides — it never counts as a pass and never counts against the
business." Four constructors (`fired`/`passed`/`notMeasured`/`notApplicable`) derive points and
maxPoints from the outcome and the registry, so a check cannot award itself the wrong number; and
`findings` carries the same rule as a CHECK constraint, so a row that broke it would be rejected
rather than silently scored. The constraint was tested adversarially against the live database
before anything was written through it.

The crawler now reads **the contact page**, not just the homepage, and probes for a sitemap and a
favicon. That is not extra coverage for its own sake: six of the eight contactability checks ask
"is X anywhere on the site", and on a real small-business site the phone, the address, the hours
and the form live on /contact.

**Two live-found bugs, both the same mistake in different clothes.**

The first was cheerio's `.text()`, which concatenates nodes with no separator — so
`<h2>What our customers say</h2><p>Great work!</p>` came back as `...sayGreat work!`, two words
fused into one that matches nothing. It silently broke every check that reads a page as prose.

The second was found by running against ten real businesses. `texasoptical.net` serves 114 bytes
whose entire content is `window.location.href="/lander"`. Judged as a page, it had no title, no
meta description, no viewport tag, no tracking and one page total — **ten findings, every one of
them about a redirect stub rather than about the business.** The same shape appears on any
single-page app with no server rendering: an empty shell has no form, no phone number and no
social links, not because the business lacks them but because none of it exists until a browser
runs the JavaScript. Left alone, the most modern site on a list would come out looking like the
most neglected one.

The fix is `coverage.ts`: every check derived from page content is gated on having actually
received a page. The ones that read the connection (W4), a probe (S12), robots.txt (S13) or the
§4 verdict (W1–W3) still answer, because they never depended on the markup. `texasoptical.net`
now produces **0 problems and 34 unmeasured** where it produced 10 fabricated ones.

**Then the fix over-fired, and reading the full run found that too.** The first gate was a
300-character floor on readable text. `fibercircleyarn.com` publishes its name, address, phone
and opening hours in **277 characters** on a Weebly page — a real business, silenced. Length
alone cannot separate 197 characters of navigation from 277 characters of content. What can is
**the ratio of markup to content**: `needlepointthis.com` serves 95 KB of HTML containing zero
readable characters, `thistlecreativereuse.com` 62 KB of the same, while `fibercircleyarn.com` is
16 KB carrying 277 characters of actual address and hours. The gate is now a low absolute floor
(150 characters) plus that ratio, and the test asserting it uses both of those real pages by name.

Writing that test then exposed **two more findings that would have been wrong at scale**, neither
of which any earlier test had touched:

- **K1, at 30 points.** Phone candidates were found with one greedy regex, so
  `... TX 75442 972-782-6630 ...` matched `75442 972-782-6630` — fifteen digits, not a valid
  number — and having consumed the text never tried the real number inside it. An address sits
  next to a phone number on virtually every local business site. Candidates are now built from
  windows of consecutive tokens, so the one-token candidate is still tested when the longer one
  fails.
- **K5, at 15 points.** Opening hours required a colon or an am/pm, so `Thurs 10-5  Fri 10-5
  Sat 10-4  Sun closed` — how a small shop actually writes them — read as no hours at all.

S13 got the same treatment for a different reason: at 40 points it is the heaviest FREE check in
the SEO area, and "search engines blocked" is about *search engines*, not about us. A robots.txt
that turns away `AheadTech360LeadBot` while welcoming Googlebot describes our crawler, so the
robots evidence is evaluated against Googlebot and the check has its own live test proving the
two cases are distinguished.

## Outcome

- ✅ Impact: all 209 businesses carry real, explained findings instead of one presence state —
  1,607 fired, 3,131 clean, 3,066 honestly unmeasured — and the business page shows what is
  wrong, what suggests they spend money, and, separately and by name, what could not be measured.
  Every one of the six areas sits at 54–65% measured, comfortably above §6.1's 40% coverage floor,
  so the scoring increment has something real to divide by.
- 🧪 Tests: 250 passing (176 core, 66 providers, 8 db), typecheck clean across 6 workspaces, plus
  an adversarial test of the database constraint and live runs at three sizes.
- 📁 Files: 14 new modules, 1 migration, 2 local runners, 1 page rewritten.
- 🔁 Next prompts: PageSpeed for W5/W6/W7, then §6 scoring — area scores, the 40% coverage floor,
  Problem and Intent, tiers and the Stage 5 gate. The findings table already stores exactly what
  that arithmetic needs.
- 🧠 Reflection: the coverage rule is the same lesson as PHR 0012's 403 bug, one level up. That
  one was "a refusal is not evidence about the business"; this one is "markup that is not a
  website is not evidence about the business either". Both were invisible to unit tests because
  the tests supplied real pages — the failure only exists where the code meets what servers
  actually send.

## Evaluation notes (flywheel)

- Failure modes observed: (1) trusting a library's convenience method (`.text()`) without reading
  what it does at element boundaries; (2) writing checks that assume the fetched bytes are the
  business's website. The second is the more expensive class — it produces confident, specific,
  entirely fabricated findings, which is exactly the output an operator would act on.
- Graders run and results: full suite (PASS), typecheck (PASS), adversarial constraint test
  (PASS — 4/4 rejections), 8-domain smoke test (FOUND the cheerio bug and the CTA gap),
  10-business run (FOUND the redirect-stub bug), full 209-business run (FOUND the over-strict
  coverage floor, and through it the K1 and K5 extraction bugs), full re-run after the fixes
  (PASS — 209/209, 0 failures).
- Prompt variant (if applicable): n/a
- Operational note: the first full re-run lost 18 records to `ECONNRESET` and DNS failures against
  the Supabase pooler when the machine went offline overnight — no code failure, but it exposed
  that the local runner has no retry where the Trigger.dev task does. `--stale <minutes>` was
  added so a partly-failed pass can be finished without re-crawling everything.
- Next experiment (smallest change to try): 7 businesses hold a platform or chain domain
  (booksy.com, costco.com, facebook.com, vagaro.com, walmart.com…) rather than their own. The
  checks then describe Costco's website and file it under "Costco Optical Department, Arlington".
  The unique constraint on identity_keys means only one business can ever hold such a domain, so
  this is also silently distorting deduplication — worth a shared-domain deny list in
  packages/core/src/normalize/domain.ts before the next discovery run.
