> # ⚠ SUPERSEDED — DO NOT BUILD FROM THIS
>
> Scores e-commerce signals (checkout, product reviews, email platform) that do not exist for a
> local business. Replaced by §6 of `local-lead-intelligence-specification-v4.0.md`.
>
> The formula shape — worst-area weighting, unknown contributing zero, the coverage floor —
> carried forward. The signals did not.

---

# Scoring Model v0.1

**Lead Intelligence & Enrichment System — AheadTech360**
**Status:** Draft for approval. Uncalibrated.
**Companion to:** Final Specification v3.2 §10
**Date:** 13 August 2026
**Model version string:** `score_v0.1` (stored on every record per Spec §7.4)

---

## 0. Why this document is separate from the specification

Spec §10.1 requires a documented, versioned model, and §15.2 requires each version to be
compared against the previous one. Weights will move every time outcome data arrives. Keeping
the model in the specification would force a spec revision on every recalibration, so the model
is versioned on its own and the spec references it.

**Every number in this document is a starting hypothesis, not a measurement.** v0.1 is
deliberately built from signals that can be measured before any outcome data exists. Section 7
defines what evidence is required to change any of them.

---

## 1. Design constraints this model has to satisfy

| Constraint | Source | Consequence for the model |
|---|---|---|
| Deterministic — identical input, identical output | Guide §4 | Pure function of stored signals. No AI, no randomness, no wall-clock reads except an explicit `as_of` date passed in. |
| Unknown contributes zero, never negative | Spec §10.1 | A missing signal removes its points from both numerator and attainable maximum. It cannot push a record down. |
| Scores must show supporting signals | Spec §6 Stage 6 | Every score returns a signal array, not just a number. |
| Exactly one primary route | Spec §10.3 | Routing is derived from the same domain subscores, so the score and the route can never disagree. |
| Must gate paid enrichment | Spec v3.2 §6 Stage 2.5 | A subset of the model must be computable from free signals only. See §3. |
| Every finding must carry evidence | Spec §9 | A signal with no evidence record cannot contribute points. |

### 1.1 The budget constraint that shaped the model

At 50–100 qualified leads/week against $300–800/month, paid enrichment cannot run on every
discovered record. The Problem score therefore exists in two forms:

- **`problem_free`** — computed from cost-class A signals only, at Stage 2.5, before any paid
  call. Used to decide who is worth paying for.
- **`problem_full`** — computed from all available signals at Stage 6, after enrichment and
  audit. Used for tiering, routing, and the working view.

`problem_free` is not an approximation of `problem_full` reported to the operator; it is an
internal gate. Only `problem_full` is displayed.

**If any signal in `problem_free` requires a paid call, the gate is circular and the model is
broken.** This is checked in §8.

---

## 2. Structure

The model has six **domains**, one per AT360 service line (Spec §10.3). Each domain produces a
0–100 subscore from its own signals. The Problem score is a blend of those subscores, and the
primary route is the winning domain. One structure, two outputs, guaranteed consistent.

| Code | Domain | Service route | Domain weight `w` |
|---|---|---|---:|
| WEB | Web presence & performance | Web development | 0.22 |
| CRO | Conversion | CRO | 0.20 |
| SEO | Search visibility | SEO / local listings | 0.18 |
| EM | Email & retention | Email marketing | 0.16 |
| REP | Reputation | Marketing / reputation | 0.12 |
| SOC | Social presence | Social media management | 0.12 |

Weights reflect commercial relevance to AT360 for US DTC apparel at $500K–$10M: how reliably a
deficiency in that domain converts into a scoped, sellable engagement. They are not a claim
about what matters most to the business being scored.

### 2.1 Domain subscore

```
subscore_D = 100 × ( Σ points(signal) for fired, available signals in D )
                 / ( Σ max_points(signal) for available signals in D )
```

`available` means the check ran and returned `passed` or `failed`. Checks returning
`unavailable`, `not_applicable`, or `pending_review` are excluded from **both** sums — this is
the mechanical implementation of "unknown contributes zero evidence" (Spec §10.1).

**Coverage floor.** If fewer than 40% of a domain's attainable points were actually assessed,
`subscore_D` is suppressed to `null` and the domain is excluded from the Problem blend and from
routing. A domain judged on one working check is noise, not signal.

### 2.2 Problem score

```
problem = 0.6 × max(subscore_D over non-null D)
        + 0.4 × ( Σ w_D × subscore_D / Σ w_D )   for non-null D
```

Weighted mean alone would dilute a catastrophic single failure — a business with no website at
all would score mid-range because its email and reputation domains are `not_applicable`. The
`max` term prevents that. The mean term prevents a single noisy check from dominating a
record that is otherwise healthy. 60/40 is a starting split.

### 2.3 Hard overrides

Two conditions bypass the arithmetic, because they are unambiguous and commercially decisive:

| Condition | Effect |
|---|---|
| `website_status ∈ {none, social_only_fb, social_only_ig, parked_or_expired}` | `problem = max(problem, 85)`, route forced to Web development |
| `website_status = unconfirmed` | Record goes to manual review (Spec §11.2); no score published |

---

## 3. Cost classes

Every signal carries a cost class. This is what makes the Stage 2.5 gate possible and it is
enforced, not documentary.

| Class | Meaning | Cost per record | Available at Stage 2.5 |
|---|---|---|:--:|
| **A** | Our own HTTP fetch and HTML parsing, plus PageSpeed Insights (free API quota) | ~$0 | **Yes** |
| **B** | Low-cost metered APIs — Places Details, SERP lookup, ad library, social profile reads | cents | No (Stage 5) |
| **C** | Per-record paid enrichment — contact provider credits, email validation, phone validation | the budget | No (Stage 3) |
| **R** | Rendered checks requiring Playwright | compute, not credits | No (Stage 5) |

`problem_free` uses **class A only**. Not A+B — B is metered, and metering the gate defeats the
gate.

---

## 4. Problem signals

Points are deficiency points. A signal "fires" when the stated condition is true. `max_points`
is the value shown; graded signals list their bands.

### 4.1 WEB — Web presence & performance

| ID | Signal | Threshold | Points | Class |
|---|---|---|---:|:--:|
| W1 | No functional website | `website_status ∈ {none, parked_or_expired}` | 100 | A |
| W2 | Social-only presence | `website_status ∈ {social_only_fb, social_only_ig}` | 90 | A |
| W3 | Homepage returns 4xx/5xx | HTTP status ≥ 400 | 30 | A |
| W4 | No HTTPS or invalid certificate | TLS handshake fails or cert invalid/expired | 25 | A |
| W5 | Mobile LCP | >4.0s → 30; 2.5–4.0s → 15; ≤2.5s → 0 | 30 | A |
| W6 | PSI mobile performance score | <30 → 25; 30–49 → 15; 50–89 → 5; ≥90 → 0 | 25 | A |
| W7 | Cumulative Layout Shift | >0.25 → 10; 0.10–0.25 → 5; <0.10 → 0 | 10 | A |
| W8 | Not mobile-responsive | No viewport meta tag and no CSS media queries | 20 | A |
| W9 | Total blocking time | >600ms → 10; 200–600ms → 5 | 10 | A |

W1 and W2 fire only under §2.3's override, which already forces the route; they are listed for
completeness of the subscore.

### 4.2 CRO — Conversion

| ID | Signal | Threshold | Points | Class |
|---|---|---|---:|:--:|
| C1 | No email capture anywhere on site | No form with an email input in header, footer, or modal | 20 | A |
| C2 | No product reviews app detected | No reviews app in tech fingerprint and no review markup on a PDP | 15 | A |
| C3 | No express checkout | No Shop Pay / PayPal / Apple Pay / Google Pay marker on cart or PDP | 12 | A |
| C4 | No shipping or returns policy linked | Neither found in nav or footer links | 12 | A |
| C5 | No trust signals on PDP | None of: review stars, guarantee badge, returns link, secure-checkout marker | 15 | A |
| C6 | No site search | No search input, on a catalogue with >50 products | 10 | A |
| C7 | Checkout step count | >4 steps → 15; 4 steps → 8; ≤3 → 0 | 15 | R |
| C8 | No guest checkout | Account creation required before payment | 15 | R |

**W5 is not repeated here.** Mobile speed is a conversion problem, but counting it in two
domains would inflate `problem` and distort routing toward whichever domain double-counted.
Speed lives in WEB. The CRO routing reason may cite it as supporting context.

### 4.3 SEO — Search visibility

| ID | Signal | Threshold | Points | Class |
|---|---|---|---:|:--:|
| S1 | Indexing blocked | `robots.txt` disallows `/`, or homepage has `noindex` | 40 | A |
| S2 | Missing or duplicate homepage title tag | Absent, empty, or identical to another crawled page | 10 | A |
| S3 | No meta description on homepage | Absent or empty | 8 | A |
| S4 | No structured data | No Organization and no Product schema found | 15 | A |
| S5 | No XML sitemap | `/sitemap.xml` absent and none declared in robots.txt | 8 | A |
| S6 | Thin site | Fewer than 5 indexable non-product pages | 10 | A |
| S7 | Brand search — official site not first organic result | Position >1 for exact brand name | 30 | B |
| S8 | Brand search — buried under directories | ≥3 directory/marketplace results above the official site | 20 | B |
| S9 | No Google Business Profile | Physical location evidence exists but no Place ID resolved | 25 | B |
| S10 | Incomplete Google Business Profile | Missing any of: hours, category, ≥3 photos | 15 | B |

S9 and S10 are `not_applicable` for online-only brands with no physical location — which is
most of this ICP. That is exactly what the §2.1 coverage floor is for.

### 4.4 EM — Email & retention

| ID | Signal | Threshold | Points | Class |
|---|---|---|---:|:--:|
| E1 | No ESP detected | No email service provider in tech fingerprint | 40 | A |
| E2 | ESP present but no on-site signup form | ESP detected, no email input found | 20 | A |
| E3 | No welcome offer or incentive | No discount/offer text within a capture form | 15 | A |
| E4 | No SMS capture | No phone input in any capture form | 10 | A |
| E5 | Non-commerce ESP on a commerce site | ESP is a general newsletter tool rather than a commerce ESP | 10 | A |
| E6 | Signup submission fails | Form submits without confirmation or errors | 15 | R |

### 4.5 REP — Reputation

| ID | Signal | Threshold | Points | Class |
|---|---|---|---:|:--:|
| P1 | No on-site product reviews | No review content rendered on any PDP | 15 | A |
| P2 | Low Google review count | <20 → 30; 20–49 → 15; ≥50 → 0 | 30 | B |
| P3 | Low Google rating | <4.0 → 30; 4.0–4.4 → 12; ≥4.5 → 0 | 30 | B |
| P4 | No owner responses | Zero owner replies in the last 20 reviews | 20 | B |
| P5 | Stale reviews | No review in the last 6 months | 15 | B |
| P6 | Weak third-party rating | Trustpilot or equivalent below 3.5 | 20 | B |

Per Spec §3.5, raw review text is not retained. P2–P5 are computed at fetch time and only the
derived counts and the theme summary are stored.

### 4.6 SOC — Social presence

| ID | Signal | Threshold | Points | Class |
|---|---|---|---:|:--:|
| O1 | No Instagram account found | No IG link on site and no confident handle match | 30 | A |
| O2 | Instagram dormant | Last post >90d → 30; 30–90d → 15; ≤30d → 0 | 30 | B |
| O3 | Small Instagram following | <1,000 followers | 15 | B |
| O4 | No link to site in IG bio | Bio has no link, or links elsewhere | 10 | B |
| O5 | No TikTok presence | No TikTok account found (apparel-relevant) | 10 | A |
| O6 | Facebook absent or dormant | No page, or last post >180 days | 10 | B |
| O7 | Nothing posted anywhere in 30 days | No activity on any detected channel | 20 | B |

---

## 5. Intent score

Intent measures evidence of current investment in growth (Spec §10.1). Points are additive
credits, capped at 100. Absence of a signal adds nothing — it never subtracts.

```
intent = min(100, Σ points(fired signals))
```

No coverage floor applies: Intent is evidence of presence, so missing evidence legitimately
means a low score. This asymmetry with Problem is deliberate — a deficiency you failed to
measure is not a deficiency, but growth activity you failed to find is, for our purposes,
growth activity that is not visible to a prospect either.

| ID | Signal | Threshold | Points | Class |
|---|---|---|---:|:--:|
| N1 | Currently running paid ads | Active ads in Meta Ad Library | 30 | B |
| N2 | Sustained ad activity | Ads running continuously >30 days | 10 | B |
| N3 | Posted in last 14 days | Any detected social channel | 15 | B |
| N4 | Posted in last 30 days | Any channel — mutually exclusive with N3 | 8 | B |
| N5 | Actively hiring | Careers page with ≥1 open role, or job-board listing | 15 | A |
| N6 | Site changed recently | Last-Modified, current copyright year, or template change within 90 days | 10 | A |
| N7 | Young or newly launched domain | Domain registered or site first seen <18 months ago | 10 | B |
| N8 | Growth tooling recently added | New ESP, reviews, subscription, or loyalty app since last snapshot | 10 | A |
| N9 | Review velocity | ≥5 new Google reviews in last 90 days | 10 | B |
| N10 | Location expansion | New location added, or location count increased | 10 | B |
| N11 | Headcount or funding growth | Employee count up, funding event, or expansion signal from enrichment | 15 | C |

N6 and N8 require a previous snapshot. On first observation they return `unavailable` and
contribute nothing. Intent therefore strengthens on the second run of a saved search — expected
behaviour, and a reason the refresh job (Spec v3.2 §14) matters.

---

## 6. Tiers and routing

### 6.1 Tier thresholds

These are the numbers Spec §10.2 assumes and never states.

| Axis | High | Low |
|---|---|---|
| Problem | ≥ 55 | < 55 |
| Intent | ≥ 40 | < 40 |

Calibration intent behind the scale: a competently run modern DTC store with a live, fast site
and an ESP should land at **15–35** Problem. One genuine sellable gap should land **40–60**.
Multiple gaps or a missing/broken site should land **70+**. On Intent, a brand advertising and
posting weekly clears 45–65 comfortably; a dormant brand sits at 0–20.

Tier assignment then follows Spec §10.2 unchanged (1 = High/High, 2 = Low Problem/High Intent,
3 = High Problem/Low Intent, 4 = Low/Low). Tier changes priority, never eligibility — every
record stays visible and exportable (Spec §1.2, §10.2).

### 6.2 Stage 2.5 gate

| Parameter | Default | Notes |
|---|---:|---|
| `gate_min_problem_free` | 35 | Run parameter, adjustable per search brief |
| Forced pass | — | Any §2.3 hard override passes regardless of score |
| Forced fail | — | Exclusion match (Spec §6 Stage 2) — never reaches the gate |

The gate is a spend decision, not a quality judgement. Records that fail it are retained with
`enrichment_status = gated`, remain visible, and can be enriched manually by an operator. They
are not deleted and not hidden.

### 6.3 Primary route

```
route = argmax(subscore_D) over non-null domains
```

**Tie-break** — when the top two domains are within 5 points, the earlier entry in this order
wins:

1. Web development
2. CRO
3. Email marketing
4. SEO / local listings
5. Marketing / reputation
6. Social media management

Ordered by directness of revenue attribution for a DTC apparel brand: a broken or missing site
blocks everything; conversion and email changes show measurable revenue effect within weeks;
SEO is slower; reputation and social are hardest to attribute to revenue in a first
engagement. **This ordering is a v0.1 assumption and is a prime candidate for Phase 0
correction** — if reputation findings are what actually produce replies, this order is wrong.

**Evidence requirement.** The winning domain must contain at least one `failed` check with a
stored evidence record. If the highest subscore comes entirely from checks with no evidence,
the record routes to manual review instead (Spec §11.2). Routing must display the reason and
the finding that caused it (Spec §10.3); a route with nothing to display is not a route.

Secondary domains scoring ≥50 are stored as secondary findings but never override the primary.
Operator override is permitted and logged (Spec §10.3).

---

## 7. Calibration protocol

Spec §15.2 requires versioning and comparison. This is the procedure.

### 7.1 What may change, and on what evidence

| Change | Minimum evidence |
|---|---|
| Adjust a signal's points | ≥40 logged outcomes on records where that signal fired |
| Add or remove a signal | Phase 0 evidence, or ≥40 outcomes showing it never discriminates |
| Move a domain weight | ≥100 outcomes attributed to that route |
| Move a tier threshold | ≥200 scored records with outcomes, showing the current cut misplaces them |
| Change the tie-break order | Phase 0 reply-rate data by finding category |

40 is a working floor for seeing a difference at all, not a claim of statistical significance.
Below it, changes are noise-chasing.

### 7.2 One change per version

Each version changes one class of thing. `score_v0.2` may move weights or add signals, not
both. Otherwise a regression cannot be attributed.

### 7.3 Comparison method

1. Freeze a held-out set of scored records with logged outcomes.
2. Recompute both versions over the same stored signals — this is possible only because
   signals are stored, not just scores. **Storing raw signal values per record is what makes
   the model calibratable at all**; without it, every weight change requires re-running paid
   collection.
3. Compare: reply rate by tier, meeting rate by tier, tier-assignment stability, and share of
   Tier 1 records that produced no reply.
4. A version ships only if it improves meeting rate per Tier 1 record without increasing the
   Tier 1 population by more than 20%.

### 7.4 Cold start

At 50–100 qualified leads/week with a realistic meeting rate, the ≥200-outcome threshold for
moving tier cut-offs is roughly **two to three months of operation**. v0.1 is expected to stand
essentially unchanged until then, apart from Phase 0 corrections to the tie-break order and the
audit catalogue's finding set. This is normal and is not evidence that the feedback loop is
broken.

---

## 8. Self-checks

These must hold for the model to be implementable. They are asserted as unit tests in
`packages/core`.

- [ ] Every signal in `problem_free` is cost class **A**. Any B, C, or R signal in the gate
      makes the gate circular. *(Check against §4: WEB W1–W9 all A; CRO C1–C6 A, C7–C8 R
      excluded; SEO S1–S6 A, S7–S10 B excluded; EM E1–E5 A, E6 R excluded; REP P1 A only;
      SOC O1, O5 A only.)*
- [ ] Every signal ID in this document has exactly one matching row in
      `audit-test-catalogue-v0.1.md`, and every catalogue row feeds exactly one signal ID.
- [ ] No signal contributes to more than one domain.
- [ ] Unknown handling: a record where every check is `unavailable` produces `problem = null`
      and routes to manual review, not `problem = 0`.
- [ ] Score output includes the signal array, not only the number.
- [ ] Identical stored signals produce an identical score on repeat execution.
- [ ] Domain weights sum to 1.00.

### 8.1 Known weaknesses of v0.1

Stated plainly so they are not discovered as surprises:

1. **`problem_free` is REP- and SOC-blind.** Reputation and social are almost entirely class B,
   so the gate sees only P1, O1, and O5 from those domains. A brand whose only real problem is
   reputation may fail the gate and never be enriched. If Phase 0 shows reputation findings
   drive replies, the gate must be widened to A+B with a metered Places budget — which changes
   the cost model.
2. **The coverage floor can silently suppress a domain** on sites that block crawling. Blocked
   crawls must be recorded as `unavailable`, never as `passed`.
3. **Thresholds are borrowed, not measured.** The speed bands follow common web-vitals
   convention; the review and follower cut-offs are judgement. All are Phase 0 targets.
4. **Intent leans on Meta Ad Library (N1, N2 = 40 of 100 points).** If commercial-ad API
   coverage turns out to be unavailable for this ICP, Intent loses its strongest signal and the
   40-point High threshold becomes unreachable for most records. Verify before Phase 3.
