---
id: 0022
title: The socials page we never read
stage: green
date: 2026-08-25
surface: agent
model: claude-opus-5
feature: none
branch: master
user: umeradnan7106
command: (bug report from live data)
labels: ["bugfix", "crawler", "false-positive", "live-found", "coverage", "dns", "operator-caught"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/providers/src/crawl/policy.ts (a `social` priority page pattern)
 - packages/providers/src/crawl/crawl-site.ts (social role, socialPageUnread)
 - packages/providers/src/crawl/fetch-page.ts (one retry for dns_temporary only)
 - packages/providers/src/crawl/fetch-page.test.ts (+4 retry tests)
 - packages/core/src/checks/coverage.ts (socialAbsenceBlindSpot)
 - packages/core/src/checks/social.ts, types.ts, run.test.ts (+3 tests)
 - apps/jobs/src/audit.ts
tests:
 - 478 passing (core 384, providers 90, db 8 → +8 this increment); typecheck clean
 - Live: crystaldtf.com re-crawled through the real crawler; all four social checks now pass
---

## Prompt

"Crystal DTF https://crystaldtf.com/ — mere khayal se tum srif first page dekh rahe ho website ka
… usme socials ke page mai facebook link laga hua hai or problems mai likha hua hai ke Social links
connect nhi hain … ager hum customer ko pitch ker rahe honge or usko humne ye bol dia ke apka
social attech nhi hua to woh customer kharab bhi ho sakta hai … or bohot si websites to analyse hi
nhi ki hain jabke woh chal rahi hain"

## Response snapshot

**The operator was right, and the record proved it exactly.** `crystaldtf.com` was a Priority 1
lead carrying four fired social checks worth 95 points, with `pagesRead: [homepage, contact,
about]` and `platforms: []` stored beside them. Fetching the site directly: the homepage carries
no social link at all — 669 KB of Shopify markup and a single YouTube embed — while
`/pages/socials` links to Facebook, Instagram, TikTok and YouTube. The crawler had never asked for
that page, because `PRIORITY_PAGE_PATTERNS` knew only about contact and about pages.

Two fixes, and the second matters more than the first. The crawler now looks for a socials page —
verified against the live site, which returns all four pages in 11 seconds, inside the 30-second
budget. And when such a page is linked but *could not* be read, the four social checks now report
`not_measured` rather than firing. That is the same admission `contactPageUnread` already made for
the contactability family, kept deliberately separate from it: an unread contact page says nothing
about social profiles, and folding the two together would silence four checks every time a contact
page timed out.

**On "many working websites were never analysed", three different things were happening**, and
only one of them was ours: 38 businesses have no website at all, 21 domains do not resolve, and 25
return HTTP 403. The 403s were worth testing rather than assuming — our user agent, our user agent
with full browser headers, and a plain Chrome user agent all return 403. It is TLS fingerprinting,
not the honest user agent §13 requires, so **no change to the crawler would recover those sites**.
The existing wording already tells the operator to open them in a browser.

**And one fix for my own repeated failure.** The full re-crawl returned `dns_temporary` for 124 of
330 — the third time this machine's resolver has done this (112, then 67, then 124), and the third
time I cleared it by hand with re-runs at falling concurrency. In between, the application showed
hundreds of businesses as unreadable. `fetchPage` now retries once, 1.5 seconds later, and only for
`dns_temporary`: a `dns_failure` is a real answer and an HTTP error is the server's considered
reply.

## Outcome

- ✅ Impact: businesses told "no social links" fell from 54 to 32; of the 8 sites where a socials
  page was found, 7 carried links the system had previously reported as absent.
- 🧪 Tests: 478 passing (+8), typecheck clean, live re-crawl of the reported business verified.
- 📁 Files: 3 provider modules, 3 core modules, 1 job module.
- 🔁 Next prompts: the three that remain the operator's.
- 🧠 Reflection: this is the second time a check concluded from pages it had not read, and both
  times the fix had two halves — read more, *and* be able to say "I did not look". Only the second
  half is general.

## Evaluation notes (flywheel)

- Failure modes observed:
  - **A check concluding from an incomplete crawl.** The four social checks were confident about
    the one thing the business had visibly bothered to set up. The operator caught it by opening
    the site — which is the check no test performs.
  - **My own repetition.** Three audit runs, three manual DNS cleanups, and only on the third did I
    fix the crawler instead of the symptom. The pattern was visible after the first.
- Graders: core (PASS, 384), providers (PASS, 90), typecheck (PASS), live crawl of crystaldtf.com
  (PASS — four pages including `social`, all four checks now `passed`), 403 diagnosis across three
  user agents (PASS — identical result, so the honest UA is not the cause).
- Next experiment: every family that can conclude "X is not on this site" should be audited against
  the pages it actually read. Social and contactability now have blind spots; the SEO, ads and
  tracking families make the same shape of claim and have not been checked for it.
