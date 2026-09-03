> # ⚠ PARTLY SUPERSEDED
>
> **Still correct:** the whole stack (Next.js on Vercel, Supabase, Trigger.dev, Playwright on
> Railway, Drizzle, Zod), the repository layout, §3.4 late merge, §3.5 the call ledger, §3.6 the
> refresh job, §3.7 RLS, §7 testing, and §9 the crawl policy.
>
> **Now wrong:** the discovery adapter (Store Leads / BuiltWith), the enrichment adapter
> (Apollo), and the class A/B/C/R cost classes — replaced by FREE / PAID / BEST EFFORT in
> `local-lead-intelligence-specification-v4.0.md` §5.
>
> The engineering advice holds. The data sources do not.

---

# Development Build Guide

**Lead Intelligence & Enrichment System — AheadTech360**

Companion to: Final Specification **v3.2**, `scoring-model-v0.1.md`, `audit-test-catalogue-v0.1.md`
Build context: solo developer, TypeScript, managed hosting
Date: 13 August 2026 (revised from 12 August 2026)

---

## 0. What changed in this revision

- **Citations corrected.** The previous version cited `§4.5` for the any-key-resolution rule
  (that rule is §4.3 and §7.1; §4.5 in v3.2 is late merge) and cited `§15.2` three times for
  retention (retention is §13; review-text retention is §3.5). The pattern was a stale
  reference set from v3.0 numbering.
- **A false attribution removed.** The previous version stated "Spec §15.2 permits indefinite
  storage of `place_id`". The specification never said this — it is a provider-terms fact that
  had been imported as if it were a specification rule. It now lives in Spec §13 as an actual
  rule, with the instruction to read the current terms rather than trust either document.
- **New sections** for the design decisions that were missing: late merge against the unique
  constraint (§3.4), the idempotency ledger (§3.5), the refresh job (§3.6), authorization
  (§3.7), and the crawl policy (§9).
- **Build order corrected** so the class A audit checks land before the enrichment gate that
  depends on them.

---

## 1. Confirmed Stack

Every choice below is settled. No alternatives are listed, because evaluating options mid-build
is how solo projects stall.

| Layer | Tool | Role |
|---|---|---|
| Frontend + API | **Next.js 16 (App Router) + TypeScript** on Vercel | Platform UI, record views, search briefs |
| Database | **Supabase Postgres** | All records, keys, provenance, outcomes |
| Auth + roles | **Supabase Auth + RLS** | Login, MFA, Admin/Member roles (Spec §12.3), enforced in the database (§3.7) |
| Background jobs | **Trigger.dev** | Discovery, enrichment, audit, refresh runs |
| Browser automation | **Playwright** on Railway | Class R rendered checks |
| ORM | **Drizzle** | Schema in TypeScript, migrations |
| Validation | **Zod** | Every external response, without exception |
| HTML parsing | **cheerio** | First-party crawling |
| Phone | **libphonenumber-js** | E.164 normalisation (Spec §4.2) |
| Domain | **tldts** | Domain normalisation |
| Retry | **p-retry** | Provider call resilience |
| AI | **Claude API**, direct `fetch` calls | Four specific tasks only (§4) |

### Explicitly not used

- **No agent frameworks** — LangChain, CrewAI, AutoGen, or equivalent. The pipeline shape is
  fixed; agents add nondeterminism, cost, and debugging difficulty to a process that has none
  of those problems today.
- **No AI agents.** Workers are code.
- **No Python.** One language across the whole project.
- **No AWS/GCP** in v1. Managed services until scale demands otherwise.
- **No Google Sheets export** in v1. CSV only.

### Why the UI and the pipeline are separated

Vercel functions have execution time limits. A 500-record enrichment run takes hours and cannot
complete inside one.

This is the single most common architectural mistake in projects of this shape: the pipeline is
written into Next.js API routes, works on a five-record test, and times out on the first real
run — after which a large portion has to be rewritten.

**Rule: Next.js handles requests. Trigger.dev handles runs.** An API route may only enqueue a
job and return immediately. It must never perform discovery, enrichment, or audit work inline.

---

## 2. Repository Structure

A single repository, three deployment targets.

```
lead-intel/
├─ apps/
│  ├─ web/                    → Vercel (Next.js)
│  │  ├─ app/
│  │  │  ├─ (auth)/
│  │  │  ├─ records/          record list, record detail (Spec §20), create/edit form
│  │  │  ├─ search/           search brief builder + run planner (Spec §5.5)
│  │  │  ├─ review/           manual review queue (a filtered view)
│  │  │  ├─ admin/            users, exclusion list, suppression requests
│  │  │  └─ api/              thin — enqueue jobs only
│  │  └─ components/
│  │
│  ├─ jobs/                   → Trigger.dev
│  │  └─ tasks/
│  │     ├─ discovery.ts
│  │     ├─ consolidation.ts
│  │     ├─ free-audit.ts     class A checks + Stage 2.5 gate
│  │     ├─ enrichment.ts
│  │     ├─ validation.ts
│  │     ├─ audit.ts          class B + R checks
│  │     ├─ scoring.ts
│  │     └─ refresh.ts        nightly refresh, retention purge, key re-verification
│  │
│  └─ browser/                → Railway (Playwright service)
│     └─ src/
│        ├─ server.ts         HTTP endpoint the audit job calls
│        └─ checks/           checkout traversal, signup submission
│
├─ packages/
│  ├─ db/                     Drizzle schema + migrations
│  ├─ core/                   identity, normalisation, scoring, routing, dedup, merge
│  ├─ providers/              one adapter per external source + recorded fixtures
│  ├─ ai/                     versioned prompts + Zod output schemas
│  └─ shared/                 types, Zod schemas, enums
```

### What belongs in `packages/core`

Everything deterministic and testable in isolation, with no network calls:

- Domain, phone, name, and location normalisation
- Identity key construction and rank assignment
- Merge, late-merge, and conflict resolution rules
- Problem and Intent score calculation (both `problem_free` and `problem_full`)
- Service routing rules

**This package is where unit tests live and where correctness is decided.** Keeping it free of
network calls is what makes it testable.

### What belongs in `packages/providers`

One adapter per source, all conforming to the contract in Spec §16.1. The adapter's only job is
to call an external API and return normalised, Zod-validated output plus metadata.

```typescript
interface ProviderResult<T> {
  provider_name: string
  provider_record_id: string | null
  source_url: string | null
  retrieved_at: Date
  fields: T
  confidence: 'verified' | 'unconfirmed' | 'unknown'
  cost_or_credits: number
  terms_classification: 'first_party' | 'provider' | 'api_restricted' | 'derived' | 'display_only'
  raw_response_retention_rule: 'store' | 'ttl' | 'no_store'
}

interface ProviderCapabilities {
  supported_pushdown_filters: FilterKey[]   // Spec §5.5 — the run planner reads this
  rate_limit: { requests: number; per_ms: number }
}
```

Adapters must not write to the database and must not make decisions. They fetch and normalise.
Merging is `core`'s job.

Every adapter reports `attempted`, `succeeded`, and `returned_count` **separately**. Conflating
them is what makes a broken collector indistinguishable from a genuine zero-result search.

### What belongs in `packages/ai`

Prompts are versioned artefacts, not string literals scattered through job files. Each prompt
ships with its Zod output schema and a version string stored alongside `score_version` on any
record it touched. Without that, output drifts silently and no past record can be explained.

---

## 3. Database Design Notes

Full field lists are in Spec §7. Points below are where implementation goes wrong if left
implicit.

### 3.1 Identity keys belong in their own table

Do not put `domain`, `place_id`, `phone_e164`, `fb_page_id` as columns on the record table. Use
a separate `identity_keys` table:

```
identity_keys
  record_id    → records.id
  key_type     enum: domain | place_id | phone_name | fb_page_id | ig_account | ig_handle | name_location
  key_value    text
  rank         1–5
  confidence   text
  added_at     timestamptz
  migrated_from  record_id | null
  unique(key_type, key_value)
```

**Reason:** Spec §4.3 requires that a match on *any* key resolves to the same record, and that
new keys are added over time as migration events; Spec §7.1 lists the key set. A
columns-on-record design makes "look up by any key" a multi-column OR query that cannot be
uniquely indexed. This design makes it one indexed lookup, and the unique constraint enforces
one-business-one-record at the database level rather than in application code.

`ig_handle` is a separate key type from `ig_account` because Spec §4.1 treats it as mutable and
low-confidence, subject to 30-day re-verification.

### 3.2 Field metadata cannot be an afterthought

Spec §7.3 requires source, confidence, verification status, and timestamps on every externally
sourced field. Two workable approaches:

- **Attribute table** — one row per field per record. Fully flexible, more joins.
- **JSONB metadata column** alongside the value columns, keyed by field name.

Either is acceptable. What is not acceptable is deferring it: retrofitting provenance onto an
existing dataset means every stored field has unknown origin, and Spec §13's retention rules
become unenforceable.

Store **raw signal values** too, not only computed scores. Spec §7.4 requires it, and
recalibration (`scoring-model-v0.1.md` §7.3) recomputes old records under a new model version.
Without the inputs, every weight change means re-running paid collection.

### 3.3 Retention is enforced by `terms_classification`

Spec §13 requires that where a provider permits an identifier to be stored indefinitely but
restricts the associated content to a short caching window, the difference is encoded in the
data rather than in documentation. `terms_classification` and `next_refresh_at` are that
encoding; the refresh job (§3.6) is what acts on them.

**Read the current provider terms and record the permitted window in the adapter.** Do not take
a caching window from this document or from the specification — both go stale, and the adapter
is where the fact belongs.

If retention lives only in a document, it will not be followed.

### 3.4 Late merge: catch the constraint violation, do not pre-check

Spec §4.5 defines what happens when a key already belongs to another record. The implementation
detail that matters:

**Do not `SELECT` to check whether the key exists and then `INSERT`.** That is a race — two
concurrent discovery workers both see the key as free and one insert fails anyway, at a point
where the transaction is harder to reason about. Instead, attempt the insert inside a
transaction and catch the unique violation (Postgres `23505`) explicitly, then run the §4.5.2
auto-merge test.

```
try INSERT identity_keys(...)
catch 23505:
    load owning record B
    if §4.5.2 conditions hold  → merge(survivor = earlier created_at)
    else                       → enqueue manual review, status potential_duplicate
```

The merge itself is a `core` function taking two record snapshots and returning a merged
snapshot plus a conflict log — pure, unit-testable, and no database access. The job layer
applies the result and writes the pre-merge snapshot required by Spec §4.5.4.

Merge is where silent data loss happens. It gets the same test coverage as normalisation.

### 3.5 The provider call ledger makes retries safe

Spec §14 requires partial failures to preserve completed fields, and Spec §16.2 defines the
idempotency key. Without a ledger, that requirement turns into a mechanism for buying the same
data twice.

```
provider_calls
  idempotency_key  text primary key   -- hash(run_id, stage, record_id, provider)
  run_id, record_id, provider, endpoint
  called_at        timestamptz
  status           succeeded | failed | schema_invalid
  cost_or_credits  numeric
  response_ref     text | null        -- honours raw_response_retention_rule
```

Every worker checks the ledger **before** any paid call and writes the ledger row in the same
transaction as the field writes. A retried job finds its key and reuses the result.

This is also the cost ledger. Spec §15.2's cost-per-enriched-record and Spec §8.2's ceilings
are both queries against this table, so the "simple counter per run" reduction from the previous
revision is no longer needed — the ledger gives real numbers for free.

### 3.6 The refresh job

Spec §14 has a full refresh table, and until this revision the job that acts on it appeared in
no phase and no folder. It runs nightly:

1. Refresh fields whose `next_refresh_at` has passed, by refresh class.
2. Purge fields whose `terms_classification` is `api_restricted` or `display_only` and whose
   permitted window has passed.
3. Re-verify Instagram handle keys at 30 days; detach and raise review on mismatch (Spec §4.1).
4. Archive unclaimed, uncontacted records at 180 days.
5. Re-validate contacts older than 90 days on records queued for outreach.

Each step is budget-aware and writes to the same call ledger. A refresh that quietly consumes
the month's enrichment credits is a real failure mode.

### 3.7 Authorization: RLS on, service role only in jobs

Spec §17 requires that "a member cannot view or edit more data than their role permits". With
Supabase there are two ways to satisfy this, and the choice has to be explicit because the
convenient default silently defeats it.

**Decision: Row Level Security is enabled on every user-facing table, and the Next.js app talks
to Postgres with the signed-in user's JWT.** The service role key is used only by Trigger.dev
jobs, which run as the system and never serve a user request.

The alternative — service role key in the web app with role checks in application code — is
faster to write and fails open. One route that forgets its check exposes everything, and nothing
in the database prevents it. With two roles and roughly a dozen tables, the policy set is small
enough that the structural version is worth the extra day.

Consequence to remember: any Next.js server code that needs to bypass RLS legitimately (an
admin export, for instance) must do so through an explicit, audited path — not by reaching for
the service key.

---

## 4. Where AI Is Used

Four tasks. Everything else is code.

| Task | When it runs | Notes |
|---|---|---|
| Parse open text into a filter object | On search submit | Output must be Zod-validated. Invalid output is rejected, not patched |
| Write one-line business description | Enrichment | From crawled site content |
| Summarise reviews by theme | Enrichment | Derived output — raw review text is not retained (Spec §3.5, §13) |
| Write call and IG DM openers | On record open, or Tier 1–2 only | Cost control: not generated for every record at run time |

### Where AI is prohibited

- **Identity matching, deduplication, and merge.** Must be deterministic — the same input must
  produce the same result on every run.
- **Scoring and routing.** Spec §10.1 requires a documented, versioned model; §15 requires
  comparison against previous versions. A model whose output varies between identical runs
  cannot be calibrated, which would defeat the entire feedback loop.
- **Generating audit findings.** Spec §9 is explicit: no AI statement may appear as a factual
  finding unless tied to a measured result. Code measures; AI may only phrase what was measured.

### Prompting rules

- Request JSON output and validate it with Zod. Never trust shape.
- Send the measured values into the prompt. Never ask the model to determine a fact.
- Use a smaller, cheaper model for openers — the volume is high and the task is not hard.
- Every opener must cite the finding it drew from (Spec §20.2 rule 6). If the prompt cannot name
  a finding, no opener is generated.

---

## 5. Build Order

Phase 0 runs in parallel with Phases 1–4. Only Phase 5 depends on its results.

### Phase 1 — Data model

- Drizzle schema: records, identity_keys, field metadata, exclusions, suppression hashes,
  outcomes, runs, provider_calls
- Normalisation functions in `core` (domain, phone, name, location)
- Identity key construction and rank assignment
- Merge, **late merge (Spec §4.5)**, and conflict logic
- Exclusion matching against the full key set; suppression hash matching
- **Unit tests for `core`** — this is the one place tests are non-negotiable, because identity
  errors corrupt the dataset silently and are expensive to unwind later
- Import the Phase 0 research rows as seed data

*Done when:* the 40 Phase 0 brands load without duplicates, a re-import produces zero new
records, and the adversarial fixtures in Spec §17 resolve as specified — including the two known
duplicates merging and the changed-owner domain **not** merging.

### Phase 2 — Platform shell

- Supabase Auth, Admin/Member roles, RLS policies (§3.7)
- Record list with tier filter, service filter, search
- Record detail view per Spec §20
- Record create/edit form for manual entry
- Claim and release
- CSV export
- Manual review as a saved filter, not a separate subsystem

*Done when:* the team can work entirely from the tool using manually entered data, and a Member
account provably cannot read or write what Spec §12.3 forbids.

### Phase 3 — Discovery and free signals

- Trigger.dev job scaffolding, run records, cost ceiling per run
- Store Leads or BuiltWith adapter (primary), with `supported_pushdown_filters` declared
- Meta Ad Library adapter — **verify commercial-ad API coverage first** (§10)
- First-party site crawler under the §9 crawl policy — social links, contact details
- **Class A audit checks** (`audit-test-catalogue-v0.1.md` §2) emitted by the crawler, plus
  PageSpeed Insights
- Consolidation job wiring into `core`

*Done when:* a search brief returns deduplicated records with provenance attached and a
`problem_free` score on every one.

The class A checks live here, not in Phase 5, because the Phase 4 spend gate depends on them.
Building them later would mean shipping enrichment with no cost control — the exact thing the
budget cannot absorb.

### Phase 4 — Enrichment, validation, and the gate

- **Stage 2.5 gate** using `problem_free` (Spec §6)
- Provider call ledger and idempotency check before every paid call (§3.5)
- Enrichment provider adapter
- Technographic detection
- Email validation adapter
- Phone validation adapter
- Partial-failure handling: completed fields persist, failed stage is visible
- Exclusion and suppression matching confirmed to run *before* any paid call

*Done when:* a record can be opened and used for outreach without manual web research, a
deliberately retried run purchases nothing twice, and measured cost per enriched record is
inside the Spec §8.2.3 ceilings.

### Phase 5 — Remaining audit and scoring

**Read the Phase 0 RESULTS sheet before starting this phase.**

Build class B and R checks in proportion to what produced replies, per
`audit-test-catalogue-v0.1.md` §5.3. Class A checks are already built and are not scoped by
Phase 0 — they cost nothing and they gate spend.

- Playwright service on Railway (class R checks)
- Class B checks: SERP, Places, social reads, ad library
- Scoring model per `scoring-model-v0.1.md`, versioned, with visible supporting signals
- Service routing with displayed reason
- Openers

*Done when:* every finding carries evidence, and every score shows the signals behind it.

### Phase 6 — Feedback

- Outcome logging per channel, including the opener's finding domain
- Attribution back to source, filter set, signals, score, route
- Calibration dashboard

### Phase 7 — Expansion

Second vertical, only after the first meets its quality and conversion gates. Budget for a
**discovery rebuild**: e-commerce indexes do not cover travel businesses, so Stage 1 sources are
replaced rather than reconfigured (Spec §17 Phase 7). Enrichment, audit, and scoring transfer.

---

## 6. Scope Reductions for v1

The specification is written for a team. These reductions keep it buildable by one person
without weakening anything structural.

| Spec feature | v1 approach |
|---|---|
| Full audit log (view/edit/export/delete) | Log outcomes, exclusion changes, merges, and overrides only |
| Manual review queue | Saved filter view, not a separate system |
| Claim takeover flow | Claim and release only; Admin can force-release |
| Google Sheets export | CSV only |
| Openers on all four channels | Call and IG DM only |
| Score versioning UI | Store version as a column; no UI |
| Automatic un-merge | Pre-merge snapshot stored; reversal is a manual Admin operation |
| Circuit breaker (Spec §16) | Per-provider halt on `PROVIDER_QUOTA_EXHAUSTED` / `PROVIDER_AUTH_FAILED`, plus Trigger.dev retry and a `dead_letter` table for `PROVIDER_SCHEMA_INVALID`. **Declared, not dropped** |
| Residential proxy pool | Not in v1 — revisit if the §9 block rate exceeds 15% |

The provider cost ledger is **no longer a reduction**: §3.5's idempotency ledger is required for
correctness anyway, and it yields real cost figures as a side effect.

### Not reducible

These five are expensive to retrofit and must be correct from the first commit:

1. **Field-level provenance** (Spec §7.3)
2. **Identity key hierarchy and the keys table** (Spec §4)
3. **Exclusion and suppression matching before paid enrichment** (Spec §6 Stage 2)
4. **The provider call ledger and idempotency check** (Spec §16.2)
5. **Zod validation on every external response**

The first three cannot be added later without reprocessing the entire dataset. The fourth
cannot be added later at all in any meaningful sense — money already spent twice is not
recoverable, and without the ledger you cannot even tell that it happened. The fifth prevents
malformed provider data from entering the database in the first place, and provider response
shapes change without notice.

---

## 7. Testing

`packages/core` unit tests remain the non-negotiable core. Two additions:

**Provider fixture tests.** Every adapter ships recorded real responses in
`packages/providers/__fixtures__/<provider>/<endpoint>.json`, and a test asserts the Zod schema
parses each one. When a provider changes shape, re-recording produces a visible diff in git
rather than a silent failure in production. The guide already names "provider changes response
shape" as a recurring failure mode; a schema with no fixture is a schema nobody has checked.

**The acceptance fixture set.** Spec §17 defines it: the 40 Phase 0 businesses plus 10
adversarial records — two known duplicates, a changed-owner domain, a shared phone, two
social-only businesses, a crawl-blocked site, a suppressed record, an excluded record, and a
record with every field unknown. Run before each release. It is the only test that exercises
identity, gating, and display honesty together.

---

## 8. First Week

1. Create the Supabase project and the repository
2. Write the Drizzle schema for `records` and `identity_keys`
3. Write and test the normalisation functions in `core` — domain, phone, name, location
4. Write the identity key construction and rank assignment, with unit tests
5. Write the merge and **late-merge** functions in `core`, with unit tests covering the
   changed-owner-domain case
6. Begin Phase 0 research in parallel — the rows become Phase 1 seed data, and the opener
   domains must be assigned deliberately per `audit-test-catalogue-v0.1.md` §5.3

Normalisation and identity resolution first, before any UI. Everything downstream depends on
them being right, and they are the hardest part to change later.

---

## 9. Crawl Policy

Spec §8.1 makes the business website the preferred source for nearly every field, so first-party
crawling is load-bearing rather than incidental — and the class A checks that gate all spend are
built entirely from it. Neither document previously said how it behaves.

| Rule | Setting |
|---|---|
| User-Agent | Descriptive, identifying AT360, with a contact URL. Never a spoofed browser string |
| robots.txt | Fetched first and respected. A `Disallow: /` is recorded as finding S1 and crawling stops there |
| Concurrency | One request in flight per host |
| Delay | Minimum 2s between requests to the same host |
| Page budget | 10 pages and 30 seconds per record, whichever comes first |
| Request timeout | 15s |
| Authentication | Never crawl behind a login |
| Forms | Never submitted, except check E6 using an AT360-controlled address |
| Payments | Rendered checkout checks traverse to the payment step and stop |

**Blocked is not passed.** A Cloudflare challenge, a 403, a CAPTCHA, or a timeout produces
`FETCH_BLOCKED`, and every check that depended on that fetch returns `unavailable`. Recording an
unread site as a site with no problems would corrupt `problem_free`, which decides where money
goes.

**Track the block rate** as an operational metric (Spec §11.3, class A check availability rate).
Railway datacentre IPs will be challenged by some hosts. If the block rate exceeds 15%, the fix
is a residential proxy pool — which is a real cost line not currently in the Spec §8.2 envelope,
so it needs a budget decision rather than a quiet addition.

---

## 10. Verify Before You Build

Three assumptions in these documents are load-bearing and unverified. Each is cheap to check and
expensive to discover late.

| Assumption | Why it matters | When to check |
|---|---|---|
| **Meta Ad Library serves commercial ads for US apparel via API** | N1 and N2 are 40 of 100 Intent points. If the API does not cover commercial ads for this ICP, the 40-point High threshold becomes unreachable for most records and the Intent model needs rebuilding. The alternative — scraping — is a terms problem, not an engineering one | Before Phase 3 |
| **Discovery index pricing is subscription, not per-record** | At ~3,700 discovered records/month, per-record discovery pricing consumes the entire budget on its own (Spec §8.2.3) | §18 item 8 test |
| **PageSpeed Insights free quota covers ~3,700 records/month** | Every class A speed signal (W5, W6, W7, W9) depends on it. If the quota is short, the gate loses its strongest signals or acquires a cost | Before Phase 3 |

---

## 11. Recurring Failure Modes

| Failure | Prevention |
|---|---|
| Pipeline written into Next.js API routes | Routes enqueue only; all work in Trigger.dev |
| Provider changes response shape, bad data enters silently | Zod on every response, plus recorded fixtures (§7) |
| Zero results indistinguishable from a broken collector | Adapters report `attempted`, `succeeded`, `returned_count` separately |
| Blocked crawl scored as a healthy site | `FETCH_BLOCKED` → dependent checks `unavailable`, excluded from both score sums |
| Enrichment spend on already-known businesses | Exclusion and suppression matching at Stage 2, before any paid call |
| Enrichment spend on records that were never worth it | Stage 2.5 free-signal gate |
| Retried job buys the same data twice | Idempotency check against the provider call ledger (§3.5) |
| Duplicate records accumulate | Unique constraint on `(key_type, key_value)` at the database level |
| Unique constraint violation crashes discovery | Catch `23505` and run the late-merge test (§3.4) — never pre-check |
| Wrong merge destroys two records | Auto-merge only on rank 1–2 keys; everything else to review; pre-merge snapshot always stored |
| Scoring cannot be calibrated | Scores computed in code, versioned, never by AI; raw signals stored, not just scores |
| Audit checks built for findings nobody responds to | Class B and R checks gated on Phase 0 results; class A built regardless |
| Runs cost more than expected | Per-run record cap and spend ceiling enforced at Stage 0; ledger reconciled against §8.2.3 ceilings |
| Retention rules exist only on paper | `terms_classification` + `next_refresh_at` + the nightly refresh job (§3.6) |
| A forgotten role check exposes data | RLS on, service role confined to jobs (§3.7) |
