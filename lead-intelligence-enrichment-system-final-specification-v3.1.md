# Lead Intelligence & Enrichment System

## Final Specification — v3.1

**Owner:** Ikrash Ovais, CEO — AheadTech360  
**Status:** Final specification for implementation  
**Date:** 12 August 2026  
**Supersedes:** v3.0 (12 August 2026)  
**Primary market:** US-based DTC fashion and apparel brands  
**Initial revenue range:** $500K–$10M, estimated where necessary  
**Second vertical:** Travel, after validation of the first vertical

---

## 1. Executive Summary

The Lead Intelligence & Enrichment System is AheadTech360's internal platform for discovering, consolidating, enriching, auditing, scoring, and preparing prospective businesses for human outreach.

The system must produce **enrichment-grade business intelligence records** comparable to those of established B2B data platforms, not merely scraped lead lists. It combines:

- Company and decision-maker enrichment.
- Small-business and local-business discovery.
- E-commerce platform and technology intelligence.
- Website, SEO, conversion, social, advertising, and reputation audits.
- Contact validation and field-level confidence.
- Problem and Intent scoring.
- Service routing and outreach preparation.
- Human outcome feedback for score calibration.

The system does not send outreach, replace a CRM, or make the final decision about whom the team contacts.

### 1.1 Core outcome

When an operator opens a record, they should have enough verified and clearly labelled information to personalise a call, Instagram DM, email, or LinkedIn message without repeating the research manually.

### 1.2 Non-negotiable principles

1. One business must have one canonical record.
2. Every important field must have a source, confidence status, and last-verified timestamp.
3. Verified links are preferred over name-based guesses.
4. Missing data is shown as `Unknown`, `Not found`, or `Not yet validated`; it is never silently excluded or fabricated.
5. Every matched record remains available; scoring changes priority, not eligibility.
6. External data providers are replaceable and are never treated as the sole source of truth.
7. The system surfaces evidence. It does not invent audit findings.
8. Human outreach remains outside the platform.

---

## 2. Scope

### 2.1 In scope

- Structured search briefs with optional natural-language instructions.
- Discovery from e-commerce indexes, directories, advertising libraries, search, social, and business-profile sources.
- Identity resolution, deduplication, key migration, and conflict logging.
- Apollo-like company and decision-maker enrichment through pluggable providers.
- Supplementary directory cross-checking for businesses with a local or offline footprint.
- Technographic detection for platforms, apps, analytics, checkout, CRM, and marketing tools.
- Website, search visibility, conversion, social, advertising, and reputation audits.
- Email and phone validation.
- Problem score, Intent score, tier, and one primary service route.
- In-platform record management, claiming, filtering, review queues, and export.
- Exclusion matching against existing clients, referral records, trackers, and do-not-contact records.
- Outreach outcome logging and score/discovery calibration.
- Role-based access, audit logs, retention controls, and provider-cost tracking.

### 2.2 Out of scope

- Sending email, calls, SMS, DMs, or LinkedIn messages.
- Outreach sequencing or automated engagement.
- CRM pipeline, quoting, invoicing, contracts, or deal management.
- Public access or multi-tenant customer accounts.
- Continuous monitoring; runs are on demand or explicitly scheduled.
- Automated legal/compliance decisions.
- Purchasing consumer personal data, or using data obtained from non-public, breached, or unauthorised sources.

Licensed B2B professional data from compliant enrichment providers **is permitted** and is a planned input (Section 8). The exclusion above applies to consumer data, telecom or identity records, and any source that cannot demonstrate a lawful basis for redistribution. Section 3.2 further restricts decision-maker phone numbers: personal numbers are collected only where self-published, pending confirmation in Section 18.

---

## 3. Target Data Standard

Every enriched record is considered complete only when it contains, or explicitly marks unavailable, the following categories:

### 3.1 Company profile

- Display name and normalised name.
- Legal name where available.
- Website, domain, and website status.
- Description, industry, sub-category, and business model.
- Address, city, state, country, ZIP, and operating locations.
- Founded year or business age where available.
- Estimated revenue band and confidence.
- Employee range and confidence.
- Business status: active, closed, relocated, or unknown.

### 3.2 Decision-maker profile

- Name, title, seniority, and department.
- LinkedIn profile where available.
- Public personal Instagram only where identity is confidently established.
- Work email, status, and confidence.
- Public business phone, validity, line type, and confidence.
- Source and last verification date for every field.

Personal Instagram is optional and non-blocking. A name-based match must never be presented as verified.

### 3.3 Firmographic data

- Revenue estimate and method.
- Employee estimate and method.
- Industry and sub-category.
- Geography and location count.
- Business model.
- Hiring, expansion, funding, rebrand, or other growth signals.
- Parent company or brand group where available.

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

| Rank | Key | Use | Confidence |
|---|---|---|---|
| 1 | Normalised live domain | Website exists and resolves | Highest |
| 2 | Google Place ID | Business is listed on Google | High |
| 3 | Phone + normalised name | Phone is available | Moderate |
| 4 | Facebook Page ID or Instagram account ID | Social-only business | Moderate |
| 5 | Normalised name + location hash | No stronger key exists | Low; manual review |

All available keys are stored together on the canonical record. The internal `record_id` is immutable.

### 4.2 Normalisation

- Domain: remove protocol, `www`, trailing slash, tracking parameters, and resolve redirects.
- Phone: convert to E.164 where possible; store country and line type.
- Name: lowercase, remove punctuation and non-distinctive legal/category suffixes.
- Location: standardise country/state/city and create a rounded-coordinate location hash.
- Social URLs: canonicalise usernames, remove tracking parameters, and retain platform IDs where available.

### 4.3 Merge rules

- A matching canonical key updates the existing record; it does not create a new record.
- A phone number alone never merges records.
- One phone attached to more than three distinct names creates a manual-review queue.
- Conflicting fields are retained with provenance; the selected value follows the source precedence matrix.
- A new domain, Place ID, phone, or social ID is added to the existing record as a key migration event.
- A newly detected website increments Intent only when the domain is confirmed and functional.

### 4.4 Website status

| Status | Definition | Default route |
|---|---|---|
| `none` | No site found after required checks | Web development |
| `social_only_fb` | Facebook presence, no confirmed site | Web development |
| `social_only_ig` | Instagram presence, no confirmed site | Web development + booking/commerce |
| `parked_or_expired` | Domain resolves but no functional site | Web development |
| `live_unlisted` | Functional site absent from Maps/directories | SEO/local listings |
| `live_listed` | Functional site and listing found | Based on audit |
| `unconfirmed` | Evidence conflicts or checks are incomplete | Manual review |

`none` may be assigned only after the Google profile website field, Facebook website field, and direct brand-name search all return no confirmed website.

---

## 5. Search Input

### 5.1 Discovery-time filters

- Industry.
- Sub-category.
- Geography.
- Platform.
- Business model.
- Ad activity.
- Problem-type flags.
- Brand-name pattern.
- Source selection.
- Maximum records and cost ceiling.

### 5.2 Post-enrichment filters

- Estimated revenue band.
- Employee count.
- Technology stack.
- Review volume/rating.
- Website status.
- Problem score and Intent score.
- Decision-maker availability.
- Contact validation status.

Revenue and employee count must not silently gate discovery when they are unavailable. Unknown values remain visible and are labelled accordingly.

### 5.3 Open text

Natural-language instructions supplement structured fields. The parser must produce a visible resolved filter object before the run starts. The operator must confirm the filter set and estimated source/cost impact.

### 5.4 Saved searches

Operators can save, rename, duplicate, edit, and archive searches. Every resulting record stores the originating resolved filter set and run ID.

---

## 6. Pipeline

### Stage 0 — Run planning

Validate required fields, resolve natural language, estimate source calls and cost, apply the selected limits, and request operator confirmation.

### Stage 1 — Discovery

Query enabled sources in parallel. Capture source, source record ID, name, URL/domain, contact methods, location, platform, collection time, and run ID.

### Stage 2 — Consolidation and exclusion

Resolve identity, merge duplicates, log conflicts, and match the full key set against the exclusion list before paid enrichment.

### Stage 3 — Enrichment

Enrich company, decision-maker, firmographic, technographic, contact, social, advertising, and reputation fields through approved providers and first-party sources.

### Stage 4 — Validation

Validate email deliverability, phone validity and line type, domain status, URL resolution, and identity confidence. Deferred validation must be distinct from `not found`.

### Stage 5 — Audit

Run objective tests for website, search visibility, conversion paths, social activity, advertising, and reputation. Produce three to five evidence-backed findings where data supports them.

### Stage 6 — Scoring and routing

Calculate Problem score, Intent score, priority tier, and exactly one primary service route. Scores must show their supporting signals.

### Stage 7 — Human review

Route low-confidence identities, source conflicts, no-website uncertainty, unusual phone sharing, and high-impact findings to a review queue.

### Stage 8 — Output

Show the record in-platform, allow claiming and filtering, generate channel-specific openers, and support CSV/Google Sheets export.

### Stage 9 — Feedback

Log outreach outcomes and attribute them to source, search, signals, score, service route, and channel for calibration.

---

## 7. Data Model

### 7.1 Core record

- `record_id`, `status`, `created_at`, `updated_at`.
- `display_name`, `name_normalised`, `legal_name`.
- `domain`, `website_url`, `website_status`.
- `place_id`, `phone_e164`, `fb_page_id`, `ig_account_id`, `ig_handle`.
- `identity_rank`, `identity_confidence`, `location_hash`.
- `business_status`, `exclusion_flag`, `manual_review_status`.

### 7.2 Enrichment fields

- Company profile fields listed in Section 3.
- Decision-maker fields listed in Section 3.
- Firmographic and technographic fields listed in Section 3.
- Provider record IDs and provider names.
- `enrichment_status`, `enrichment_attempted_at`, `enrichment_cost`.

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

`terms_classification` must identify whether the field is first-party, provider-supplied, API-restricted, derived, or temporary-display-only.

### 7.4 Audit and scoring

- Findings array: finding, metric, evidence URL/source, severity, audit timestamp.
- Problem score, Intent score, tier, score version, score signals.
- Routed service, routing reason, routing confidence.
- Suggested call, email, Instagram, and LinkedIn openers.

### 7.5 Ownership and outcomes

- `claimed_by`, `claimed_at`, `claim_status`, `claim_release_at`.
- Outcome log: channel, outcome, timestamp, user, notes, meeting date where applicable.
- User activity log for view, edit, export, claim, exclusion, and deletion actions.

---

## 8. Providers and Sources

External providers are pluggable. Store Leads/BuiltWith or comparable e-commerce indexes are the primary discovery source for the DTC target market; Apollo or a comparable provider may supply company and contact enrichment; directory sources such as Manta may supplement discovery for businesses with a local or offline footprint; Meta Ad Library may provide advertising activity; Google Places may provide Place IDs and location/reputation context; first-party websites remain the preferred source for published business contact and social links.

Apollo-style enrichment must not be hard-coded as the only path. Provider usage must record provider, endpoint or product, timestamp, returned fields, credits/cost, and terms classification. Enrichment API usage consumes credits at rates that vary by endpoint and plan, so the system must support budget controls and provider fallback.

Directory data is treated as discovery and cross-check input, never automatically as final truth — listings are frequently self-submitted and go stale without correction. Directory values must be compared against first-party or approved authoritative sources before display as verified.

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

Conflicts must be logged and never silently overwritten.

---

## 9. Auditing and Findings

Every finding must be measurable and reproducible. Examples:

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

No AI-generated statement may appear as a factual finding unless tied to a measured result or source evidence.

---

## 10. Scoring and Routing

### 10.1 Scores

Both scores use a documented versioned model from 0–100.

**Problem score** measures the severity and commercial relevance of verified deficiencies.  
**Intent score** measures evidence that the business is currently investing in growth, such as active advertising, fresh content, hiring, expansion, a new domain, or recent site changes.

Unknown signals contribute zero evidence; they must not be treated as negative evidence.

### 10.2 Tiers

| Problem | Intent | Tier | Meaning |
|---|---|---:|---|
| High | High | 1 | Clear need and willingness to invest |
| Low | High | 2 | Active business needing a different angle |
| High | Low | 3 | Strong problem but weaker appetite |
| Low | Low | 4 | Lowest priority but still visible |

The default working view shows Tiers 1–2. Tiers 3–4 remain one click away and are included in every export.

### 10.3 Primary service route

Each record receives exactly one primary route, with optional secondary findings:

- Web development.
- SEO/local listings.
- CRO.
- Social media management.
- Email marketing.
- Marketing/reputation.

Routing must display the reason and the finding that caused it. The operator can override the route, and the override is logged.

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

### 11.3 Quality metrics

Track precision of identity matches, duplicate rate, reachable email rate, reachable phone rate, stale-field rate, manual-review resolution time, and percentage of findings with evidence.

---

## 12. Exclusions, Claims, and Access

### 12.1 Exclusion list

Sources include current clients, past clients, Partner Circle records, cold-calling trackers, and do-not-contact records. Matching uses the complete identity key set. v1 supports CSV import/export; ClickUp sync is a later integration.

Excluded records must be retained in a restricted audit area or exclusion table so the system can prevent re-discovery without presenting them in normal prospect views.

### 12.2 Claims

Any member can claim a record. Claims are visible to everyone, timestamped, and releasable after a configurable stale period. A claimed record cannot be claimed by another user without an explicit takeover action.

### 12.3 Roles

| Action | Admin | Member |
|---|---:|---:|
| Run search | Yes | Yes |
| View records | Yes | Yes |
| Claim/release own lead | Yes | Yes |
| Take over another claim | Yes | Configurable |
| Export | Yes | Yes/configurable |
| Edit exclusion list | Yes | No |
| Add/remove users | Yes | No |
| Delete records | Yes | No |
| View audit logs | Yes | Limited |
| Change scoring model | Yes | No |

MFA, per-user accounts, session timeout, encryption in transit/at rest, and administrative audit logs are required for production.

---

## 13. Retention, Compliance, and Security

Before production, AT360 must define retention periods for prospect records, contact data, audit logs, exports, provider responses, and outreach outcomes. Suggested starting defaults:

- Unclaimed/uncontacted records: re-verify after 90 days and archive after 180 days.
- Contacted records: retain while operationally relevant, then review after 12 months.
- Do-not-contact records: retain indefinitely or as required to prevent re-contact.
- Audit and access logs: retain for at least 12 months.
- Raw restricted third-party content: do not retain beyond the source's permitted period.

The system must support deletion, correction, access restriction, and do-not-contact requests. Collection should be limited to public or self-published professional information, with documented lawful basis and jurisdiction-specific review.

US calling, texting, and commercial email require compliance review before volume scales. The platform must not make legal eligibility decisions; it only stores relevant validation and suppression signals.

Google/Places and other provider terms must be reviewed for every stored field. Restricted data should be fetched for display or scoring and refreshed rather than permanently cached where required.

---

## 14. Refresh and Cost Controls

| Data | Default refresh | Rule |
|---|---:|---|
| Place ID validity | 12 months | Refresh and handle invalid/not-found states |
| Website and tech stack | 90 days | Re-check sooner after a change signal |
| Email/phone validation | 90 days before outreach | Revalidate stale contacts |
| Social activity | 30–60 days | Store last activity date and source |
| Advertising activity | Per run or 30 days | Depends on provider cost |
| Reputation | 30–90 days | Fetch according to source terms |
| Revenue/employee estimate | 180 days | Mark directional and confidence-rated |

Every run must support maximum records, maximum spend, provider credit limits, and tiered enrichment. Exclusion matching occurs before paid enrichment. Partial failures must preserve completed fields and show the failed stage.

---

## 15. Feedback Loop and Metrics

### 15.1 Outcome taxonomy

Per attempt, capture channel, timestamp, user, outcome, notes, and optional meeting date:

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

- Qualified leads per week: claimed and contacted records, measured against the target set in Section 18.
- Preparation time per lead.
- Contact reachability by channel.
- Conversion-to-meeting rate by channel and tier.
- Duplicate rate.
- Identity precision.
- Finding evidence coverage.
- Cost per enriched record.
- Cost per meeting.
- Exclusion-match accuracy.
- Stale-data rate.

Score and discovery models must be versioned. Recalibration should begin only after a meaningful volume of labelled outcomes exists, and changes must be compared against the previous model.

---

## 16. Technical Architecture

- Relational database with immutable record IDs and structured key tables.
- Backend API and web frontend.
- Queue/job runner for on-demand discovery and enrichment.
- Provider adapter layer so Apollo, Manta, Store Leads, BuiltWith, validation providers, and future replacements are swappable.
- Source/provenance tables at field level.
- Manual-review queue.
- Cost and credit ledger per run/provider.
- Search/run history and saved-search tables.
- Audit log for user and system actions.
- Export service for CSV and Google Sheets.
- Secrets manager for API credentials.
- Retry, timeout, circuit-breaker, and dead-letter handling for provider failures.
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

The core application must remain functional if any single provider is unavailable.

---

## 17. Delivery Plan and Acceptance Criteria

### Phase 0 — Manual validation

Research 40 businesses in one vertical and geography to the intended depth. Record findings, contactability, outreach outcomes, and time per lead.

**Gate:** a documented, repeatable pitch pattern with recorded evidence of response — which findings produced engagement, and which were ignored.

### Phase 1 — Data model and exclusions

Implement identity keys, normalisation, deduplication, provenance, exclusion matching, and manual review.

### Phase 2 — Platform shell

Implement authentication, roles, records, search history, claims, filters, and exports using manually entered data.

### Phase 3 — Discovery

Add source adapters for the validated vertical, including e-commerce indexes, directories, advertising activity, and website discovery.

### Phase 4 — Enrichment and validation

Add provider adapters, company/contact enrichment, technographics, email validation, phone validation, cost controls, and partial-failure handling.

### Phase 5 — Audit, scoring, and routing

Add measurable audits, score versioning, service routing, evidence display, and suggested openers.

### Phase 6 — Feedback loop

Add outcome logging, dashboards, and initial calibration after sufficient outcome data.

### Phase 7 — Expansion

Add Travel or another geography only after the first market meets the agreed quality and conversion gates.

### Minimum acceptance criteria for v1

- No duplicate canonical records in the acceptance test set.
- Every stored external field shows source and last-verified timestamp.
- No unconfirmed social or decision-maker match is labelled verified.
- Exclusion matching runs before paid enrichment.
- Partial provider failure is visible and recoverable.
- Every finding contains evidence or is marked unavailable.
- Every record remains exportable regardless of tier.
- A member cannot view or edit more data than their role permits.
- The system can operate with any one enrichment provider disabled.
- A record can be opened and prepared for human outreach without manual web research in the tested workflow.

---

## 18. Decisions Required Before Build

1. Confirm US as the initial geography.
2. Confirm whether Travel waits until Phase 7.
3. Confirm the Admin/Member permission model.
4. Approve CSV-only exclusions for v1 or bring ClickUp sync forward.
5. **Set the weekly qualified-lead target.** This must be decided before item 6 — required discovery volume, enrichment spend, and provider tier all derive from it. A target of 50 leads/week and one of 300 leads/week produce materially different systems.
6. Set monthly record/enrichment budget and maximum per-run spend, sized against item 5.
7. Approve retention defaults or provide AT360-specific periods.
8. Select initial discovery provider after a coverage and pricing test against US apparel.
9. Select the first enrichment provider for pilot, and confirm it meets the licensed-data condition in Section 2.2.
10. Confirm reputation refresh interval under source terms.
11. Approve the revenue-estimation proxy method.
12. Approve whether personal decision-maker phone numbers are excluded entirely unless self-published.
13. Confirm required exports and destination columns.
14. Confirm who can override scores, routes, claims, and exclusion matches.
15. Complete a US outbound compliance review before scaling calls, texts, or commercial email.

---

## 19. Glossary

| Term | Definition |
|---|---|
| Canonical record | The single official record for one business |
| Identity key | Identifier used to find or merge a business |
| Key migration | Adding a stronger identity key to an existing record |
| Enrichment provider | External service supplying company/contact/technology data |
| Firmographic | Company facts such as revenue, employees, industry, and location |
| Technographic | Technologies detected on a company's website or systems |
| Problem score | Severity and commercial relevance of verified deficiencies |
| Intent score | Evidence of current investment or willingness to grow |
| Finding | A measurable, evidence-backed audit statement |
| Primary service route | The single AT360 service line assigned to a record |
| Verified | Supported by an authoritative or directly published source |
| Unconfirmed | Plausible but not sufficiently verified |
| Not found | Required checks completed without locating the field |
| Not yet validated | Data exists or was found but validation is pending |
| Exclusion | Existing relationship or do-not-contact record removed from prospect views |
| Qualified lead | A record claimed and contacted by a team member |
