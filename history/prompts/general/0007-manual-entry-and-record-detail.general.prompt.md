---
id: 0007
title: Manual entry and record detail
stage: green
date: 2026-08-17
surface: agent
model: claude-sonnet-5
feature: none
branch: master
user: umeradnan7106
command: (direct request — chosen from an AskUserQuestion: "Manual entry form + record detail")
labels: ["phase-2", "manual-entry", "record-detail", "turbopack", "monorepo-build", "nextjs-16"]
links:
  spec: local-lead-intelligence-specification-v4.0.md
  ticket: null
  adr: null
  pr: null
files:
 - apps/web/app/records/new/{page.tsx,actions.ts} (created)
 - apps/web/app/records/[id]/page.tsx (created)
 - apps/web/app/records/page.tsx (edited — rows link to detail, "Add a business" entry point)
 - packages/shared/package.json, packages/core/package.json, packages/db/package.json (main/types
   now point at dist/, added a build script)
 - apps/web/next.config.ts (removed transpilePackages, no longer needed once dist/ exists)
 - package.json (root — fixed build script ordering: packages before apps/web, explicit not
   relying on npm workspaces' undefined ordering)
 - SETUP.md (documented the required build:packages step)
tests:
 - npm run typecheck --workspace=@lead-intel/web — clean after 2 fix cycles (nullable getClaims
   destructuring pattern repeated from the earlier session; a supabase-js join inferring an array
   where a to-one object was assumed)
 - npx next build — failed first attempt (Turbopack could not resolve packages/core's raw .ts
   source via its own .js-suffixed NodeNext-style relative imports); fixed by giving
   shared/core/db real dist/ build output; second attempt produced all 8 routes cleanly
 - MCP execute_sql, transactional (ROLLBACK) — replayed the manual-entry Server Action's exact
   insert sequence (business -> identity_keys -> field_metadata) as the real admin user under
   RLS; confirmed all three inserts succeed and the joined read-back is correct
 - Dev server verified booting cleanly on port 3000 after killing a stale orphaned instance that
   was blocking the port with pre-fix config
---

## Prompt

*(Selected via AskUserQuestion from three options — "Manual entry form + record detail (Recommended)" — after confirming Phase 2's RLS + login + companies list milestone worked end-to-end with a real account.)*

## Response snapshot

Built the two pieces build guide Phase 2 still needed: `/records/new` (manual entry) and
`/records/[id]` (detail).

**Manual entry** reuses `packages/core`'s `buildIdentityKeys`/`normalizeName` rather than
reimplementing normalization in the web app — the same deterministic logic the pipeline will use
later. Deliberately does a pre-check SELECT against `identity_keys` before inserting, rather than
catching a `23505` unique violation the way the pipeline must (build guide §3.4): that rule
exists because the pipeline has many concurrent workers racing on the same keys; one human filling
out one form sequentially has no such race, so the simpler tool is the correct one for this
specific context, not a violation of the pipeline's rule applied outside where it was reasoned
for. On a collision, the operator is redirected back with the name of the existing record rather
than silently creating a duplicate or attempting an automated merge (merge logic stays in the
pipeline layer, not scattered into UI code).

**Record detail** deliberately does NOT reproduce the earlier wireframe's full "why this
lead / evidence / openers" layout, because that data — findings, scores, routing — does not exist
yet (Phase 5). Built only what Phase 1–2 actually store: company facts, identity keys, the
field-level provenance table (source, verification status, last checked — literally the
Phase 2 version of the wireframe's Provenance tab, now backed by real data), and outreach
history. Added an explicit banner stating what's deferred to Phase 5, rather than either faking
those sections or silently omitting them without explanation — same honesty principle the whole
spec is built on, applied to the build's own incompleteness this time.

**Hit and fixed a real structural build issue.** `next build` failed: Turbopack could not resolve
`packages/core`'s relative imports, which use the `.js`-extension convention required by
TypeScript's `NodeNext` module resolution (correct for `tsc`/`vitest`, which is why Phase 1's
tests and typecheck were already green) but meaningless to a bundler when only `.ts` source
exists on disk — there is no real `.js` file yet for the specifier to resolve to. `main`/`types`
in all three internal packages pointed at raw `src/index.ts`; fixed by giving each package a real
`build` script and pointing `main`/`types` at compiled `dist/` output instead, which also
resolves the extension question correctly for any future consumer (Trigger.dev in Phase 3 will
need the same thing). Also fixed the root `build` script, which previously relied on npm
workspaces' unspecified execution order across `packages/*` and `apps/*` — now explicit:
shared → core → db → web.

## Outcome

- ✅ Impact: the full record lifecycle now exists end-to-end on the real database — a human can
  add a business by hand, see it in the list, open its detail page, and see exactly where every
  field came from. The Turbopack/NodeNext fix removes a landmine that would otherwise have
  resurfaced identically the moment Trigger.dev needed to import `@lead-intel/core` or
  `@lead-intel/db` in Phase 3.
- 🧪 Tests: typecheck clean, production build clean (8 routes), a transactional RLS replay of the
  exact insert sequence the new Server Action performs (as the real seeded admin, not a
  simulated UUID this time), dev server confirmed booting cleanly after clearing a stale process.
- 📁 Files: 3 new app files, 3 package.json build-output changes, 1 next.config.ts simplification,
  1 root script fix, 1 doc update.
- 🔁 Next prompts: user tests the full flow in their own browser (add a business, open its detail
  page, claim/release) — the one step this session cannot perform itself. After that: either a
  second Member-role account to see the permission difference in the UI, or Phase 3 discovery,
  which needs Google Cloud API keys per pre-build-risks-and-api-limits.md.
- 🧠 Reflection: the raw-TS-with-NodeNext-extensions pattern worked perfectly through two full
  rounds of `tsc`/`vitest` verification in the earlier session and gave no signal it would fail
  under a *different* toolchain until Turbopack actually tried to bundle it. Passing typecheck
  and tests is evidence the TypeScript is correct, not evidence every consumer's module resolution
  agrees on what "correct" resolves to — worth remembering before assuming a workspace package is
  consumption-ready just because its own tests pass.

## Evaluation notes (flywheel)

- Failure modes observed: shipped raw TypeScript source across three internal packages under the
  implicit assumption that "TypeScript compiles cleanly" is sufficient for cross-package
  consumption in a monorepo with multiple different toolchains (vitest/tsc for packages,
  Turbopack for the Next.js app, eventually Trigger.dev's own bundler) — it isn't, and the gap
  only became visible when a second toolchain actually tried to consume the package.
- Graders run and results: typecheck (PASS, 2 fix cycles), production build (FAIL then PASS after
  the dist/ fix), transactional insert-sequence replay (PASS), dev server boot (PASS after
  clearing a stale process).
- Prompt variant (if applicable): n/a
- Next experiment (smallest change to try): when a new internal package is first created, verify
  it under EVERY toolchain that will eventually consume it (not just its own test runner) before
  building substantial code on top of it — would have caught this during Phase 1 instead of mid-
  Phase-2, when only one dependent (`apps/web`) existed to reveal it.
