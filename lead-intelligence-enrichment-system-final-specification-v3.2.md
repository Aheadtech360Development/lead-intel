> # ⚠ SUPERSEDED — DO NOT BUILD FROM THIS
>
> This document describes a system for finding **US DTC e-commerce brands** starting from a
> domain index. That was a misunderstanding of the requirement, corrected on 13 August 2026.
>
> The actual system searches **local businesses by niche + location + radius** from maps.
> Store Leads, BuiltWith, Apollo, revenue-band filtering and all e-commerce checks do not apply.
>
> **Current specification: `local-lead-intelligence-specification-v4.0.md`**
>
> Kept for history only — the identity resolution, provenance and gating reasoning in §4, §7 and
> §8.2 carried forward into v4.0.

---

# Lead Intelligence & Enrichment System

## Final Specification — v3.2

**Owner:** Ikrash Ovais, CEO — AheadTech360
**Status:** Final specification for implementation
**Date:** 13 August 2026
**Supersedes:** v3.1 (12 August 2026)
**Primary market:** US-based DTC fashion and apparel brands
**Initial revenue range:** $500K–$10M, estimated where necessary
**Second vertical:** Travel, after validation of the first vertical
**Companion documents:** `scoring-model-v0.1.md`, `audit-test-catalogue-v0.1.md`, `development-build-guide.md`

---

## 0. Changes from v3.1

v3.1 was structurally sound but definitional gaps made several sections unimplementable as
written — the scoring model had no weights or thresholds, the audit had no test list, the ICP
revenue filter had no estimation method, and the merge rules did not cover the case that breaks
the database constraint. v3.2 closes those gaps. No structural decision from v3.1 is reversed.

**New sections**

| Section | What it adds | Gap it closes |
|---|---|---|
| §4.5 | Late merge — two existing records proven to be one | §4.3 covered only new-data-matches-existing; the uncovered case violates the `identity_keys` unique constraint at insert |
| §5.5 | Filter push-down table | §5.1 listed filters that cannot exist at discovery time; unstated push-down means paying full fetch price to discard records |
| §6 Stage 2.5 | Free-signal pre-score gate before paid enrichment | Makes §14's "tiered enrichment" concrete; required by the budget in §8.2 |
| §8.2 | Cost model with per-unit ceilings | §15.2 lists cost per enriched record as a success metric with no model to produce it |
| §13.1 | Deletion vs. suppression | Direct conflict between §13 (must support deletion) and §12.1 (retain excluded records forever) |
| §16.2 | Interface contracts and error taxonomy | Only `ProviderResult` existed; no search brief, run object, job payload, read model, or error codes |
| §20 | Record detail view | §1.1 makes this screen the entire product promise; nothing specified it |

**Amended sections**

| Section | Change |
|---|---|
| §3.3, §18 #11 | Revenue estimation cascade defined. Without it the $500K–$10M ICP filter was unimplementable |
| §4.1 | Instagram key downgraded and given a re-verification rule — stable IG account IDs are not obtainable without Graph API access to the account, and handles are mutable |
| §4.4 | `social_only_ig` now routes to a single service, resolving the conflict with §10.3's "exactly one route" from a six-item list |
| §10 | Now references `scoring-model-v0.1.md` rather than describing a model that did not exist |
| §13 | Provider caching limits stated as an explicit rule rather than left to documentation |
| §14 | Reputation refresh fixed at 30 days; the 30–90 day range could exceed source caching terms |
| §18 | Items 5 and 6 answered; every remaining item given a proposed default so it becomes approve/reject |
| §19 | "Qualified lead" redefined from an activity metric to a supply-side one — the old definition could not size discovery volume and could be satisfied by contacting junk |

---

## 1. Executive Summary

The Lead Intelligence & Enrichment System is AheadTech360's internal platform for discovering,
consolidating, enriching, auditing, scoring, and preparing prospective businesses for human
outreach.

The system must produce **enrichment-grade business intelligence records** comparable to those
of established B2B data platforms, not merely scraped lead lists. It combines:

- Company and decision-maker enrichment.
- Small-business and local-business discovery.
- E-commerce platform and technology intelligence.
- Website, SEO, conversion, social, advertising, and reputation audits.
- Contact validation and field-level confidence.
- Problem and Intent scoring.
- Service routing and outreach preparation.
- Human outcome feedback for score calibration.

The system does not send outreach, replace a CRM, or make the final decision about whom the
team contacts.

### 1.1 Core outcome

When an operator opens a record, they should have enough verified and clearly labelled
information to personalise a call, Instagram DM, email, or LinkedIn message without repeating
the research manually. §20 specifies the screen that delivers this.

### 1.2 Non-negotiable principles

1. One business must have one canonical record.
2. Every important field must have a source, confidence status, and last-verified timestamp.
3. Verified links are preferred over name-based guesses.
4. Missing data is shown as `Unknown`, `Not found`, or `Not yet validated`; it is never
   silently excluded or fabricated.
5. Every matched record remains available; scoring changes priority, not eligibility.
6. External data providers are replaceable and are never treated as the sole source of truth.
7. The system surfaces evidence. It does not invent audit findings.
8. Human outreach remains outside the platform.

---

## 2. Scope

### 2.1 In scope

- Structured search briefs with optional natural-language instructions.
- Discovery from e-commerce indexes, directories, advertising libraries, search, social, and
  business-profile sources.
- Identity resolution, deduplication, key migration, late merge, and conflict logging.
- Apollo-like company and decision-maker enrichment through pluggable providers.
- Supplementary directory cross-checking for businesses with a local or offline footprint.
- Technographic detection for platforms, apps, analytics, checkout, CRM, and marketing tools.
- Website, search visibility, conversion, social, advertising, and reputation audits.
- Email and phone validation.
- Problem score, Intent score, tier, and one primary service route.
- In-platform record management, claiming, filtering, review queues, and export.
- Exclusion matching against existing clients, referral records, trackers, and do-not-contact
  records; and suppression of subject-request identifiers.
- Outreach outcome logging and score/discovery calibration.
- Role-based access, audit logs, retention controls, and provider-cost tracking.

### 2.2 Out of scope

- Sending email, calls, SMS, DMs, or LinkedIn messages.
- Outreach sequencing or automated engagement.
- CRM pipeline, quoting, invoicing, contracts, or deal management.
- Public access or multi-tenant customer accounts.
- Continuous monitoring; runs are on demand or explicitly scheduled.
- Automated legal/compliance decisions.
- Purchasing consumer personal data, or using data obtained from non-public, breached, or
  unauthorised sources.

Licensed B2B professional data from compliant enrichment providers **is permitted** and is a
planned input (§8). The exclusion above applies to consumer data, telecom or identity records,
and any source that cannot demonstrate a lawful basis for redistribution. §3.2 further
restricts decision-maker phone numbers: personal numbers are collected only where
self-published (§18 item 12).

---

## 3. Target Data Standard

Every enriched record is considered complete only when it contains, or explicitly marks
unavailable, the following categories:

### 3.1 Company profile

- Display name and normalised name.
- Legal name where available.
- Website, domain, and website status.
- Description, industry, sub-category, and business model.
- Address, city, state, country, ZIP, and operating locations.
- Founded year or business age where available.
- Estimated revenue band and confidence (method per §3.3.1).
- Employee range and confidence.
- Business status: active, closed, relocated, or unknown.

### 3.2 Decision-maker profile

- Name, title, seniority, and department.
- LinkedIn profile where available.
- Public personal Instagram only where identity is confidently established.
- Work email, status, and confidence.
- Public business phone, validity, line type, and confidence.
- Source and last verification date for every field.

Personal Instagram is optional and non-blocking. A name-based match must never be presented as
verified.

### 3.3 Firmographic data

- Revenue estimate, **band**, method, and confidence (§3.3.1).
- Employee estimate and method.
- Industry and sub-category.
- Geography and location count.
- Business model.
- Hiring, expansion, funding, rebrand, or other growth signals.
- Parent company or brand group where available.

#### 3.3.1 Revenue estimation method — *new in v3.2*

The ICP is defined by revenue ($500K–$10M), so this method is load-bearing: without it the
primary targeting filter cannot be applied at all. Private DTC brands do not publish revenue,
so every value here is a **proxy**, and the specification treats it as one.

**Revenue is always stored as a band, never a point value.** Bands: `<500K`, `500K–1M`,
`1M–3M`, `3M–5M`, `5M–10M`, `>10M`, `unknown`.

Cascade — the first method that yields a value wins, and the method used is stored on the field:

| Order | Method | `revenue_method` | Confidence |
|---:|---|---|---|
| 1 | Estimated sales figure supplied by the e-commerce discovery index | `index_estimate` | `unconfirmed` |
| 2 | Employee count × revenue-per-employee benchmark for apparel retail | `employee_proxy` | `low` |
| 3 | Catalogue size × assumed AOV band × assumed annual turn | `catalogue_proxy` | `low` |
| 4 | None available | `none` | `unknown` |

Rules:

- A revenue band is **never displayed as a precise figure** and is always shown with its method
  and confidence.
- Revenue **never hard-excludes a record from discovery or from a view**. It sorts and filters
  a working view only, consistent with §5.2. `unknown` remains visible and labelled.
- The benchmark constants for methods 2 and 3 are configuration, not code, and are versioned so
  a benchmark change is traceable on any record that used it.
- No provider revenue figure is ever promoted to `verified`. Only a first-party published
  figure could be, and DTC brands in this range do not publish one.

### 3.4 Technographic data

- E-commerce platform.
- CMS and hosting.
- Analytics and tag-management tools.
- Payment and checkout tools.
- Email marketing platform.
- CRM and customer-support tools.
- Reviews, chat, booking, loyalty, and subscription tools.
- Detected technology date and confidence.

### 3.5 Public presence and reputation

- Brand social URLs for Instagram, Facebook, LinkedIn Page, TikTok, Pinterest, YouTube, and X.
- Last activity date per channel.
- Meta Ad Library activity where available.
- Google Business Profile/Place ID where applicable.
- Review count, rating, owner-response data, and derived theme summary.
- Raw third-party review text is not retained where the source terms prohibit it.

---

## 4. Identity Resolution

### 4.1 Canonical identity hierarchy

| Rank | Key | Use | Confidence | Stability |
|---|---|---|---|---|
| 1 | Normalised live domain | Website exists and resolves | Highest | Stable; reassignable on sale (§4.5.4) |
| 2 | Google Place ID | Business is listed on Google | High | Stable |
| 3 | Phone + normalised name | Phone is available | Moderate | Moderate |
| 4 | Facebook Page ID | Social-only business | Moderate | Stable |
| 4b | Instagram account ID, else handle | Social-only business | Moderate / **Low for handle** | **Mutable — see below** |
| 5 | Normalised name + location hash | No stronger key exists | Low; manual review | Low |

All available keys are stored together on the canonical record. The internal `record_id` is
immutable.

**Instagram key rule — *amended in v3.2*.** Stable numeric Instagram account IDs are generally
obtainable only through Graph API access to an account you manage, which does not apply to
prospects. In practice the system will hold a **handle**, and handles are renameable and
reassignable — a handle key can silently begin pointing at a different business.

Therefore:

- `ig_account_id` is stored only when genuinely obtained, and only then does the key carry
  rank 4 confidence.
- A handle-only key is stored as `ig_handle` at **rank 4b with `low` confidence** and can never
  by itself establish identity for a record that has any rank 1–4 key.
- On every refresh, a handle key is re-verified against display name and bio link. Any mismatch
  **detaches the key** and raises manual review (§11.2); it does not silently re-point.

### 4.2 Normalisation

- Domain: remove protocol, `www`, trailing slash, tracking parameters, and resolve redirects.
- Phone: convert to E.164 where possible; store country and line type.
- Name: lowercase, remove punctuation and non-distinctive legal/category suffixes.
- Location: standardise country/state/city and create a rounded-coordinate location hash.
- Social URLs: canonicalise usernames, remove tracking parameters, and retain platform IDs
  where available.

### 4.3 Merge rules

Covers the case where **incoming data matches an existing record**. For the case where two
existing records prove to be one business, see §4.5.

- A matching canonical key updates the existing record; it does not create a new record.
- A phone number alone never merges records.
- One phone attached to more than three distinct names creates a manual-review queue.
- Conflicting fields are retained with provenance; the selected value follows the source
  precedence matrix (§8.1).
- A new domain, Place ID, phone, or social ID is added to the existing record as a key
  migration event.
- A newly detected website increments Intent only when the domain is confirmed and functional.

### 4.4 Website status

| Status | Definition | Default route |
|---|---|---|
| `none` | No site found after required checks | Web development |
| `social_only_fb` | Facebook presence, no confirmed site | Web development |
| `social_only_ig` | Instagram presence, no confirmed site | Web development |
| `parked_or_expired` | Domain resolves but no functional site | Web development |
| `live_unlisted` | Functional site absent from Maps/directories | SEO/local listings |
| `live_listed` | Functional site and listing found | Based on audit |
| `unconfirmed` | Evidence conflicts or checks are incomplete | Manual review |

`none` may be assigned only after the Google profile website field, Facebook website field, and
direct brand-name search all return no confirmed website.

*Amended in v3.2:* `social_only_ig` previously routed to "Web development + booking/commerce",
which is two routes and names a service not in §10.3's list of six. It now routes to Web
development. Where a booking or commerce need is evident, that is recorded as a **secondary
finding** on the record, not as a route.

### 4.5 Late merge — *new in v3.2*

§4.3 covers incoming data matching one existing record. It does not cover the case that
actually breaks the system: **two records that already exist are later proven to be the same
business.** A social-only record whose brand finally publishes a domain that another record
already holds is the common example.

This is not an edge case. With `unique(key_type, key_value)` on the keys table, it surfaces as
a constraint violation on insert, and without a defined resolution the pipeline either crashes
or — worse — swallows the error and drops the key.

#### 4.5.1 Detection

A late merge is triggered when writing key `K` to record `A` finds `K` already attached to
record `B`.

#### 4.5.2 Auto-merge conditions

Merge automatically **only** when all hold:

1. `K` is rank 1 (domain) or rank 2 (Place ID).
2. Neither record holds a *different* key of the same type.
3. Normalised names match above the similarity threshold, **or** location hashes are equal.

Any other case — a shared rank 3–5 key, a conflicting same-type key, or names and locations
that both disagree — goes to manual review as `potential_duplicate` (§11.2). **The system never
auto-merges on a weak key.** A wrong merge destroys two records and is far more expensive to
unwind than a duplicate is to resolve.

#### 4.5.3 Survivor and transfer

The survivor is **always the earlier-created record**. This is deterministic (required by the
build guide's rule that identity logic is pure code), and it preserves the longest provenance
chain and the most external references.

| Item on the losing record | Transfer rule |
|---|---|
| Identity keys | Move to survivor, preserving original `added_at`, tagged `migrated_from` |
| Field values | Merged by source precedence (§8.1). Conflicts logged with provenance, never silently overwritten |
| Claims | If both claimed by different users, the earlier claim survives and the other user is notified; the conflict is logged. If only one, it transfers |
| Outcome log | All entries transfer, each retaining `original_record_id` so history stays auditable |
| Exclusion flag | **OR of both.** Exclusion always wins a merge |
| Suppression | OR of both. Suppression always wins |
| Manual review status | If either was pending, the survivor is pending |
| `enrichment_cost` | Summed, so cost accounting stays honest |
| Scores | Discarded and recomputed. Scores are never merged |

#### 4.5.4 Tombstones and key reassignment

The losing record is **never deleted**. It becomes `status = merged` with `merged_into` set,
and any lookup by its `record_id` resolves to the survivor, so existing exports and external
references do not break.

Every merge stores a **full pre-merge snapshot of both records**. Automatic un-merge is out of
scope for v1, but an incorrect merge must be manually reversible by an Admin, and that is
impossible without the snapshot.

**Key reassignment** is the opposite case and must not be mistaken for a merge: a domain or
handle now belongs to a *different* business. Indicators are a live site whose name, content,
and social identity all contradict the stored record. On detection the system detaches the key
from the old record, sets that record's `business_status` to `unknown`, attaches the key to the
new record, logs a `key_reassignment` event, and raises manual review. It does not merge.

---

## 5. Search Input

### 5.1 Discovery-time filters

- Industry.
- Sub-category.
- Geography.
- Platform.
- Business model.
- Brand-name pattern.
- Source selection.
- Maximum records and cost ceiling.

*Amended in v3.2:* "Ad activity" and "Problem-type flags" have moved to §5.2. Problem type
cannot be known before the audit runs, and ad activity is a discovery filter only when the run
originates from an advertising library. Leaving them here implied a filter the system cannot
apply, which meant paying to fetch records that were always going to be discarded.

### 5.2 Post-enrichment filters

- Estimated revenue band.
- Employee count.
- Technology stack.
- Review volume/rating.
- Website status.
- Problem score and Intent score.
- **Problem-type flags** (moved from §5.1).
- **Ad activity**, except where the run originates from an ad library (moved from §5.1).
- Decision-maker availability.
- Contact validation status.

Revenue and employee count must not silently gate discovery when they are unavailable. Unknown
values remain visible and are labelled accordingly.

### 5.3 Open text

Natural-language instructions supplement structured fields. The parser must produce a visible
resolved filter object before the run starts. The operator must confirm the filter set and
estimated source/cost impact.

### 5.4 Saved searches

Operators can save, rename, duplicate, edit, and archive searches. Every resulting record
stores the originating resolved filter set and run ID.

### 5.5 Filter push-down — *new in v3.2*

Every filter is either **pushed down** into the provider query or **applied locally** after the
fetch. The distinction is a cost decision, not an implementation detail: *a locally applied
filter is paid for at full fetch price on every record it discards.*

| Filter | Applied | Notes |
|---|---|---|
| Industry | Push-down | Core capability of e-commerce indexes |
| Sub-category | Push-down where supported, else local | Falls back per adapter capability |
| Geography | Push-down | |
| Platform | Push-down | Primary strength of the discovery index |
| Business model | Local | Derived from catalogue and site structure |
| Brand-name pattern | Local | |
| Revenue band | Local, post-enrichment | Proxy method (§3.3.1); never a discovery filter |
| Employee count | Local, post-enrichment | |
| Technology stack | Push-down where the index supports it, else local at Stage 3 | |
| Website status | Local, Stage 2.5 | |
| Problem / Intent score | Local, Stage 6 | |
| Problem-type flags | Local, Stage 2.5 for class A flags, Stage 5 otherwise | |
| Ad activity | Push-down **only** when the ad library is the originating source; else local at Stage 5 | |
| Review volume / rating | Local, Stage 5 | |
| Contact validation status | Local, Stage 4 | |

**Run-planner requirement.** Stage 0 must display, before the operator confirms:
expected fetch count, expected count surviving local filters, and the cost of the difference.
A brief whose local filters discard most of what it fetches is a brief that should be rewritten,
and the operator can only know that if the planner shows it.

Each provider adapter declares its supported push-down filters. The planner uses that
declaration; it never assumes a filter is supported.

---

## 6. Pipeline

### Stage 0 — Run planning

Validate required fields, resolve natural language, estimate source calls and cost, apply the
selected limits, show the push-down/local split and its cost implication (§5.5), and request
operator confirmation.

### Stage 1 — Discovery

Query enabled sources in parallel. Capture source, source record ID, name, URL/domain, contact
methods, location, platform, collection time, and run ID.

### Stage 2 — Consolidation and exclusion

Resolve identity, merge duplicates, handle late merges (§4.5), log conflicts, and match the
full key set against the exclusion and suppression lists **before any paid enrichment**.

### Stage 2.5 — Free-signal audit and enrichment gate — *new in v3.2*

Run the class A audit checks (`audit-test-catalogue-v0.1.md` §2) — own crawl, HTML parse, and
PageSpeed Insights. These carry no per-record cost. Compute `problem_free`
(`scoring-model-v0.1.md` §1.1) and compare it to the run's `gate_min_problem_free`.

- **Pass** → continue to Stage 3.
- **Hard override** (§4.4 statuses `none`, `parked_or_expired`, `social_only_*`) → always pass.
- **Fail** → set `enrichment_status = gated` and continue to Stage 8. The record stays visible,
  stays exportable, and can be enriched on demand by an operator.

This stage is what makes §14's tiered enrichment real. Without it the cost model in §8.2 does
not close. Gated is a spend decision, not a quality verdict, and it is never a deletion.

### Stage 3 — Enrichment

Enrich company, decision-maker, firmographic, technographic, contact, social, advertising, and
reputation fields through approved providers and first-party sources. Runs only for records
that passed Stage 2.5.

### Stage 4 — Validation

Validate email deliverability, phone validity and line type, domain status, URL resolution, and
identity confidence. Deferred validation must be distinct from `not found`.

### Stage 5 — Remaining audit

Run the class B and class R checks (metered APIs and rendered Playwright checks). Produce three
to five evidence-backed findings where data supports them. Class A results from Stage 2.5 are
reused, not re-measured.

### Stage 6 — Scoring and routing

Calculate `problem_full`, Intent score, priority tier, and exactly one primary service route
per `scoring-model-v0.1.md`. Scores must show their supporting signals.

### Stage 7 — Human review

Route low-confidence identities, source conflicts, no-website uncertainty, unusual phone
sharing, potential duplicates from late merge, key reassignments, and high-impact findings to a
review queue.

### Stage 8 — Output

Show the record in-platform (§20), allow claiming and filtering, generate channel-specific
openers, and support CSV export.

### Stage 9 — Feedback

Log outreach outcomes and attribute them to source, search, signals, score, service route, and
channel for calibration.

---

## 7. Data Model

### 7.1 Core record

- `record_id`, `status`, `created_at`, `updated_at`.
- `display_name`, `name_normalised`, `legal_name`.
- `domain`, `website_url`, `website_status`.
- `place_id`, `phone_e164`, `fb_page_id`, `ig_account_id`, `ig_handle`.
- `identity_rank`, `identity_confidence`, `location_hash`.
- `business_status`, `exclusion_flag`, `manual_review_status`.
- `merged_into`, `merged_at` — null unless `status = merged` (§4.5.4).

Identity keys are additionally stored in their own table so that a lookup by *any* key is one
indexed query and one-business-one-record is enforced by the database. See Build Guide §3.

### 7.2 Enrichment fields

- Company profile fields listed in §3.
- Decision-maker fields listed in §3.
- Firmographic and technographic fields listed in §3.
- Provider record IDs and provider names.
- `enrichment_status` — one of `pending`, `gated`, `partial`, `complete`, `failed`.
- `enrichment_attempted_at`, `enrichment_cost`.

### 7.3 Field metadata

Every externally sourced field must support:

```text
value
source_name
source_record_id
source_type
confidence
verification_status
is_public
first_seen_at
last_verified_at
next_refresh_at
terms_classification
```

`terms_classification` must identify whether the field is first-party, provider-supplied,
API-restricted, derived, or temporary-display-only. It is the mechanism that enforces §13's
retention rules (see Build Guide §3).

### 7.4 Audit and scoring

- Findings array: signal ID, finding text, measured value, evidence URL/source, severity,
  outcome (one of the five in §9), audit timestamp, catalogue version.
- `problem_free`, `problem_full`, Intent score, tier, `score_version`, `audit_version`, score
  signal array.
- Routed service, routing reason, routing confidence, and the finding that caused the route.
- Suggested call and Instagram openers (email and LinkedIn deferred per Build Guide §6).

**Raw signal values are stored, not only the scores.** Recalibration (§15) recomputes old
records under a new model version, and that is only possible if the inputs survive. Storing
scores alone would make every weight change require re-running paid collection.

### 7.5 Ownership and outcomes

- `claimed_by`, `claimed_at`, `claim_status`, `claim_release_at`.
- Outcome log: channel, outcome, timestamp, user, notes, meeting date where applicable,
  `original_record_id` where transferred by a merge.
- User activity log for view, edit, export, claim, exclusion, and deletion actions.

---

## 8. Providers and Sources

External providers are pluggable. Store Leads/BuiltWith or comparable e-commerce indexes are
the primary discovery source for the DTC target market; Apollo or a comparable provider may
supply company and contact enrichment; directory sources such as Manta may supplement discovery
for businesses with a local or offline footprint; Meta Ad Library may provide advertising
activity; Google Places may provide Place IDs and location/reputation context; first-party
websites remain the preferred source for published business contact and social links.

Apollo-style enrichment must not be hard-coded as the only path. Provider usage must record
provider, endpoint or product, timestamp, returned fields, credits/cost, and terms
classification. Enrichment API usage consumes credits at rates that vary by endpoint and plan,
so the system must support budget controls and provider fallback.

Directory data is treated as discovery and cross-check input, never automatically as final
truth — listings are frequently self-submitted and go stale without correction. Directory
values must be compared against first-party or approved authoritative sources before display as
verified.

### 8.1 Source precedence

| Field | Preferred source | Fallback |
|---|---|---|
| Website/social link | Business website | Verified business profile, approved directory |
| Company description | Business website | E-commerce index/provider |
| Decision-maker role | Official company page/public profile | Enrichment provider |
| Work email | First-party published email or approved provider | Pattern discovery plus validation |
| Phone | Business website | Approved directory/provider |
| Platform/tech | Direct detection | Store Leads/BuiltWith/Wappalyzer |
| Address | First-party website | Approved directory; temporary API display where restricted |
| Place ID | Google Places | None |
| Reviews | Live API fetch for display/scoring | Approved directory snapshot where permitted |
| Revenue band | None — always a proxy (§3.3.1) | Index estimate, then employee proxy, then catalogue proxy |

Conflicts must be logged and never silently overwritten.

### 8.2 Cost model — *new in v3.2*

§15.2 lists cost per enriched record as a success metric. This is the model that produces it,
and the constraint that sizes the pipeline.

#### 8.2.1 Volume derivation

From the approved target of 50–100 qualified leads per week (§18 item 5), taking 75 as the
planning midpoint and the §19 definition of qualified:

| Quantity | Value | Basis |
|---|---:|---|
| Qualified leads / month | 325 | 75/week × 4.33 |
| Enriched records / month | ~1,100 | Assumed 30% of enriched records reach qualified |
| Discovered records / month | ~3,700 | Assumed 30% Stage 2.5 gate pass rate |
| Class B audits / month | ~1,100 | Runs on gate-passers only |

The two 30% assumptions are the model's soft spots. Both are measurable from the first month of
runs and must be replaced with observed rates rather than carried forward.

#### 8.2.2 Cost formula

```
run_cost =  N_discovered   × c_discovery
          + N_gate_passed  × (c_enrich + c_email_val)
          + N_phone_val    × c_phone_val
          + N_gate_passed  × (c_serp + c_places + c_adlib)

monthly_cost = fixed_subscriptions + Σ run_cost
cost_per_enriched_record = monthly_cost / N_gate_passed
```

Class A checks contribute nothing to this formula. That is the entire point of the Stage 2.5
gate: the 2,600 records per month that fail it cost only compute.

#### 8.2.3 Per-unit ceilings

**No price is asserted here.** Provider pricing changes and must be established during the
coverage-and-pricing test (§18 items 8 and 9). What this specification fixes is the *ceiling*
each unit cost must fall under for the approved $300–800/month envelope to hold.

Taking the upper envelope of $800/month, with fixed subscriptions capped at $400:

| Unit | Monthly volume | Ceiling | Ceiling per unit |
|---|---:|---:|---:|
| Fixed subscriptions (discovery index + enrichment plan) | — | $400 | — |
| Enrichment credits | 1,100 | $280 | **$0.25** |
| Email validation | 1,100 | $20 | **$0.018** |
| Phone validation | ~600 | $20 | **$0.033** |
| SERP lookups (S7, S8) | 1,100 | $25 | **$0.023** |
| Places Details (S9, S10, P2–P5, N9) | 1,100 | $30 | **$0.027** |
| Ad Library (N1, N2) | 1,100 | $25 | **$0.023** |
| **Total** | | **$800** | |

Column arithmetic: 400 + 280 + 20 + 20 + 25 + 30 + 25 = **800**. If any measured price exceeds
its ceiling, the shortfall is taken from `N_gate_passed` (§8.2.4), not from another line.

Subscribing to a discovery index rather than paying per discovered record is what makes this
close: 3,700 discovered records at any meaningful per-record price would consume the entire
envelope on its own. **Per-record discovery pricing is therefore a disqualifier at this
volume**, and should be treated as such in the §18 item 8 evaluation.

#### 8.2.4 The control lever

If measured prices exceed these ceilings, the adjustment is **raising
`gate_min_problem_free`**, which reduces `N_gate_passed`, not lowering the quality bar on
records that do pass. A smaller number of properly enriched records is the intended failure
mode; a larger number of thinly enriched ones is not.

Hard controls remain as in §14: per-run maximum records, per-run maximum spend, provider credit
limits. A run halts gracefully at its ceiling, preserving completed work (§16.2 error
`BUDGET_CEILING_REACHED`).

---

## 9. Auditing and Findings

Every finding must be measurable and reproducible. The complete test list, thresholds, and
finding text templates are in `audit-test-catalogue-v0.1.md`. Examples of the required form:

- `Mobile LCP measured at 8.4 seconds on the homepage.`
- `Brand-name search returns the official site below three directory results.`
- `Instagram last posted 14 months ago.`
- `Checkout requires five steps and has no visible guest checkout.`
- `Only 12 public reviews found and no owner response in the last 20 reviews.`

The system must distinguish:

- Test passed.
- Test failed.
- Test unavailable.
- Test not applicable.
- Test pending manual review.

A blocked or unreachable fetch is `unavailable`, never `passed`. Recording an unread site as a
site without problems is a silent corruption of every score derived from it.

Every `failed` finding must carry an evidence record (measured value, source URL or endpoint,
timestamp, catalogue version). A finding without evidence is downgraded to `pending_review` and
is not published.

No AI-generated statement may appear as a factual finding unless tied to a measured result or
source evidence.

---

## 10. Scoring and Routing

The model itself — signals, weights, thresholds, and routing precedence — is specified in
`scoring-model-v0.1.md` and versioned separately, because §15 requires each version to be
compared against the previous one and a spec revision per weight change is not workable.

This section states the requirements the model must satisfy.

### 10.1 Scores

Both scores use a documented versioned model from 0–100.

**Problem score** measures the severity and commercial relevance of verified deficiencies. It
exists in two forms: `problem_free` (class A signals only, computed at Stage 2.5 to gate spend)
and `problem_full` (all available signals, computed at Stage 6). Only `problem_full` is
displayed.

**Intent score** measures evidence that the business is currently investing in growth, such as
active advertising, fresh content, hiring, expansion, a new domain, or recent site changes.

Unknown signals contribute zero evidence; they must not be treated as negative evidence.
Mechanically, an unmeasured check is removed from both the numerator and the attainable
maximum.

Scoring is computed in code, is deterministic, and is never produced by a model whose output
can vary between identical runs.

### 10.2 Tiers

| Problem | Intent | Tier | Meaning |
|---|---|---:|---|
| High | High | 1 | Clear need and willingness to invest |
| Low | High | 2 | Active business needing a different angle |
| High | Low | 3 | Strong problem but weaker appetite |
| Low | Low | 4 | Lowest priority but still visible |

Thresholds for High/Low are set in `scoring-model-v0.1.md` §6.1.

The default working view shows Tiers 1–2. Tiers 3–4 remain one click away and are included in
every export.

### 10.3 Primary service route

Each record receives exactly one primary route, with optional secondary findings:

- Web development.
- SEO/local listings.
- CRO.
- Social media management.
- Email marketing.
- Marketing/reputation.

The route is derived from the same domain subscores that produce the Problem score, so score
and route can never disagree. Precedence and tie-breaks are in `scoring-model-v0.1.md` §6.3.

Routing must display the reason and the finding that caused it. A route whose winning domain
contains no evidence-backed finding is not published; the record goes to manual review instead.
The operator can override the route, and the override is logged.

---

## 11. Data Quality and Review

### 11.1 Status vocabulary

Use consistent values:

- `verified`.
- `unconfirmed`.
- `risky`.
- `invalid`.
- `not_found`.
- `not_yet_validated`.
- `unknown`.
- `not_applicable`.

### 11.2 Manual-review triggers

- Identity resolved only by name and location.
- Conflicting domain, phone, address, or social identity.
- Phone shared by more than three businesses.
- Website marked `none` without all required checks.
- Decision-maker identity inferred from name alone.
- High-value record with no verified contact.
- Provider conflict or stale data.
- Potential duplicate after key migration.
- **Late merge not meeting the auto-merge conditions** (§4.5.2).
- **Key reassignment detected** (§4.5.4).
- **Instagram handle re-verification mismatch** (§4.1).
- **Routing winner with no evidence-backed finding** (§10.3).

### 11.3 Quality metrics

Track precision of identity matches, duplicate rate, reachable email rate, reachable phone
rate, stale-field rate, manual-review resolution time, percentage of findings with evidence,
and **class A check availability rate** — the share of discovered records where the free crawl
actually succeeded. A falling availability rate means the gate is judging records it cannot see.

---

## 12. Exclusions, Claims, and Access

### 12.1 Exclusion list

Sources include current clients, past clients, Partner Circle records, cold-calling trackers,
and do-not-contact records held by AT360. Matching uses the complete identity key set. v1
supports CSV import/export; ClickUp sync is a later integration.

Excluded records are retained **in full** in a restricted area so the system can prevent
re-discovery and so an operator can see *why* a business is excluded. This is distinct from
suppression (§13.1), which retains identifiers only.

### 12.2 Claims

Any member can claim a record. Claims are visible to everyone, timestamped, and releasable
after a configurable stale period. A claimed record cannot be claimed by another user without
an explicit takeover action.

### 12.3 Roles

| Action | Admin | Member |
|---|---:|---:|
| Run search | Yes | Yes |
| View records | Yes | Yes |
| Claim/release own lead | Yes | Yes |
| Take over another claim | Yes | No (§18 item 3) |
| Export | Yes | Yes |
| Edit exclusion list | Yes | No |
| Add/remove users | Yes | No |
| Delete records | Yes | No |
| View audit logs | Yes | Limited |
| Change scoring model | Yes | No |
| Override route | Yes | Yes, logged |
| Override score or exclusion match | Yes | No |

MFA, per-user accounts, session timeout, encryption in transit/at rest, and administrative
audit logs are required for production.

---

## 13. Retention, Compliance, and Security

Retention periods, effective on approval of §18 item 7:

- Unclaimed/uncontacted records: re-verify after 90 days and archive after 180 days.
- Contacted records: retain while operationally relevant, then review after 12 months.
- Do-not-contact records: retain indefinitely as required to prevent re-contact, under §13.1.
- Audit and access logs: retain for at least 12 months.
- Raw restricted third-party content: do not retain beyond the source's permitted period.

**Provider caching limits are a data rule, not a documentation note.** Where a provider's terms
permit an identifier to be stored indefinitely but restrict the associated content to a short
caching window — the Google Places pattern, where the Place ID and the profile content are
treated differently — this is encoded in `terms_classification` on each field, and a scheduled
job refreshes or purges fields whose `next_refresh_at` has passed. **The exact permitted window
for each provider must be read from that provider's current terms during §18 items 8 and 9 and
recorded in the adapter**, not assumed from this document. §14's refresh intervals are upper
bounds that a stricter provider term overrides.

US calling, texting, and commercial email require compliance review before volume scales
(§18 item 15). The platform must not make legal eligibility decisions; it only stores relevant
validation and suppression signals.

Collection is limited to public or self-published professional information, with documented
lawful basis and jurisdiction-specific review.

### 13.1 Deletion requests vs. permanent suppression — *new in v3.2*

§13 requires supporting deletion. §12.1 requires excluded records to be retained so they are
never re-discovered. Taken literally these contradict each other, and the contradiction has to
be resolved in the data model rather than left to whoever handles the first request.

Resolution — **two distinct mechanisms**:

| | Exclusion (§12.1) | Suppression (§13.1) |
|---|---|---|
| Trigger | AT360 relationship — client, past client, referral, tracker | Subject request — deletion, do-not-contact, objection |
| Retained | Full record, restricted area | **Identifier hashes only** |
| Visible to operators | Yes, with reason | No — only "suppressed" |
| Purpose | Avoid wasting spend and avoid awkward outreach | Honour the request while never re-collecting |

On a suppression request the system:

1. Purges all field values, provenance rows, cached provider payloads, openers, findings, and
   outcome free-text for that record.
2. Retains **only** a salted one-way hash of each identity key, plus `suppressed_at`,
   `suppression_reason`, and the request record itself.
3. Checks every incoming discovery result against the hash table at Stage 2 — before storage
   and before any paid call.
4. Stores the salt in the secrets manager, never in the database. The hashes cannot be reversed
   and cannot repopulate a record.

This satisfies both requirements honestly: nothing about the person or business is retained,
and the business is still never contacted again.

The system must also support correction and access-restriction requests. Each request type
needs a named owner and a response deadline before production — currently unassigned.

---

## 14. Refresh and Cost Controls

| Data | Default refresh | Rule |
|---|---:|---|
| Place ID validity | 12 months | Refresh and handle invalid/not-found states |
| Website and tech stack | 90 days | Re-check sooner after a change signal |
| Email/phone validation | 90 days before outreach | Revalidate stale contacts |
| Social activity | 30–60 days | Store last activity date and source |
| Advertising activity | Per run or 30 days | Depends on provider cost |
| Reputation | **30 days** | Fixed by source caching terms, not by preference (§13) |
| Revenue/employee estimate | 180 days | Mark directional and confidence-rated |
| Instagram handle key | 30 days | Re-verify name and bio link; detach on mismatch (§4.1) |

*Amended in v3.2:* reputation was "30–90 days". The upper end could exceed a provider's
permitted caching window, which would make the longer setting non-compliant rather than merely
stale. Where terms and this table disagree, terms win.

Every run must support maximum records, maximum spend, provider credit limits, and tiered
enrichment (implemented as the Stage 2.5 gate). Exclusion and suppression matching occur before
paid enrichment. Partial failures must preserve completed fields and show the failed stage.

**Refresh is a scheduled job, not a manual task.** It is listed in the build order and the
repository structure; a retention rule that exists only in this table will not be executed.

---

## 15. Feedback Loop and Metrics

### 15.1 Outcome taxonomy

Per attempt, capture channel, timestamp, user, outcome, notes, optional meeting date, and
**the finding domain the opener led with** — without that column, outcomes cannot be attributed
to finding types and the scoring model cannot be calibrated:

- No answer.
- Reached — not interested.
- Reached — interested.
- Follow-up requested.
- Meeting booked.
- Closed/won.
- Closed/lost.
- Do not contact.
- Invalid contact.

### 15.2 Success metrics

- Qualified leads per week, per the §19 definition, against the target in §18 item 5.
- Contacted leads per week (the activity measure, tracked separately).
- Preparation time per lead.
- Contact reachability by channel.
- Conversion-to-meeting rate by channel, tier, and **finding domain**.
- Duplicate rate and late-merge rate.
- Identity precision.
- Finding evidence coverage.
- Class A check availability rate.
- Cost per enriched record, against the §8.2 ceilings.
- Cost per meeting.
- Exclusion-match accuracy.
- Stale-data rate.

Score and discovery models must be versioned. Recalibration begins only when the evidence
thresholds in `scoring-model-v0.1.md` §7 are met — roughly two to three months of operation at
the approved volume. The model standing unchanged before then is expected behaviour, not a
broken feedback loop.

---

## 16. Technical Architecture

- Relational database with immutable record IDs and structured key tables.
- Backend API and web frontend.
- Queue/job runner for on-demand discovery and enrichment.
- Provider adapter layer so Apollo, Manta, Store Leads, BuiltWith, validation providers, and
  future replacements are swappable.
- Source/provenance tables at field level.
- Manual-review queue.
- Cost and credit ledger per run/provider.
- Search/run history and saved-search tables.
- Audit log for user and system actions.
- Export service for CSV.
- Secrets manager for API credentials.
- Retry, timeout, and failure-isolation handling for provider calls, with a dead-letter path
  for responses that fail validation.
- Scheduled refresh and retention job.
- Monitoring that distinguishes zero results from a broken collector.

### 16.1 Minimum provider adapter contract

Each adapter must return:

```text
provider_name
provider_record_id
source_url
retrieved_at
fields
confidence
cost_or_credits
terms_classification
raw_response_retention_rule
```

Each adapter must additionally declare:

```text
supported_pushdown_filters   which §5.5 filters it can apply server-side
rate_limit                   requests per unit time
attempted / succeeded / returned_count   reported separately, never conflated
```

The core application must remain functional if any single provider is unavailable.

### 16.2 Interface contracts — *new in v3.2*

§16 listed components without contracts. These are the shapes that cross a boundary.

**Search brief** — what an operator submits and what a run stores:

```text
brief_id, name, created_by, created_at
filters_structured   the resolved §5.1 / §5.2 filter object
filters_natural      original open text, retained verbatim
resolved_by          parser version that produced filters_structured
sources_enabled      provider list
limits               { max_records, max_spend, gate_min_problem_free }
```

**Run** — one execution of a brief:

```text
run_id, brief_id, brief_snapshot, started_at, finished_at
status               planning | running | partial | complete | halted | failed
stage_status         per-stage: attempted, succeeded, failed, returned_count
counters             discovered, deduped, excluded, suppressed, gated, enriched, audited, scored
spend                { by_provider, total, ceiling, halted_at_ceiling }
errors               array of { code, provider, stage, record_id?, message }
```

`brief_snapshot` is stored because a brief can be edited after the run; without the snapshot,
outcome attribution (§15) points at filters that were never actually used.

**Stage job payload** — every inter-stage message:

```text
run_id, stage, record_ids[], attempt, idempotency_key
```

`idempotency_key` is `hash(run_id, stage, record_id, provider)`. Before any paid call the worker
checks the provider call ledger for this key. **A retried job must never re-purchase data it
already bought** — without this, the partial-failure handling §14 requires becomes a mechanism
for spending the budget twice.

**Record read model** — the shape the UI consumes, assembled server-side so the client never
joins provenance itself:

```text
identity     { record_id, display_name, domain, website_status, keys[], identity_confidence }
scores       { problem_full, intent, tier, route, routing_reason, routing_finding, score_version }
findings[]   { signal_id, text, measured_value, evidence_url, severity, outcome, audited_at }
contacts[]   { type, value, validation_status, confidence, source, last_verified_at }
company      { firmographics, technographics }  each field with §7.3 metadata
presence     { social[], ad_activity, reputation }
openers      { call, instagram }
ownership    { claimed_by, claimed_at, claim_status }
history[]    { outcomes, claims, merges, key_migrations }
flags        { exclusion, manual_review, gated }
```

**Error taxonomy:**

| Code | Retryable | Effect |
|---|:--:|---|
| `PROVIDER_TIMEOUT` | Yes | Backoff and retry |
| `PROVIDER_RATE_LIMITED` | Yes | Backoff per adapter `rate_limit` |
| `PROVIDER_QUOTA_EXHAUSTED` | No | Halt that provider for the run; other stages continue |
| `PROVIDER_AUTH_FAILED` | No | Halt run; alert |
| `PROVIDER_SCHEMA_INVALID` | No | Dead-letter the response; alert. **Never coerce or patch** |
| `FETCH_BLOCKED` | No | Check result is `unavailable`, never `passed` |
| `FETCH_NOT_FOUND` | No | Field is `not_found` |
| `BUDGET_CEILING_REACHED` | No | Halt run gracefully; completed work persists |
| `IDENTITY_CONFLICT` | No | Manual review |
| `INTERNAL` | No | Dead-letter; alert |

Every error is recorded on the run with its stage and provider, so §16's requirement to
distinguish zero results from a broken collector is satisfied by data rather than by inspection.

---

## 17. Delivery Plan and Acceptance Criteria

### Phase 0 — Manual validation

Research 40 businesses in one vertical and geography to the intended depth, using the column
set and the opener-assignment method in `audit-test-catalogue-v0.1.md` §5. Record findings,
contactability, outreach outcomes, and time per lead.

**Gate:** a documented, repeatable pitch pattern with recorded evidence of response — which
findings produced engagement, and which were ignored. Where the sample is inconclusive, apply
the fallback rule in the catalogue §5.3 rather than treating the gate as failed.

### Phase 1 — Data model and exclusions

Implement identity keys, normalisation, deduplication, **late merge (§4.5)**, provenance,
exclusion and suppression matching, and manual review.

### Phase 2 — Platform shell

Implement authentication, roles, records, search history, claims, filters, exports, and a
record create/edit form, using manually entered data.

### Phase 3 — Discovery

Add source adapters for the validated vertical, including e-commerce indexes, directories,
advertising activity, and website discovery. Verify Meta Ad Library commercial-ad coverage
before committing that adapter.

### Phase 4 — Enrichment and validation

Add provider adapters, company/contact enrichment, technographics, email validation, phone
validation, the Stage 2.5 gate, cost controls, the idempotency ledger, and partial-failure
handling.

### Phase 5 — Audit, scoring, and routing

Add measurable audits per the catalogue, score versioning, service routing, evidence display,
and suggested openers. Scope the class B and R checks by Phase 0 evidence; class A checks are
built regardless, as they gate spend and cost nothing to run.

### Phase 6 — Feedback loop

Add outcome logging, dashboards, and initial calibration once the §15 evidence thresholds are
met.

### Phase 7 — Expansion

Add Travel or another geography only after the first market meets the agreed quality and
conversion gates. **Note that the discovery layer does not transfer** — e-commerce indexes do
not cover travel businesses — so Phase 7 is a rebuild of Stage 1 sources, not a configuration
change. The enrichment, audit, and scoring layers do transfer.

### Minimum acceptance criteria for v1

- No duplicate canonical records in the acceptance test set.
- Every stored external field shows source and last-verified timestamp.
- No unconfirmed social or decision-maker match is labelled verified.
- Exclusion and suppression matching run before paid enrichment.
- A late merge on a rank 1 or 2 key resolves without data loss and leaves a reversible snapshot.
- A retried job does not re-purchase provider data.
- Partial provider failure is visible and recoverable.
- Every finding contains evidence or is marked with one of the five non-failed outcomes.
- A blocked crawl is recorded as `unavailable` and never contributes to a score.
- Every record remains exportable regardless of tier or gate status.
- A member cannot view or edit more data than their role permits.
- The system can operate with any one enrichment provider disabled.
- A record can be opened and prepared for human outreach without manual web research in the
  tested workflow.

**The acceptance test set** is the 40 Phase 0 businesses plus 10 deliberately adversarial
records: two known duplicates under different names, one domain that changed owner, one
business with a shared phone, two social-only businesses, one site that blocks crawling, one
suppressed record, one excluded record, and one record with every field unknown. It is
maintained as a fixture and re-run before each release.

---

## 18. Decisions

Items 5 and 6 are answered. Every remaining item carries a proposed default so it becomes an
approve/reject rather than an open question.

| # | Decision | Status | Proposal |
|---:|---|---|---|
| 1 | Initial geography | Proposed | US |
| 2 | Travel timing | Proposed | Waits until Phase 7 |
| 3 | Permission model | Proposed | Admin/Member per §12.3. Members may export and override route; takeover and exclusion editing are Admin-only |
| 4 | Exclusions in v1 | Proposed | CSV only; ClickUp sync deferred |
| 5 | **Weekly qualified-lead target** | **Answered** | **50–100 per week** |
| 6 | **Monthly budget** | **Answered** | **$300–800 per month**, allocated per §8.2.3 |
| 7 | Retention defaults | Proposed | §13 as written |
| 8 | Discovery provider | Open — action required | Coverage and pricing test against US apparel. **Per-record discovery pricing is a disqualifier** (§8.2.3) |
| 9 | Enrichment provider | Open — action required | Pilot one provider meeting the §2.2 licensed-data condition, against the $0.25/record ceiling |
| 10 | Reputation refresh interval | Proposed | 30 days, or the provider's permitted window if shorter |
| 11 | Revenue estimation method | Proposed | The §3.3.1 cascade, bands only |
| 12 | Decision-maker personal phones | Proposed | Excluded entirely unless self-published on a business-owned page |
| 13 | Exports and columns | Proposed | CSV; columns are the §16.2 record read model flattened, one row per record, provenance columns for contact fields only |
| 14 | Override authority | Proposed | Admin overrides scores, routes, claims, exclusion matches. Member overrides route only. All logged |
| 15 | US outbound compliance review | Open — action required | Complete before Phase 6. Blocking for volume, not for build |

Items 8, 9, and 15 cannot be closed by decision alone — they require a test or an external
review. They are the only remaining true blockers, and none of them blocks Phases 1 or 2.

---

## 19. Glossary

| Term | Definition |
|---|---|
| Canonical record | The single official record for one business |
| Identity key | Identifier used to find or merge a business |
| Key migration | Adding a stronger identity key to an existing record |
| Late merge | Two existing canonical records proven to be one business (§4.5) |
| Key reassignment | An identity key now belonging to a different business (§4.5.4) |
| Enrichment provider | External service supplying company/contact/technology data |
| Firmographic | Company facts such as revenue, employees, industry, and location |
| Technographic | Technologies detected on a company's website or systems |
| Problem score | Severity and commercial relevance of verified deficiencies |
| Intent score | Evidence of current investment or willingness to grow |
| Finding | A measurable, evidence-backed audit statement |
| Primary service route | The single AT360 service line assigned to a record |
| Gated | Passed exclusion but did not clear the Stage 2.5 spend gate; visible, not enriched |
| Verified | Supported by an authoritative or directly published source |
| Unconfirmed | Plausible but not sufficiently verified |
| Not found | Required checks completed without locating the field |
| Not yet validated | Data exists or was found but validation is pending |
| Exclusion | Existing AT360 relationship; full record retained, hidden from prospect views |
| Suppression | Subject request; identifiers retained as hashes only (§13.1) |
| **Qualified lead** | A record at Tier 1 or 2, with at least one contact method validated as `verified`, at least three evidence-backed findings, and no exclusion or suppression match |
| Contacted lead | A record claimed and contacted by a team member — the activity measure, tracked separately |

*Amended in v3.2:* "Qualified lead" previously meant "claimed and contacted". That is a measure
of team activity, and §18 item 5 uses this number to size discovery volume, enrichment spend,
and provider tier. A metric that moves when the team works harder cannot size the supply side,
and it can be satisfied by contacting records of any quality. The definition is now a property
of the record, which is what the pipeline can actually be built against; the old meaning is
retained under its accurate name.

---

## 20. Record Detail View — *new in v3.2*

§1.1 states the entire product promise: an operator opens a record and can personalise outreach
without repeating the research. That promise is kept or broken on one screen, and neither v3.1
nor the build guide specified it.

### 20.1 Order

Ordered by what the operator needs in the first fifteen seconds, not by data model structure.

| # | Block | Contents |
|---:|---|---|
| 1 | Header | Name, domain link, tier badge, route badge, claim control. Exclusion or suppression warning renders here and blocks nothing else from view |
| 2 | **Why this lead** | Routing reason, the finding that caused it, and the top three findings with evidence links. First, because this is what the opener is built from |
| 3 | Contact | Decision maker, and each channel with its own validation status. A channel that is unvalidated says so next to the value, not in a tooltip |
| 4 | Openers | Call and Instagram DM, each showing which finding it draws on |
| 5 | Evidence and audit | All findings grouped by domain, including `passed`, `unavailable`, and `not_applicable` |
| 6 | Company | Firmographics and technographics |
| 7 | Provenance | Per-field source, confidence, and last-verified date |
| 8 | History | Outcomes, claims, merges, key migrations |

### 20.2 Display rules

These are requirements, not styling preferences. Each one exists to stop a specific way the
system could mislead the operator.

1. **Every externally sourced field shows a confidence indicator**, with `verified` visually
   distinct from every other state. A verified email and a guessed email must never look alike.
2. **`unknown` and `not_found` render as explicit labelled states**, never as blank, `—`, or an
   empty cell. A blank field reads as a broken interface; a labelled one reads as an honest
   answer, and §1.2 rule 4 requires the latter.
3. **`unavailable` findings are displayed, not hidden.** Omitting a check that could not run
   implies it passed. Block 5 shows them under a "not measured" grouping.
4. **A name-based or inferred match is labelled as such at the point of display**, not only in
   provenance. This is the acceptance criterion "no unconfirmed match is labelled verified",
   enforced in the UI rather than only in the data.
5. **Source is at most one interaction away for every field.** Provenance may be collapsed but
   never absent.
6. **Openers cite their source finding.** An opener that cannot name the finding it came from is
   an unverified AI statement presented as research, which §9 prohibits.
7. **Gated records display why they were gated** and offer a manual enrichment action, so a
   spend decision never reads as a data failure.
