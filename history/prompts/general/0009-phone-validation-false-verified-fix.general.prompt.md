---
id: 0009
title: Phone validation false-verified fix
stage: green
date: 2026-08-17
surface: agent
model: claude-sonnet-5
feature: none
branch: master
user: umeradnan7106
command: (organic — user's second real browser test of the manual entry form)
labels: ["bug-fix", "data-integrity", "phone-normalization", "user-found"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - apps/web/app/records/new/actions.ts (validate domain/phone before any DB write; reject with a clear error instead of storing unparseable values as "verified")
tests:
 - npm run typecheck --workspace=@lead-intel/web — clean
 - Standalone verification script (apps/web/verify-guard-temp.mjs, deleted after use):
   Pakistani-format phone -> null, email-in-domain-field -> null,
   valid US phone -> parses correctly, valid domain -> parses correctly
 - Live browser test by user: submitted the Pakistani-format number again, form correctly
   rejected it with the new error message (confirmed via dev server request log)
---

## Prompt

acha abhi sahu dala hai data ab dekho

*(User's second real end-to-end test of `/records/new` — this time entering a business,
"Aheadtech360", with a Pakistani-format phone number. They asked me to check the result.)*

## Response snapshot

Verified the stored record against the database rather than trusting "sahi dala hai" (entered
correctly) at face value — same discipline as PHR 0008. Found `normalizePhone()` correctly
returned `null` for the Pakistani number (no identity key was fabricated, which was already
right), but the Server Action still unconditionally wrote `verification_status: "verified"` to
`field_metadata` for the raw phone string regardless of whether normalization had succeeded —
a false-confidence bug in the same family as PHR 0008's domain bug, just on a different field.

Presented two possible fixes via AskUserQuestion (multi-select); user selected both:
1. Show a clear error in the form when a phone/domain doesn't parse.
2. Only mark a field "verified" when the system can actually validate it.

Implemented both with one mechanism: `createBusiness` now calls `normalizeDomain()` /
`normalizePhone()` immediately after the name-required check and *before* any database write.
Anything that fails to parse redirects back to `/records/new` with a specific, actionable error
message (mirroring the existing identity-collision error UX) instead of being stored. Because
nothing unparseable ever reaches the insert, every field that *does* get written as
`verification_status: "verified"` has honestly earned that label — no separate
"not-yet-validated" state was needed.

Verified at the function level with a throwaway script (Pakistani phone -> null, email-as-domain
-> null, valid US phone and valid domain both still parse correctly — confirming the fix
rejects exactly the two known-bad cases without breaking the working path). User then re-tested
in the browser; the dev server log confirms the new rejection fired
(`GET /records/new?error="03347329816" doesn't look like a valid US phone number...`).

## Outcome

- ✅ Impact: closed the second of two data-integrity bugs found via real (non-synthetic) use of
  the manual entry form — both in the same family (a value that failed the system's own
  normalizer was still labeled "verified"), which is exactly the false-confidence failure mode
  the project's founding principle exists to prevent.
- 🧪 Tests: typecheck clean; standalone script confirmed all four cases (2 reject, 2 pass); live
  browser confirmed the rejection path fires correctly.
- 📁 Files: 1 source file (validation moved before all writes).
- 🔁 Next prompts: user confirmed the fix works and asked to move on to whatever's next —
  choosing between a second "Member" role test account (permission differences) or starting
  Phase 3 discovery (needs Google Cloud API keys per pre-build-risks-and-api-limits.md).
- 🧠 Reflection: both real bugs found so far share one shape — a normalizer correctly returning
  `null`/rejecting bad input, but a downstream write path not checking that result before
  labeling data "verified". The domain fix (PHR 0008) only touched `normalizeDomain`; this fix
  had to be applied at the call site (`actions.ts`), not the normalizer, because the normalizer
  was already correct — the bug was in what the caller did with a `null` result. Worth carrying
  forward: any future field added to this form needs the same "validate before write, before
  labeling verified" gate, not a per-field ad hoc fix.

## Evaluation notes (flywheel)

- Failure modes observed: unlike PHR 0008 (bug was inside the normalizer), this bug was at the
  integration boundary between a correct normalizer and the code calling it — a reminder that
  "the normalizer has a passing test suite" doesn't guarantee the caller uses its result safely.
- Graders run and results: standalone script (PASS, 4/4 expected outcomes), typecheck (PASS),
  live browser re-test by the user (PASS — confirmed via request log).
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): apply the same adversarial-input pass already done
  for `domain` (PHR 0008's reflection) to `name` and `city`/`state` — no live bug found yet, but
  those normalizers haven't had a human deliberately try to break them either.
