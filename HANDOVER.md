# Lead Intel — handover

Everything a developer taking this project over needs: what it does, what it is built on, how each
part works, what it costs, what is deliberately unfinished, and the traps that have already caught
somebody.

Written on **27 October 2026**, against commit `d6cccba` on `main`.

Every figure in this document was read from the code or the live database, not from memory. Where
something is unfinished or uncertain, it says so.

---

## 1. What the product is

An internal tool for **AheadTech360**, a web/SEO agency. It finds local businesses, measures what
is wrong with their online presence, scores them, and tells a salesperson who to call and what to
say.

The promise it makes to its user, in one line:

> Here are businesses worth calling, here is what is wrong with each one, here is what to say, and
> here is where to record what happened.

Two kinds of user: an **administrator** (sources leads, sets budgets, writes the rules) and a
**member** (a salesperson who works their own leads). The member side is implemented; the admin
side is the same screens without the restrictions, plus the budget table.

**Live data today:** 559 businesses, 28,303 findings, 374 pages read, 386 paid calls, **$6.52
spent all time**, 6 ICPs, 0 calls logged, 2 accounts.

---

## 2. The stack

| Layer | Choice | Version | Why it matters |
|---|---|---|---|
| Monorepo | npm workspaces | — | `apps/*` + `packages/*`, no Turbo/Nx |
| Language | TypeScript | 5.6, strict | |
| Web | Next.js App Router | **16.3.1** | Server Components; **almost no client JS** — see §6 |
| UI | React | 19.2 | |
| Database | Supabase Postgres | ap-south-1 (Mumbai) | RLS on every table |
| Web → DB | PostgREST via `@supabase/ssr` | 0.12 | the user's own session, **never** the service role |
| Worker → DB | Drizzle ORM + `postgres` | 0.45 / 3.4 | service role, bypasses RLS |
| Background jobs | Trigger.dev | **4.5.16** | the only place long work runs |
| Browser | Playwright Chromium | 1.57.0 | reads pages a plain crawler is refused |
| HTML parsing | cheerio | 1.2 | |
| Validation | zod | 4.4 | provider responses only |
| Hosting | Vercel, region `bom1` | `apps/web/vercel.json` | same region as the database |

Node ≥ 20 (`trigger.config.ts` pins the worker runtime to node-22).

---

## 3. Repository layout

```
apps/
  web/                 Next.js app — every screen, every server action
    app/               routes (App Router)
    lib/               viewer, budget, job-runs, lead-filters, supabase clients
    proxy.ts           Next 16's middleware: refreshes the session, redirects signed-out users
  jobs/                Trigger.dev worker
    trigger/           task definitions (the ids Trigger.dev knows)
    src/               the actual work: crawl, audit, enrich, score, match
packages/
  shared/              enums, prices, weights, thresholds — no logic, no deps
  core/                the 64 checks, the scorer, ICP matching, openers — pure, fully tested
  db/                  Drizzle schema + SQL migrations (drizzle/)
  providers/           every outside call: Google Places, PageSpeed, Apify, Gemini, YouTube, browser
design/ui/             clickable HTML prototypes (the approved designs)
specs/multi-user/      the specification for roles, budgets, transfers, Showcase
history/prompts/       a record of every change and why (PHRs 0001-0042)
*.md (root)            the original specifications; see §13
```

**Dependency direction is one-way:** `shared ← core ← providers ← jobs`, and `web` depends on
`core`, `providers` and `jobs` (for task *types* only — never at runtime; see §6).

---

## 4. The data model

18 tables. The ones that matter:

| Table | Rows today | What it is |
|---|---|---|
| `businesses` | 559 | one row per business; carries scores, route, tier, website status, claim |
| `findings` | 28,303 | one row per check per business: outcome, points, evidence, source |
| `identity_keys` | — | how a business is recognised: `place_id`, `domain`, `phone`, `name_location` |
| `field_metadata` | — | one row per known fact (phone, email, instagram_followers…) **with its source and when it was checked** |
| `page_audits` | 374 | one row per page the browser opened: outcome, screenshot, console errors |
| `page_checklists` | — | the model's verdict per page against each checklist rule |
| `provider_calls` | 386 | **the money ledger** — written *before* each paid call |
| `job_runs` | 54 | one row per task started from the web app: state, progress, cost, who started it |
| `runs` / `run_grid_cells` | 16 | Google Maps discovery runs and their grid |
| `outcomes` | 0 | logged calls |
| `icps` | 6 | who you want to sell to |
| `import_batches` | 1 | CSV uploads |
| `user_roles` | 2 | `admin` \| `member` — **the whole permission system** |
| `member_budgets` | 1 | what each member may spend |
| `exclusions`, `suppression_hashes`, `merge_snapshots` | — | chains, do-not-contact, merge history |

### Two things that surprise everyone

1. **There is no `businesses.place_id`.** The Google listing id is a row in `identity_keys` with
   `key_type = 'place_id'`. Two queries were written against the column that does not exist and
   silently rendered zeroes — PostgREST returns an error and the client turns it into `null`.
2. **`provider_calls` has no owner column.** The worker writes it and the worker has no user
   session. A *person's* spend is therefore summed from `job_runs.cost_cents` where
   `created_by = them`. Both numbers are real; they are just counted at different levels.

### Migrations

20 SQL files in `packages/db/drizzle/`, applied in order. `0002_rls_policies.sql` is the one to
read first: it defines `private.is_admin()` (SECURITY DEFINER, the one sanctioned RLS bypass) and
every policy depends on it. The newest is `0023_member_budgets.sql`.

**Five migrations exist in the database with no file in this repo** — they were applied directly
and never back-filled. Confirmed against the live migration history:
`page_screenshot_policies`, `0016_page_critiques`, `0017_job_runs`,
`0018_field_metadata_field_name_index`, `0019_job_runs_trigger_run_id`.

So **the live schema is the source of truth, not `drizzle/`**. Read the database when in doubt, and
if you back-fill those five files, say in each that it is a transcription of what already ran.

---

## 5. How the product actually works

### 5.1 Getting businesses in — three ways

| Way | Who | Cost | Where |
|---|---|---|---|
| Google Maps search | **administrator only** | 3.5¢ a search + 3.5¢ a listing | `/search` → `/search/confirm` → `/search/runs/[id]` |
| Import a CSV | anyone | free | `/records/import` → review → confirm |
| Type one in | anyone | free | `/records/new` |

A Maps search builds a **grid** over the area (`run_grid_cells`) and runs one search per ICP word
per cell, stopping at the spend limit the user set. Duplicates are matched on identity keys —
domain, phone, place id — never on name.

**The import's one real limitation:** a spreadsheet carries no Google listing id and nothing can
work one out from a name. So for imported businesses the SEO and REP checks have no source at all
until the listing is bought — **36% of the Problem score's weight**. Every screen that shows this
says so.

### 5.2 Analysis — what runs, in order

1. **Crawl** — up to four pages (home, contact, socials, about), plain HTTP, obeying robots. Free.
2. **Presence verdict** — one of `live`, `dead`, `social_only`, `no_website`, `unclear`.
3. **The 64 checks** run against whatever came back.
4. **PageSpeed** — Google's own Lighthouse run. Free.
5. **YouTube** — channel presence. Free, ~100 businesses/day quota.
6. **Scoring** — arithmetic over the stored findings. Free, re-runnable.
7. **ICP matching** — free.

**Reading pages in a real browser** is separate and optional: Chromium opens each page, keeps
screenshots of the home and product pages, records console errors, and then asks Gemini what the
measurements miss. 35 seconds a page; the home page gets one retry.

### 5.3 The 64 checks

Counted from `packages/core/src/checks/registry.ts` — **never hardcode this number anywhere**:

| Family | Area | Checks | Points | Weight in Problem |
|---|---|---|---|---|
| W | Website quality | 12 | 468 | 0.24 |
| S | Found on Google | 14 | 283 | 0.20 |
| R | Reviews | 6 | 135 | 0.16 |
| K | Getting in touch | 8 | 132 | 0.14 |
| O | Social media | 8 | 178 | 0.14 |
| D | Ads & tracking | 6 | 120 | 0.12 |
| **N** | **Intent** | **10** | **135** | *feeds the Signals score only* |

A check has **three** outcomes, never two: `fired` (there is a problem), `passed` (ran, no
problem), `not_measured` (nobody could answer). **The third one is load-bearing.** It counts for
neither side, and the whole product is built so it never quietly becomes a pass or a fail.

**17 cannot be answered today**, each for a stated reason: Google's API returns no individual
reviews, review dates, photo counts or claimed status at any price (9); rank needs DataForSEO,
which is not connected (2); social post dates have no source anywhere (5); Meta ads has never been
bought (2 — overlapping).

### 5.4 Scoring

All constants live in `packages/shared/src/enums.ts`. Read them there; do not copy them.

```
area score   = 100 × points that fired ÷ points that ran
               …but only if coverage ≥ AREA_COVERAGE_FLOOR (0.40), else null
problem      = 0.6 × worst area + 0.4 × weighted average of scored areas
signals      = sum of N-family points that fired, capped at 100
passedGate   = problem ≥ 55 and not a shared/chain domain
```

| | Signals ≥ 35 | Signals < 35 |
|---|---|---|
| **Problem ≥ 55** | **Priority 1** | **Priority 3** |
| **Problem < 55** | **Priority 2** | **Priority 4** |

Two overrides beat the table:

- **Presence override** — no website, dead, social-only, *or* an unclear site whose Google listing
  carries no website link (check S6 fired) → `max(problem, 90)`, route web development.
- **Demand rescue** — a site that could not be read but which has proven demand (≥50 reviews, ≥4.0
  rating, or ≥10,000 followers) → Problem 90, Priority 1, flagged for a human. Chains excluded.

**What to sell** is the highest-scoring area with a 5-point tie-break, in the order web development
· local SEO · reputation · contactability · social · advertising — **and the winning area must have
something fired**, or there is no route and the record says so.

Nobody can type a score, a priority or a route in. Not a member, not the administrator, not the
model.

### 5.5 Calls

`logOutcome` writes channel (call/message), result (7 values), objection (7 values), which opener
area was used, free-text notes (≤2,000) and a meeting date. A call **survives a merge**, so tidying
duplicate records never loses a conversation.

---

## 6. The web app

### Conventions that are not obvious

- **Server Components by default.** There is almost no client JavaScript: filters are GET forms,
  tabs are URLs, the sidebar rail and the theme are cookies, and "select all" is a link that
  reloads with `all=1`. The exceptions are `running-jobs.tsx` (polling) and nothing else worth
  naming. Keep it that way unless there is a reason — a lot of the product's reliability comes from
  there being no state to lose.
- **Every long action goes through Trigger.dev**, never inline. The pattern is: `startJobRun()`
  writes a row → `tasks.trigger()` queues the work → `attachTriggerRun()` records the run id so it
  can be cancelled → the worker updates the row as it goes.
- **`apps/web` imports task *types* from `apps/jobs`, never the task itself.** A runtime
  `await import()` of a task drags Drizzle, the DB driver and every provider into the web bundle —
  this has already broken the build once. Use `import type`.
- **The service role key must never be in `apps/web` or on Vercel.** It bypasses every RLS policy.
  It belongs in `apps/jobs/.env` and the Trigger.dev production environment, and nowhere else.

### Routes

| Route | What it is | Member |
|---|---|---|
| `/login`, `/auth/confirm` | sign in | yes |
| `/dashboard` | what is worth doing next, the four stages, breakdowns | own figures |
| `/records` | the leads list — filters, ticks, bulk actions | own leads |
| `/records/[id]` | one lead, four tabs (`?tab=website\|checks\|calls`) | own leads |
| `/records/new`, `/records/import`, `/records/imports`, `/records/imports/[id]` | getting leads in | yes |
| `/records/enrich` | buy paid data, priced and confirmed | within budget |
| `/records/export` | CSV of exactly the current filters | own |
| `/analysis` | coverage, thin scores, pages that failed, what the checks cover | own |
| `/instagram` | social data, who is worth looking up, Meta ads | own |
| `/tasks` | every task, its state, cost, result | own |
| `/calls` | own call history | own |
| `/spend` | costs, what is free, allowance; **budget table for admins** | own |
| `/icps`, `/checklists`, `/priority-rules`, `/rules` | reference | **read-only** |
| `/notifications`, `/transfers`, `/showcase` | agreed, **not built** — labelled as such | — |
| `/search`, `/search/confirm`, `/search/runs/[id]` | Maps search | **admin only** |

### Server actions (18 files, ~30 actions)

`app/actions.ts` (signOut, toggleRail, setTheme, stopJobRun) · `records/actions.ts` (claim,
release) · `records/analyse-actions.ts` · `records/audit-actions.ts` (audit all/ticked, rescore,
buy for ticked/filtered) · `records/enrich/actions.ts` (buyEnrichment) ·
`records/import/actions.ts` · `records/new/actions.ts` · `records/[id]/*` (audit, explain, log
outcome, save Instagram) · `icps/actions.ts` · `checklists/actions.ts` · `search/confirm/actions.ts`
(createRun) · `spend/actions.ts` (setBudget).

---

## 7. Permissions — how the two sides are kept apart

`apps/web/lib/viewer.ts` is the only place that asks who is signed in.

```ts
getViewer()            → { id, email, role, isAdmin } | null   // reads user_roles
leadScope(viewer)      → null for an admin, { column: "claimed_by", value: id } for a member
requireAdmin(where)    → redirects a member away, with a sentence rather than a 403
```

Three layers, and the first two are convenience:

1. **The navigation** hides what a member may not use.
2. **The page** refuses the address and says why (`AdminOnlyNotice`), and every scoped query applies
   `leadScope` before counting anything.
3. **Row-level security** is the real boundary. Every table has RLS on; `private.is_admin()` is the
   helper every policy uses.

**A member sees only their own:** leads, calls, tasks, spend, notifications. **Showcase is the one
agreed shared exception** (not built yet).

> ⚠️ **The one business rule that is a stand-in.** "A member's leads" currently means *the leads
> they have claimed* (`businesses.claimed_by`), because claiming is the only ownership the database
> has. The agreed model is **assignment** (`specs/multi-user/spec.md` §2), which is not built. When
> `owner_id` lands, change `leadScope()` and nothing else — that is why it is a function.

---

## 8. The worker

`apps/jobs`, Trigger.dev project `proj_qarelorrhbssyawxssqv`, 13 task ids:

| Task | What it does |
|---|---|
| `discovery` | Google Maps grid search (admin) |
| `analyse-run` | crawl + 64 checks + PageSpeed + YouTube + score, in bulk |
| `audit-website`, `audit-run` | the crawl on its own |
| `audit-site`, `audit-site-run` | read pages in a real browser + the model's critique |
| `enrich-run` | buy listing / Instagram / Meta ads, with a spend cap |
| `match-icps-run` | sort businesses into ICPs |
| `score-run` | re-score from stored findings |
| `pagespeed`, `pagespeed-run`, `youtube`, `youtube-run` | the free measurements |

Each one updates its `job_runs` row as it goes: `done`/`total`, the step in words, and
`cost_cents` accumulated **as it runs** so spend is visible while it happens.

**Task states the product shows:** waiting · not picked up (>2 min) · never started (expired after
10 min) · running · gone quiet (silent >15 min) · finished · stopped. The web app asks Trigger.dev
what actually happened to a row that stopped reporting and closes it with the real reason.

---

## 9. Money

The ledger (`provider_calls`) is written **before** the call, so it cannot flatter itself. A failed
call is recorded and **never charged**.

| What | Provider | Price | Status |
|---|---|---|---|
| Maps search | Google Places | 3.5¢ a search | working |
| Google listing details | Google Places | **3.5¢** a business | working |
| Instagram profile | Apify | **0.26¢** a business | working, used 167× |
| Meta ads | Apify | **11.6¢** a business | built, **never run** |
| Page critique / explain / ICP suggestion | Google AI Studio (Gemini 2.5 Flash) | ~0.05¢ a page · ~0.3¢ · ~0.1¢ | working |
| PageSpeed, YouTube, own crawl, browser read, scoring, ICPs, import, export, calls | — | **free** | working |
| Traffic & rank | DataForSEO | 0.12¢ | **not connected** |
| Owner's mobile | Lusha | **73¢** | **not connected, parked on purpose** |

Prices live in `packages/shared/src/enrichment.ts`. Every screen that spends money names the
provider beside the price — that is a standing instruction from the operator, not a style choice.

**Where the $6.52 has actually gone**, from the ledger:

| Endpoint | Calls | Cost |
|---|---|---|
| `places.details` (listing) | 77 | $3.08 |
| `searchText` (Maps search) | 71 | $2.66 |
| `apify.instagram` | 167 | 43.4¢ |
| `searchText:center` | 10 | 31.4¢ |
| `critique-page` (Gemini) | 61 | 3.2¢ |

Note what is absent: **no Meta ads rows at all.**

**Budgets** (`member_budgets`, migration 0023): an administrator sets an amount and a period
(once/weekly/monthly) per member from `/spend`. A member sees what is left; a purchase past the
line is refused **before** anything is bought — on the screen *and* again in the action. No row
means "nobody has decided yet"; zero means "you may buy nothing" — two different sentences.

---

## 10. Running it locally

```bash
npm install
cp .env.example .env            # repo root — used by the worker and drizzle
cp .env.example apps/web/.env.local   # Next.js only reads env from its own directory

npm run build:packages          # shared → core → db → providers, in that order
npm run dev --workspace apps/web   # http://localhost:3000
npm run dev --workspace apps/jobs  # the worker — see the warning below
```

**Environment variables** (`.env.example` lists them with notes):

| Variable | Where it belongs |
|---|---|
| `DATABASE_URL` | root `.env` (worker, drizzle) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `apps/web/.env.local` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | **`apps/jobs/.env` only** |
| `GOOGLE_PLACES_API_KEY`, `APIFY_TOKEN`, `GEMINI_API_KEY` | worker |
| `TRIGGER_SECRET_KEY` | both — **and this is the trap below** |

### Four traps that have already cost a day each

1. **`tr_dev_…` queues into the dev environment, which only has a worker while `trigger dev` is
   running.** Start a task from localhost without the worker running and it sits queued for ten
   minutes and is then expired by the platform with nothing read, bought or spent. The product now
   says exactly that, but the cause is the key.
2. **Never run `next build` while `next dev` is running.** The build replaces `.next` underneath
   the dev server and wedges localhost while still looking alive.
3. **A home DNS resolver can fail hundreds of crawls at once** (`dns_temporary` in bulk). It is the
   machine, not the sites. Do not re-run by hand; fix the resolver.
4. **A `.env` file is not a shell script.** `source .env` executes its lines — one of them leaked a
   database URL with its password into a log. Parse it (`grep -m1 '^KEY=' file | cut -d= -f2-`).

### Tests

```bash
npm test                  # all workspaces
```
**558 core · 106 providers · 8 db**, all passing at `d6cccba`. `npx tsc --noEmit -p apps/web/tsconfig.json`
for the web app.

The core tests are the ones that matter: they cover the 64 checks, the scorer, coverage, ICP
matching and the openers. Anything that changes a score should fail a test first.

---

## 11. Deployment

- **Web** → Vercel, region `bom1` (Mumbai, same as the database — `apps/web/vercel.json`). Env
  vars: the two `NEXT_PUBLIC_*`, `TRIGGER_SECRET_KEY` (a **prod** key), `GEMINI_API_KEY`.
  **Never the service role key.**
- **Worker** → `npm run deploy --workspace apps/jobs` (Trigger.dev). Its env is set in the
  Trigger.dev dashboard and includes `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL`.
- **Database** → migrations in `packages/db/drizzle/`, applied to Supabase. Check `0002` before
  touching any policy.

---

## 12. What is deliberately unfinished

Everything here is **specified and designed, with no backend** — and every screen that touches it
says so rather than pretending. `specs/multi-user/spec.md` and `tasks.md` hold the agreed design.

| Thing | State |
|---|---|
| Assignment of leads to people | specified; `claimed_by` is the stand-in |
| Notifications (9 events, per person) | screen drawn, labelled, no table |
| Transfers (member asks, admin approves) | screen drawn, labelled |
| Showcase (the one shared place) | screen drawn, labelled |
| Priority rules as an ordered admin-written list | the live 2×2 table is what runs |
| Task filters, deleting a task, "leads this task touched" | not built |
| Saved views on the leads list | not built — the URL carries the filters |

**Known gaps that are not features:** no profile page, no password change (Supabase Auth handles
it, accounts are made by an admin), no column sorting, no "follow-ups due today" screen, no
arbitrary lead editing (only website and Instagram URL), no delete/archive for a member, no credit
system.

**Meta ads has never been bought once.** The wiring is written and tested; the purchase is not.
Whoever runs it first should expect to be the first.

---

## 13. Where to read next

| File | Why |
|---|---|
| `specs/multi-user/user-side-functionality.md` | **the best single description of what the product does** — 26 sections, every feature, every price, every limit |
| `specs/multi-user/user-feature-inventory.md` | the 42-item audit: every capability and where it lives |
| `specs/multi-user/spec.md`, `tasks.md` | the agreed multi-user design and its build order |
| `design/ui/lead-intel-user.html` | the approved member design, clickable |
| `design/ui/lead-intel-admin.html` | the approved admin design, clickable |
| `history/prompts/` | 42 records of what changed and **why** — read 0032, 0041 and 0042 first |
| `SETUP.md` | the original phase-by-phase setup |
| `scoring-model-v0.1.md`, `audit-test-catalogue-v0.1.md` | where the scoring and the checks came from |
| `data-sources-and-costs.md` | every source considered, including the rejected ones |

The code is heavily commented, and the comments explain **why**, including the mistakes. They are
worth reading before changing anything that looks odd — most odd things in this repo are odd on
purpose.

---

## 14. The five rules this product is built on

Break these and the product stops being trustworthy, which is the only thing it has.

1. **Three answers, never two.** Yes, no, and *nobody has looked* are different. An unanswered
   check is never a pass and never a failure, and an unknown fact never satisfies a condition.
2. **Nothing is bought without a screen that states the price, the provider and the total first.**
   The ledger is written before the call. A failed call is never charged.
3. **The model never sets a number.** Scores, priorities, routes and ICPs are arithmetic over
   measured findings. AI output is marked, labelled with the model, and priced.
4. **A member sees only their own.** Leads, calls, tasks, spend. Enforced in the database, not by
   hiding buttons.
5. **Say what is not known, and why.** Every check that cannot be answered carries its reason; every
   failure says what was affected and whether money was spent.

---

## 15. Accounts and access the next developer needs

- **Supabase** project (ap-south-1) — database, auth, storage bucket `page-screenshots`.
- **Trigger.dev** project `proj_qarelorrhbssyawxssqv` ("Data Scraping") — dev and prod keys.
- **Google Cloud** — Places API, PageSpeed, YouTube Data API. Quotas are set deliberately; read
  `pre-build-risks-and-api-limits.md` before raising them.
- **Apify** — Instagram profile scraper and Facebook ads scraper actors.
- **Google AI Studio** — Gemini API key.
- **Vercel** — the web deployment.
- **GitHub** — `Aheadtech360Development/lead-intel`.

There is one administrator account and one **test member account**
(`member.test@aheadtech360.local`, password in `apps/web/.env.local`, which is gitignored). The
test member exists to check the member boundary; delete it and its `user_roles` /
`member_budgets` rows when it is no longer useful.
