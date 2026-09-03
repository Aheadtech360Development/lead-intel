/**
 * Enums shared between packages/core and packages/db.
 * Every value here traces to local-lead-intelligence-specification-v4.0.md.
 * Nothing speculative — only what Phase 1 (identity, normalisation, merge, schema) needs.
 */

// ---------- Identity (spec §7) ----------

export const IDENTITY_KEY_TYPES = [
  "place_id",
  "domain",
  "phone",
  "fb_page_id",
  "name_location",
] as const;
export type IdentityKeyType = (typeof IDENTITY_KEY_TYPES)[number];

/** Lower rank = stronger identity signal. Matches spec §7 table exactly. */
export const IDENTITY_KEY_RANK: Record<IdentityKeyType, 1 | 2 | 3 | 4 | 5> = {
  place_id: 1,
  domain: 2,
  phone: 3,
  fb_page_id: 4,
  name_location: 5,
};

// ---------- Website presence (spec §4) ----------

export const WEBSITE_STATUSES = [
  "no_website",
  "dead",
  "social_only",
  "live",
  "unclear",
] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

// ---------- Business record lifecycle ----------

export const BUSINESS_STATUSES = [
  "active",
  "merged",
  "excluded",
  "suppressed",
] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

/**
 * How a business record came to exist. It is deliberately about *creation*, not about every
 * source that has since contributed a field — `field_metadata.source_name` answers that, per
 * field, and always did.
 *
 * The distinction earns its place because the three are not scored on the same evidence. A
 * `discovered` record carries a Google `place_id`, so all six areas can be measured. An
 * `imported` one never can: a CSV has no place id, Places Details cannot be called without one,
 * and SEO and REP therefore stay below the coverage floor — 36% of the Problem weight. Two
 * Problem scores of 78 do not mean the same thing when one was built from six areas and the
 * other from four, and the list has to be able to say which is which.
 */
export const BUSINESS_ORIGINS = [
  /** Found by a Maps search the operator ran. */
  "discovered",
  /** Created from a row of an uploaded file. */
  "imported",
  /** Typed in by hand on /records/new. */
  "manual",
] as const;
export type BusinessOrigin = (typeof BUSINESS_ORIGINS)[number];

/** What each origin is called on screen, and the one-line explanation that goes with it. */
export const BUSINESS_ORIGIN_LABELS: Record<BusinessOrigin, { label: string; explain: string }> = {
  discovered: {
    label: "Found by search",
    explain: "Found on Google Maps by a search you ran — these have a Google listing, so every check can run.",
  },
  imported: {
    label: "From a file",
    explain:
      "Created from a spreadsheet you uploaded. A file carries no Google listing, so reviews and local-search checks cannot run on these.",
  },
  manual: {
    label: "Added by hand",
    explain: "Typed in on the Add-by-hand form.",
  },
};

export const MANUAL_REVIEW_REASONS = [
  "unclear_website_status",
  "shared_phone",
  "potential_duplicate",
  "no_evidence_for_route",
  "identity_conflict",
  /**
   * The listed website belongs to a booking platform or a national chain, not to this business —
   * so every finding describes that site rather than theirs. See
   * packages/core/src/normalize/shared-domain.ts.
   */
  "shared_domain",
] as const;
export type ManualReviewReason = (typeof MANUAL_REVIEW_REASONS)[number];

export const CLAIM_STATUSES = ["unclaimed", "claimed", "released"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// ---------- Checks and findings (spec §5) ----------

/** FREE = our own crawl + PageSpeed. PAID = metered API. BEST_EFFORT = social read that may be blocked. */
export const CHECK_COST_CLASSES = ["FREE", "PAID", "BEST_EFFORT"] as const;
export type CheckCostClass = (typeof CHECK_COST_CLASSES)[number];

/**
 * fired          — the deficiency condition was true; contributes points
 * passed         — the check ran, condition was not met; contributes 0 but counts toward the
 *                   attainable maximum
 * not_measured   — blocked, timed out, or failed to run; excluded from both sums (spec §13:
 *                   never recorded as a pass)
 * not_applicable — the check does not apply to this business; excluded from both sums
 */
export const CHECK_OUTCOMES = [
  "fired",
  "passed",
  "not_measured",
  "not_applicable",
] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

/** The six check families from spec §5, plus N for the Intent signals in §6.3. */
export const CHECK_FAMILIES = ["W", "K", "S", "R", "O", "D", "N"] as const;
export type CheckFamily = (typeof CHECK_FAMILIES)[number];

// ---------- Scoring and routing (spec §6) ----------

export const SERVICE_AREAS = ["WEB", "SEO", "REP", "CON", "SOC", "ADS"] as const;
export type ServiceArea = (typeof SERVICE_AREAS)[number];

/** Spec §6.1's weights, verbatim. They sum to 1.00 — a test asserts it. */
export const AREA_WEIGHTS: Record<ServiceArea, number> = {
  WEB: 0.24,
  SEO: 0.2,
  REP: 0.16,
  CON: 0.14,
  SOC: 0.14,
  ADS: 0.12,
};

/**
 * §6.1's coverage floor: "If under 40% of an area's possible points were actually measured, the
 * area is marked *not enough data* and excluded from scoring and routing. An area judged on one
 * working check is noise."
 */
export const AREA_COVERAGE_FLOOR = 0.4;

/** §6.2's override floor: no website, dead website, or social only. */
export const PRESENCE_OVERRIDE_PROBLEM_SCORE = 90;

/** §6.4's two thresholds. */
export const TIER_PROBLEM_THRESHOLD = 55;
export const TIER_INTENT_THRESHOLD = 35;

/** §6.3: "Capped at 100." */
export const INTENT_SCORE_CAP = 100;

/**
 * §6.5: the top two areas are treated as tied when they are within this many points, and
 * SERVICE_ROUTES order decides between them.
 */
export const ROUTE_TIE_BREAK_POINTS = 5;

/**
 * The Stage 5 gate (§9): businesses at or above this Problem score are worth buying paid data
 * for; the rest stop here, kept and visible, but nothing further is bought for them.
 *
 * The spec gives no number on purpose — §10.3 names this as **the lever**: "The lever, when a run
 * would cost too much, is raising the gate cut-off — fewer businesses get the paid lookups. The
 * depth of analysis on the ones that do pass is never reduced." §10.2's worked example implies
 * roughly one business in eight passing, which is where this default comes from; it is expected
 * to be tuned against real data rather than treated as settled.
 */
export const GATE_PROBLEM_SCORE = 55;

/** Maps each check family to the area it feeds. N (Intent) does not belong to an area. */
export const CHECK_FAMILY_TO_AREA: Record<Exclude<CheckFamily, "N">, ServiceArea> = {
  W: "WEB",
  K: "CON",
  S: "SEO",
  R: "REP",
  O: "SOC",
  D: "ADS",
};

/** Ordered by routing precedence, spec §6.5. Index order IS the tie-break order. */
export const SERVICE_ROUTES = [
  "web_development",
  "local_seo",
  "reputation",
  "contactability",
  "social_media",
  "advertising",
] as const;
export type ServiceRoute = (typeof SERVICE_ROUTES)[number];

export const AREA_TO_ROUTE: Record<ServiceArea, ServiceRoute> = {
  WEB: "web_development",
  SEO: "local_seo",
  REP: "reputation",
  CON: "contactability",
  SOC: "social_media",
  ADS: "advertising",
};

export const TIERS = [1, 2, 3, 4] as const;
export type Tier = (typeof TIERS)[number];

// ---------- Field provenance ----------

export const VERIFICATION_STATUSES = [
  "verified",
  "unconfirmed",
  "not_found",
  "not_yet_validated",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const TERMS_CLASSIFICATIONS = [
  "first_party",
  "provider",
  "api_restricted",
  "derived",
  "display_only",
] as const;
export type TermsClassification = (typeof TERMS_CLASSIFICATIONS)[number];

// ---------- Runs and pipeline (spec §9) ----------

export const RUN_STATUSES = [
  "planning",
  "running",
  "partial",
  "complete",
  "halted",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Per-cell state for the Places grid search (spec §3.2, Phase 3). "saturated" means the cell hit
 * the 60-result cap and (if MAX_SUBDIVISION_DEPTH allowed) was split into children — recorded
 * explicitly so an incomplete search is visible rather than silently missing businesses
 * (pre-build-risks-and-api-limits.md §2.1).
 */
export const GRID_CELL_STATUSES = ["pending", "done", "saturated", "failed"] as const;
export type GridCellStatus = (typeof GRID_CELL_STATUSES)[number];

export const STAGE_NAMES = [
  "plan",
  "discover",
  "deduplicate",
  "classify_presence",
  "free_analysis",
  "gate",
  "paid_analysis",
  "social_analysis",
  "score_and_route",
  "review",
  "outcome",
] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export const ERROR_CODES = [
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_QUOTA_EXHAUSTED",
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_SCHEMA_INVALID",
  "FETCH_BLOCKED",
  "FETCH_NOT_FOUND",
  "BUDGET_CEILING_REACHED",
  "IDENTITY_CONFLICT",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------- Outreach outcomes ----------

/** Spec §8.2 generates an opening line "for a call and for a message" — two channels only. */
export const OUTREACH_CHANNELS = ["call", "message"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const OUTREACH_RESULTS = [
  "no_answer",
  "not_interested",
  "interested",
  "follow_up_requested",
  "meeting_booked",
  "do_not_contact",
  "invalid_contact",
] as const;
export type OutreachResult = (typeof OUTREACH_RESULTS)[number];

export const OBJECTION_CATEGORIES = [
  "none",
  "price",
  "timing",
  "competition",
  "authority",
  "status_quo",
  "technical",
] as const;
export type ObjectionCategory = (typeof OBJECTION_CATEGORIES)[number];
