import {
  CHECK_FAMILY_TO_AREA,
  type CheckCostClass,
  type CheckFamily,
  type ServiceArea,
} from "@lead-intel/shared";

/**
 * The catalogue of every check the system knows about, transcribed from
 * local-lead-intelligence-specification-v4.0.md §5.1–§5.6 (deficiency checks) and §6.3 (Intent
 * signals). This file is the single source for check IDs, their point values and their cost
 * class; nothing else in the codebase may invent a check ID or a number of points.
 *
 * **Every** check is listed here, including the PAID and BEST_EFFORT ones that no code runs yet.
 * That is deliberate and costs nothing: §6.1 scores an area over "points available from checks
 * that actually ran", so an unimplemented check simply never produces a finding and never enters
 * either side of the sum. Listing it now means the day it is built, its ID and its weight are
 * already agreed, and it also makes this file readable as what it is — the whole model on one
 * page, next to the spec it came from.
 *
 * `points` is the **maximum** a check can contribute. The tiered checks (W6, W7, R1, R2, O3) can
 * fire for less; a check function returns what it actually earned, never more than this.
 *
 * Two documents in this repository, `scoring-model-v0.1.md` and `audit-test-catalogue-v0.1.md`,
 * describe an *older* numbering in which the same IDs mean different things (v3.2's W5 is LCP;
 * v4.0's W5 is mobile-friendliness). Both are marked SUPERSEDED — DO NOT BUILD FROM THIS at the
 * top. This file follows v4.0 and only v4.0.
 */

export interface CheckDefinition {
  id: string;
  family: CheckFamily;
  /** The service area this feeds, or null for the N family, which feeds Intent instead. */
  area: ServiceArea | null;
  /** What the operator sees as the name of the problem. Spec's own wording. */
  label: string;
  /** Spec's "fires when" column, verbatim enough to be checkable against it. */
  firesWhen: string;
  /** The maximum points this check can contribute. Tiered checks may fire for less. */
  points: number;
  costClass: CheckCostClass;
}

function define(
  id: string,
  label: string,
  firesWhen: string,
  points: number,
  costClass: CheckCostClass,
): CheckDefinition {
  const family = id[0] as CheckFamily;
  return {
    id,
    family,
    area: family === "N" ? null : CHECK_FAMILY_TO_AREA[family as Exclude<CheckFamily, "N">],
    label,
    firesWhen,
    points,
    costClass,
  };
}

/** §5.1 Web presence and quality — sells web development. */
const WEB_CHECKS: CheckDefinition[] = [
  define("W1", "No website at all", "§4 state is 'no website'", 100, "FREE"),
  define("W2", "Website dead or parked", "§4 state is 'dead'", 100, "FREE"),
  define("W3", "Social page only", "§4 state is 'social only'", 90, "FREE"),
  define("W4", "No valid HTTPS", "No certificate, or expired", 30, "FREE"),
  define("W5", "Not mobile-friendly", "No viewport tag and no responsive CSS", 35, "FREE"),
  define("W6", "Slow on mobile", "Load time >4s -> 30; 2.5-4s -> 15", 30, "FREE"),
  define("W7", "Poor performance score", "Under 50 -> 25; 50-89 -> 10", 25, "FREE"),
  define("W8", "Built on a dated platform", "Old Wix / Weebly / GoDaddy builder / abandoned WordPress theme", 15, "FREE"),
  define("W9", "Site looks abandoned", "Copyright year two or more years old", 15, "FREE"),
  define("W10", "Barely a website", "Fewer than 4 real pages", 15, "FREE"),
  define("W11", "No favicon", "Missing", 5, "FREE"),
  define("W12", "Images have no alt text", "More than half missing", 8, "FREE"),
];

/** §5.2 Contactability — sells conversion work. */
const CONTACT_CHECKS: CheckDefinition[] = [
  define("K1", "No phone number on the site", "Not found anywhere", 30, "FREE"),
  define("K2", "Phone is not tap-to-call", "No tel: link on mobile", 12, "FREE"),
  define("K3", "No contact form", "No form with a message field", 20, "FREE"),
  define("K4", "No address shown", "Not found", 15, "FREE"),
  define("K5", "No opening hours", "Not found", 15, "FREE"),
  define("K6", "No map or directions", "Not found", 10, "FREE"),
  define("K7", "No email address", "Not found anywhere", 15, "FREE"),
  define("K8", "No way to request a quote or booking", "No booking widget, quote form, or call-to-action", 15, "FREE"),
];

/** §5.3 Local search and listings — sells local SEO. */
const SEO_CHECKS: CheckDefinition[] = [
  define("S1", "No Google Business Profile", "No listing found", 40, "PAID"),
  define("S2", "Listing unclaimed", "Google shows it as unclaimed", 30, "PAID"),
  define("S3", "No hours on the listing", "Missing", 15, "PAID"),
  define("S4", "Few or no photos", "Fewer than 5", 15, "PAID"),
  define("S5", "No category set", "Missing or generic", 10, "PAID"),
  define("S6", "Listing has no website link", "Missing, or points somewhere broken", 20, "PAID"),
  define("S7", "Does not rank first for its own name", "Position >1", 25, "PAID"),
  define("S8", "Does not rank for 'niche + city'", "Not in the top 10", 25, "PAID"),
  define("S9", "No local business markup", "No LocalBusiness schema on the site", 20, "FREE"),
  define("S10", "Missing or duplicate page title", "Absent, empty, or repeated", 12, "FREE"),
  define("S11", "No meta description", "Missing", 8, "FREE"),
  define("S12", "No sitemap", "Not found", 8, "FREE"),
  define("S13", "Search engines blocked", "robots.txt or noindex blocks the site", 40, "FREE"),
  define("S14", "City or service missing from the title", "Neither appears in the page title or main heading", 15, "FREE"),
];

/** §5.4 Reputation — sells reputation management. Only R6 is readable from the site itself. */
const REPUTATION_CHECKS: CheckDefinition[] = [
  define("R1", "Very few reviews", "Under 10 -> 35; 10-24 -> 20; 25-49 -> 8", 35, "PAID"),
  define("R2", "Weak rating", "Below 4.0 -> 30; 4.0-4.3 -> 12", 30, "PAID"),
  define("R3", "Reviews have dried up", "Nothing in the last 6 months", 25, "PAID"),
  define("R4", "Owner never replies", "No owner response in the last 10 reviews", 20, "PAID"),
  define("R5", "Very slow review growth", "Under one new review a month", 15, "PAID"),
  define("R6", "No reviews shown on their own site", "Not displayed anywhere", 10, "FREE"),
];

/** §5.5 Social presence — sells social media management. */
const SOCIAL_CHECKS: CheckDefinition[] = [
  define("O1", "No social links on the website", "None found in header or footer", 35, "FREE"),
  define("O2", "No Facebook page", "Not found", 25, "FREE"),
  define("O3", "Facebook has gone quiet", "Last post >90 days -> 25; 30-90 days -> 12", 25, "BEST_EFFORT"),
  define("O4", "No Instagram", "Not found", 20, "FREE"),
  define("O5", "Instagram has gone quiet", "Last post >90 days", 20, "BEST_EFFORT"),
  define("O6", "Almost no social footprint", "Fewer than 3 platforms linked", 15, "FREE"),
  define("O7", "Nothing posted anywhere", "No activity on any platform in 90 days", 30, "BEST_EFFORT"),
  define("O8", "No video content", "No YouTube channel or videos", 8, "BEST_EFFORT"),
];

/** §5.6 Advertising — sells ad setup and management. */
const ADS_CHECKS: CheckDefinition[] = [
  define("D1", "No tracking of any kind", "No analytics, no pixel, no tag", 35, "FREE"),
  define("D2", "No Meta Pixel", "Not installed", 20, "FREE"),
  define("D3", "No Google Ads tag", "Not installed", 20, "FREE"),
  define("D4", "No analytics", "No Google Analytics or equivalent", 20, "FREE"),
  define("D5", "Not currently advertising", "No active ads in the Meta Ad Library", 15, "PAID"),
  define("D6", "No retargeting", "Pixel present but no retargeting setup detected", 10, "FREE"),
];

/**
 * §6.3 Intent — are they alive and spending. These are **credits**, not deficiencies: a missing
 * signal adds nothing and never subtracts, which is why they belong to no service area and are
 * summed separately (capped at 100) rather than divided by an attainable total.
 */
const INTENT_SIGNALS: CheckDefinition[] = [
  define("N1", "Has any tracking pixel installed", "Any analytics, pixel or tag present", 20, "FREE"),
  define("N2", "Currently running Meta ads", "Active ads in the Meta Ad Library", 25, "PAID"),
  define("N3", "Got a Google review in the last 30 days", "Most recent review within 30 days", 15, "PAID"),
  define("N4", "Getting 2 or more reviews a month", "Review rate >= 2/month", 10, "PAID"),
  define("N5", "Posted on social in the last 30 days", "Any platform active within 30 days", 15, "BEST_EFFORT"),
  define("N6", "Website updated in the last 12 months", "A dated signal on the site is within 12 months", 10, "FREE"),
  define("N7", "Google listing is claimed", "Listing shows as claimed", 10, "PAID"),
  define("N8", "More than one location", "Multiple locations found", 10, "PAID"),
  define("N9", "Hiring — jobs listed on the site", "A careers or jobs page, or a job posting", 10, "FREE"),
  define("N10", "Pays for a tool — booking, chat, or CRM widget", "A paid third-party widget is embedded", 10, "FREE"),
];

export const CHECK_DEFINITIONS: readonly CheckDefinition[] = [
  ...WEB_CHECKS,
  ...CONTACT_CHECKS,
  ...SEO_CHECKS,
  ...REPUTATION_CHECKS,
  ...SOCIAL_CHECKS,
  ...ADS_CHECKS,
  ...INTENT_SIGNALS,
];

const BY_ID = new Map(CHECK_DEFINITIONS.map((check) => [check.id, check]));

/** Throws rather than returning undefined: an unknown check ID is a bug in this codebase, not a
 *  condition a caller could sensibly handle at runtime. */
export function checkDefinition(id: string): CheckDefinition {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown check id: ${id}`);
  return found;
}
