---
id: 0008
title: Domain normalization bug found in testing
stage: green
date: 2026-08-17
surface: agent
model: claude-sonnet-5
feature: none
branch: master
user: umeradnan7106
command: (organic — user tested the manual entry form in their own browser)
labels: ["bug-fix", "identity-resolution", "domain-normalization", "user-found"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - packages/core/src/normalize/domain.ts (fixed — reject any input containing "@")
 - packages/core/src/normalize/domain.test.ts (regression test added)
tests:
 - npm run test --workspace=@lead-intel/core — 70/70 (was 69, +1 regression test)
 - npm run build:packages — rebuilt dist/ with the fix
 - Dev server restarted; a stale orphaned Windows process blocked the port twice in this session
   (Next.js self-reports the PID in this exact situation — killed via that reported PID both times)
 - Verified via MCP: the bad "gmail.com" domain key and its business were cleanly deleted
   (child rows first — field_metadata, identity_keys — then the business row, matching FK order)
---

## Prompt

ye to chal raha hai mene add kia abhi

*(The user tested `/records/new` in their own browser — the first real end-to-end use of the
app by a human, outside of any test I wrote myself. Their next message just confirmed it worked;
this PHR covers the verification pass that followed, which found a real bug their test data
exposed.)*

## Response snapshot

Verified the user's manually-added business ("Testing Companu") against the database rather than
taking "it worked" as the full picture — checked `identity_keys` and `field_metadata` directly.

Found: the user had typed an email address (`testingcompany@gmail.com`) into the **website**
field. `normalizeDomain()` had no guard against this — `new URL("https://name@gmail.com")` parses
`name` as URL userinfo (the legacy `user:pass@host` syntax) and returns `gmail.com` as the
hostname. The function silently accepted this and stored `domain: gmail.com` as a rank-2 identity
key — a business's core identity key set to a string that has nothing to do with that business,
and one that would collide with every other business whose operator makes the same mistake, since
they'd all "own" the same wrong domain.

Fixed by rejecting any input containing `@` before it reaches URL parsing at all — no legitimate
business website input contains `@`, so this is a safe, conservative disqualifier rather than a
narrow patch for this one case. Added a regression test using the user's exact input. Rebuilt
`packages/core`'s `dist/` output (required since Turbopack consumes the compiled package, not
source — see PHR 0007) and restarted the dev server.

Cleaned up the live database: deleted the test business and its (now-corrected-by-deletion) bad
identity key, in FK-safe order (field_metadata, identity_keys, then businesses) — confirmed with
the user first rather than assuming a record literally named "Testing Companu" should be removed
without asking.

Also hit the same stale-dev-server-process issue as PHR 0007 a second time: `TaskStop` on the
tracked background bash task does not reliably kill the underlying `next dev` child process on
this Windows environment. Next.js's own port-conflict message self-reports the exact PID of its
running instance, which was used both times rather than guessing at a process to kill.

## Outcome

- ✅ Impact: closed a real identity-corruption bug before any real (non-test) data existed to be
  affected by it — this is precisely the failure mode the project's own founding principle is
  built to prevent ("verified links are preferred over name-based guesses" / never fabricate an
  identity key), and it was found because a human used the actual form rather than only the
  synthetic inputs I had written tests for.
- 🧪 Tests: 70/70 core tests (1 new), packages rebuilt, dev server confirmed clean on port 3000,
  database confirmed back to 0 businesses after cleanup.
- 📁 Files: 1 source fix, 1 test file extended.
- 🔁 Next prompts: further browser testing (a second Member-role account to see permission
  differences in the UI), or moving to Phase 3 discovery once Google Cloud API keys exist.
- 🧠 Reflection: every domain test I had written used inputs that already looked like URLs or bare
  domains — none tried "a human pasted the wrong kind of string into this field entirely." Real
  usage found this in about thirty seconds; no amount of additional testing against
  URL-shaped inputs would have. Worth generalizing: for any field a human types into, test at
  least one input that's a plausible OTHER field's content (email in a website field, a name in a
  phone field), not just malformed variants of the expected type.

## Evaluation notes (flywheel)

- Failure modes observed: `normalizeDomain()`'s existing test suite was thorough for the space of
  "URL-like" inputs (protocols, www, paths, query strings, subdomains, multi-part TLDs) but had no
  coverage for "input that resembles a different field type entirely." The bug was a category the
  test design never considered, not a gap within a category it did.
- Graders run and results: regression test (PASS), full core suite (70/70 PASS), live-database
  verification of the cleanup (PASS — 0 businesses, confirmed via count).
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): when a form field says "website," add one test input
  that is a plausible thing someone might mistakenly paste there (email, phone number, a social
  handle) — do this for every free-text field in the manual entry form, not just domain, since
  `phone`, `name`, and `city`/`state` all have their own normalizers that haven't had this same
  adversarial-input pass yet.
