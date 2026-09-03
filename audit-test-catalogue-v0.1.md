> # ⚠ SUPERSEDED — DO NOT BUILD FROM THIS
>
> Built for online stores — checkout steps, product reviews, express checkout, catalogue size.
> None of it applies to a screen printer, a salon or a plumber.
>
> Replaced by §5 of `local-lead-intelligence-specification-v4.0.md`, where every check is
> niche-agnostic because the niche changes on every search.

---

# Audit Test Catalogue v0.1

**Lead Intelligence & Enrichment System — AheadTech360**
**Status:** Draft for approval. Uncalibrated.
**Companion to:** Final Specification v3.2 §9, Scoring Model v0.1
**Date:** 13 August 2026
**Catalogue version string:** `audit_v0.1` (stored alongside `score_version` per Spec §7.4)

---

## 0. What this document is for

Spec §9 requires every finding to be measurable and reproducible, and gives five examples. It
never lists the tests that run or the thresholds that make a measurement into a finding. This
catalogue is that list.

**Every check here maps to exactly one signal ID in `scoring-model-v0.1.md`, and every signal
ID there has exactly one row here.** That closure is what makes the two documents a single
system rather than two overlapping opinions. It is verified in §6.

The catalogue is versioned separately from the specification for the same reason the scoring
model is: thresholds will move on Phase 0 evidence, and a spec revision per threshold change is
not workable.

---

## 1. How to read a row

| Column | Meaning |
|---|---|
| **ID** | The scoring model signal this check feeds. One-to-one. |
| **Method** | How the value is obtained. Determines cost class. |
| **Fires when** | The threshold. A check fires only when this is true of a successfully measured value. |
| **Finding template** | Operator-visible text. `{braces}` are interpolated from the measured value — never from a model. |
| **Sev** | Severity stored on the finding (Spec §7.4). |
| **Class** | Cost class per Scoring Model §3: A free, B metered, C paid, R rendered. |
| **N/A when** | Condition under which the check returns `not_applicable` rather than running. |

### 1.1 Severity bands

Derived mechanically from the signal's `max_points` so severity and score never disagree:

| Points | Severity |
|---:|---|
| ≥ 30 | `critical` |
| 15–29 | `high` |
| 8–14 | `medium` |
| < 8 | `low` |

### 1.2 The five outcomes

Spec §9 requires all five to be distinguishable. Every check returns exactly one:

| Outcome | Meaning | Effect on score |
|---|---|---|
| `passed` | Ran, threshold not met | Contributes 0 points, **counts toward attainable max** |
| `failed` | Ran, threshold met | Contributes points, counts toward attainable max |
| `unavailable` | Could not run — fetch blocked, API error, timeout, quota exhausted | Excluded from **both** sums |
| `not_applicable` | Check does not apply to this business type | Excluded from both sums |
| `pending_review` | Ran, result ambiguous, queued for a human | Excluded from both sums; raises manual review |

**A blocked crawl is `unavailable`, never `passed`.** Recording a site we could not read as a
site with no problems is the single most damaging failure mode available to this system, and it
is silent. Every fetch path must distinguish "reached and parsed" from "did not reach".

### 1.3 Evidence

Every `failed` result stores an evidence record (Spec §7.4) containing: the measured value, the
URL or API endpoint it came from, the fetch timestamp, and the catalogue version. **A finding
with no evidence record is not published** — it is downgraded to `pending_review`. This is the
mechanical enforcement of Spec §9's rule that the system surfaces evidence and does not invent
findings.

---

## 2. Class A checks — free, and the only ones the Stage 2.5 gate may use

### 2.1 WEB — Web presence & performance

| ID | Method | Fires when | Finding template | Sev | Class | N/A when |
|---|---|---|---|---|:--:|---|
| W1 | Website status resolution (Spec §4.4) | `status ∈ {none, parked_or_expired}` | `No functional website found after checking Google profile, Facebook page, and brand-name search.` | critical | A | never |
| W2 | Website status resolution | `status ∈ {social_only_fb, social_only_ig}` | `Business operates from {platform} only; no confirmed website.` | critical | A | never |
| W3 | HTTP GET homepage | Final status ≥ 400 | `Homepage returns HTTP {status}.` | critical | A | W1/W2 fired |
| W4 | TLS handshake + cert inspection | Handshake fails, or cert expired/mismatched | `Site has no valid HTTPS certificate ({reason}).` | high | A | W1/W2 fired |
| W5 | PageSpeed Insights API, mobile strategy | LCP >4.0s (30pt) / 2.5–4.0s (15pt) | `Mobile LCP measured at {lcp} seconds on the homepage.` | critical | A | PSI returns no field data and no lab data |
| W6 | PageSpeed Insights API, mobile | Performance score <30 (25) / 30–49 (15) / 50–89 (5) | `Mobile PageSpeed performance score is {score}/100.` | high | A | as W5 |
| W7 | PageSpeed Insights API, mobile | CLS >0.25 (10) / 0.10–0.25 (5) | `Cumulative Layout Shift measured at {cls}.` | medium | A | as W5 |
| W8 | HTML parse | No `<meta name="viewport">` **and** no CSS media queries in linked stylesheets | `Homepage has no mobile viewport configuration.` | high | A | W3 fired |
| W9 | PageSpeed Insights API, mobile | TBT >600ms (10) / 200–600ms (5) | `Total blocking time measured at {tbt}ms.` | medium | A | as W5 |

### 2.2 CRO — Conversion

| ID | Method | Fires when | Finding template | Sev | Class | N/A when |
|---|---|---|---|---|:--:|---|
| C1 | HTML parse, homepage + footer | No `input[type=email]` in header, footer, or any modal markup | `No email capture form found anywhere on the site.` | high | A | W1/W2/W3 fired |
| C2 | Tech fingerprint + PDP parse | No reviews app detected **and** no review markup on a sampled product page | `No product review system detected on product pages.` | high | A | No product pages identified |
| C3 | Cart/PDP parse | None of Shop Pay, PayPal, Apple Pay, Google Pay markers present | `No express checkout options detected ({found} only).` | medium | A | Not an e-commerce site |
| C4 | Nav + footer link parse | No link matching shipping or returns policy patterns | `No shipping or returns policy linked in navigation or footer.` | medium | A | Not an e-commerce site |
| C5 | PDP parse | None of: review stars, guarantee badge, returns link, secure-checkout marker | `Product page shows no trust signals (no reviews, guarantee, returns, or security markers).` | high | A | No product pages identified |
| C6 | HTML parse | No search input present, **and** catalogue >50 products | `Catalogue of {count} products has no site search.` | medium | A | Catalogue ≤50 products |

### 2.3 SEO — Search visibility

| ID | Method | Fires when | Finding template | Sev | Class | N/A when |
|---|---|---|---|---|:--:|---|
| S1 | `robots.txt` fetch + homepage meta parse | `Disallow: /` for `*`, or homepage carries `noindex` | `Site blocks search engine indexing via {source}.` | critical | A | W1/W2/W3 fired |
| S2 | HTML parse across crawled pages | Homepage `<title>` absent, empty, or duplicated on another crawled page | `Homepage title tag is {problem}.` | medium | A | W3 fired |
| S3 | HTML parse | No `<meta name="description">` or empty | `Homepage has no meta description.` | low | A | W3 fired |
| S4 | JSON-LD / microdata parse | Neither Organization nor Product schema found | `No structured data markup found on homepage or product pages.` | high | A | W3 fired |
| S5 | `/sitemap.xml` fetch + robots.txt parse | Neither resolves | `No XML sitemap found at /sitemap.xml or declared in robots.txt.` | low | A | W3 fired |
| S6 | Crawl of internal links, depth 2 | Fewer than 5 indexable non-product pages | `Site has only {count} content pages beyond the product catalogue.` | medium | A | W3 fired |

### 2.4 EM — Email & retention

| ID | Method | Fires when | Finding template | Sev | Class | N/A when |
|---|---|---|---|---|:--:|---|
| E1 | Tech fingerprint | No ESP identified in scripts, DNS, or headers | `No email marketing platform detected.` | critical | A | W1/W2 fired |
| E2 | Tech fingerprint + HTML parse | ESP detected **and** no email input found on site | `{esp} is installed but no signup form is present on the site.` | high | A | E1 fired |
| E3 | Capture-form text parse | Form present, no offer/discount/incentive language within it | `Email signup offers no incentive to subscribe.` | high | A | C1 fired (no form exists) |
| E4 | Capture-form parse | No `input[type=tel]` in any capture form | `No SMS capture on the site.` | medium | A | C1 fired |
| E5 | Tech fingerprint classification | ESP is a general newsletter tool on a site with a product catalogue | `Store uses {esp}, a general newsletter tool, rather than a commerce email platform.` | medium | A | E1 fired, or not e-commerce |

### 2.5 REP and SOC — the class A remainder

| ID | Method | Fires when | Finding template | Sev | Class | N/A when |
|---|---|---|---|---|:--:|---|
| P1 | PDP parse | No review content rendered on any sampled product page | `No customer reviews displayed on product pages.` | high | A | No product pages identified |
| O1 | Site social-link parse + handle resolution | No Instagram link on site and no confidently matched handle | `No Instagram account found for this brand.` | critical | A | never |
| O5 | Site social-link parse | No TikTok link or confidently matched account | `No TikTok presence found.` | medium | A | never |

### 2.6 Intent, class A

| ID | Method | Fires when | Finding template | Sev | Class | N/A when |
|---|---|---|---|---|:--:|---|
| N5 | Careers/jobs page crawl | ≥1 open role listed | `Hiring: {count} open roles listed.` | — | A | No careers page found → `unavailable` |
| N6 | `Last-Modified` header, copyright year, template fingerprint vs. previous snapshot | Any change within 90 days | `Site updated within the last {days} days.` | — | A | No previous snapshot → `unavailable` |
| N8 | Tech fingerprint diff vs. previous snapshot | New ESP, reviews, subscription, or loyalty app since last snapshot | `Added {tool} since {date}.` | — | A | No previous snapshot → `unavailable` |

Intent findings carry no severity — they are positive signals, not deficiencies.

> **Class A total: 32 checks** — WEB 9, CRO 6, SEO 6, EM 5, REP 1, SOC 2, Intent 3.
> These, and only these, feed `problem_free` at Stage 2.5.

---

## 3. Class B checks — metered, run at Stage 5

| ID | Method | Fires when | Finding template | Sev | Class | N/A when |
|---|---|---|---|---|:--:|---|
| S7 | SERP lookup, exact brand name | Official site not position 1 organic | `Brand-name search returns the official site at position {pos}.` | critical | B | Brand name is a generic dictionary term |
| S8 | SERP lookup, exact brand name | ≥3 directory/marketplace results above official site | `Brand-name search returns the official site below {count} directory results.` | high | B | as S7 |
| S9 | Places lookup by name + location | Physical location evidence exists, no Place ID resolves | `No Google Business Profile found for a business with a physical location.` | high | B | Online-only, no location evidence |
| S10 | Places Details | Missing any of hours, category, ≥3 photos | `Google Business Profile is missing {missing}.` | high | B | S9 fired |
| P2 | Places Details | Review count <20 (30) / 20–49 (15) | `Only {count} public Google reviews found.` | critical | B | No Place ID |
| P3 | Places Details | Rating <4.0 (30) / 4.0–4.4 (12) | `Google rating is {rating} across {count} reviews.` | critical | B | No Place ID, or count <5 |
| P4 | Places Details, last 20 reviews | Zero owner replies | `No owner response in the last {n} reviews.` | high | B | Fewer than 5 reviews |
| P5 | Places Details, newest review date | Newest review older than 6 months | `Most recent review is {months} months old.` | high | B | No reviews |
| P6 | Third-party review source | Rating <3.5 | `{source} rating is {rating} from {count} reviews.` | high | B | No third-party profile found |
| O2 | IG profile read | Last post >90d (30) / 30–90d (15) | `Instagram last posted {duration} ago.` | critical | B | O1 fired |
| O3 | IG profile read | Followers <1,000 | `Instagram has {count} followers.` | high | B | O1 fired |
| O4 | IG profile read | No link in bio, or link points elsewhere | `Instagram bio has no link to the website.` | medium | B | O1 fired |
| O6 | FB page read | No page, or last post >180 days | `Facebook page {state}.` | medium | B | never |
| O7 | All detected channels | No post on any channel in 30 days | `No social activity on any channel in the last 30 days.` | high | B | No channels detected |
| N1 | Meta Ad Library query | Active ads present | `Currently running {count} ads on Meta.` | — | B | Ad Library returns no coverage → `unavailable` |
| N2 | Meta Ad Library, earliest active ad date | Continuous activity >30 days | `Advertising continuously for {days} days.` | — | B | N1 `unavailable` |
| N3 | Social channel read | Post within 14 days | `Posted on {channel} {days} days ago.` | — | B | No channels detected |
| N4 | Social channel read | Post within 30 days, none within 14 | `Posted on {channel} {days} days ago.` | — | B | as N3 |
| N7 | Domain age lookup | Registered or first seen <18 months ago | `Domain registered {months} months ago.` | — | B | Privacy-protected WHOIS → `unavailable` |
| N9 | Places Details, review dates | ≥5 reviews in last 90 days | `{count} new reviews in the last 90 days.` | — | B | No Place ID |
| N10 | Places / site location parse vs. snapshot | Location count increased | `Location count increased from {old} to {new}.` | — | B | No previous snapshot |

> **Class B total: 21 checks.**

---

## 4. Class R and C checks

### 4.1 Class R — rendered, Playwright service (Stage 5)

| ID | Method | Fires when | Finding template | Sev | Class | N/A when |
|---|---|---|---|---|:--:|---|
| C7 | Scripted checkout traversal with a test item | Steps >4 (15) / =4 (8) | `Checkout requires {count} steps.` | high | R | Not e-commerce, or checkout unreachable → `unavailable` |
| C8 | Scripted checkout traversal | Account creation required before payment | `Checkout requires account creation with no guest option.` | high | R | as C7 |
| E6 | Scripted signup submission with a controlled address | Submit yields no confirmation, or errors | `Email signup form does not complete submission ({observed}).` | high | R | C1 fired |

**Constraint:** rendered checks traverse to the payment step and stop. They never submit
payment, never create real orders, and never submit forms with third-party personal data. E6
uses an AT360-controlled address.

### 4.2 Class C — paid enrichment (Stage 3)

| ID | Method | Fires when | Finding template | Sev | Class | N/A when |
|---|---|---|---|---|:--:|---|
| N11 | Enrichment provider firmographics vs. snapshot | Employee count up, funding event, or expansion signal | `{signal} reported by {provider} on {date}.` | — | C | Record gated at Stage 2.5, or provider returns nothing |

No Problem signal is class C. **Deficiency scoring never depends on a paid provider** — which
is what allows the gate to work and what keeps the score computable when a provider is
disabled, as Spec §17 requires.

---

## 5. Phase 0 research columns

Guide §5 instructs Phase 5 to read "the Phase 0 RESULTS tab" before building audit checks. This
is that tab's column set. **The finding columns are exactly this catalogue's domains**, because
Phase 5 has to be able to answer "which finding type produced replies" from these rows.

### 5.1 Sheet 1 — RESEARCH (one row per business, 40 rows)

| Column | Type | Notes |
|---|---|---|
| `business_name` | text | |
| `domain` | text | Blank if no site — that is itself a finding |
| `website_status` | enum | Spec §4.4 vocabulary |
| `platform` | text | |
| `revenue_estimate` / `revenue_method` | text | Records which proxy was used, per Spec v3.2 §3.3 |
| `research_minutes` | number | Time per lead — a §15.2 success metric |
| `WEB_findings` … `SOC_findings` | text × 6 | One column per domain. Record the measured value, not an opinion |
| `manual_problem_score` / `manual_intent_score` | 0–100 | Scored by hand using Scoring Model v0.1 |
| `manual_tier` / `manual_route` | enum | |
| `contact_found` | enum | `decision_maker` / `generic` / `none` |
| `contact_channel_available` | multi | call / email / IG / LinkedIn |

### 5.2 Sheet 2 — OUTREACH (one row per attempt, not per business)

| Column | Type | Notes |
|---|---|---|
| `business_name`, `attempt_date`, `channel` | | |
| `opener_finding_domain` | enum | **The one domain the opener led with.** This column is the entire point of Phase 0 |
| `opener_text` | text | Verbatim |
| `outcome` | enum | Spec §15.1 taxonomy, unchanged |
| `replied` | bool | |
| `notes` | text | |

### 5.3 Decision rule

Phase 5 builds audit checks in proportion to what replied. To avoid reading noise as signal:

| Condition | Phase 5 action |
|---|---|
| A domain gets ≥8 attempts and ≥3 replies | **Validated** — build its checks thoroughly, including class B and R |
| A domain gets ≥8 attempts and 0–1 replies | **Deprioritised** — build class A checks only, minimal effort |
| A domain gets <8 attempts | **Inconclusive** — no evidence either way |

**Fallback when the sample is inconclusive**, which is the likely outcome at 40 businesses: 40
businesses across 6 domains at a realistic reply rate yields roughly 6–10 replies total, so
several domains will not reach 8 attempts. If fewer than 3 domains reach validated status,
**do not narrow the build** — build all class A checks (they are near-free and already written
here), defer class B and R checks until 100 cumulative outreach attempts exist, and treat the
Phase 5 gate as satisfied rather than failed.

To improve the odds, **the opener domain should be assigned deliberately rather than chosen ad
hoc** — roughly 7 businesses per domain across the 40, so each domain reaches the 8-attempt
floor. Choosing the "best" finding per business is the natural instinct and it destroys the
comparison.

---

## 6. Closure verification

Required before either document is treated as final. Asserted as tests in `packages/core`.

- [ ] **Signal closure, forward:** every signal ID in Scoring Model §4 and §5 has exactly one
      row here. *Expected: 57 IDs — W1–W9 (9), C1–C8 (8), S1–S10 (10), E1–E6 (6), P1–P6 (6),
      O1–O7 (7), N1–N11 (11).*
- [x] **Signal closure, reverse:** every row here maps to exactly one signal ID.
      *Counted here: 32 class A + 21 class B + 3 class R + 1 class C = **57 rows**.* Matches.
      Per family: W 9A; C 6A + 2R; S 6A + 4B; E 5A + 1R; P 1A + 5B; O 2A + 5B;
      N 3A + 7B + 1C. Every family total equals its scoring-model range.
- [ ] **Gate computability:** every check feeding `problem_free` is class A. No exceptions.
- [ ] **Severity consistency:** each row's severity matches its points band per §1.1.
- [ ] **Phase 0 alignment:** every Phase 0 finding column maps to a domain defined here.
- [ ] **Evidence rule:** no code path publishes a `failed` result without an evidence record.
- [ ] **Blocked ≠ passed:** every fetch path returns `unavailable` on failure to reach.
