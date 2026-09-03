/**
 * Spec §13's crawl rules, in one place, as constants — so there is exactly one thing to read to
 * know how this crawler behaves, and exactly one thing to change if the policy changes.
 *
 * These are not tuning knobs. §13 opens with "the free website analysis is the heart of the
 * system, so it behaves properly": the rate limit and the honest user agent are how we stay a
 * good citizen on other people's servers, and the timeouts and size cap are how one hostile
 * response fails to take the worker down with it.
 */

/**
 * Identifies us truthfully and gives a site owner somewhere to go. §13: "Honest user agent
 * identifying AheadTech360, with a contact URL. Never disguised as a browser." Anyone reading
 * their access logs can see exactly who this is.
 */
export const CRAWLER_USER_AGENT = "AheadTech360LeadBot/1.0 (+https://aheadtech360.com)";

/** The token robots.txt rules are matched against — the product name, without version or URL. */
export const CRAWLER_ROBOTS_TOKEN = "AheadTech360LeadBot";

/** §13: "15 seconds per request". */
export const REQUEST_TIMEOUT_MS = 15_000;

/** §13: "at most ... 30 seconds per business" — the budget across every request for one site. */
export const PER_BUSINESS_BUDGET_MS = 30_000;

/** §13: "one request at a time per site, at least 2 seconds apart". */
export const MIN_DELAY_BETWEEN_REQUESTS_MS = 2_000;

/** §13: "At most 10 pages ... per business". */
export const MAX_PAGES_PER_BUSINESS = 10;

/**
 * Not in §13, but required by it in spirit: a response large enough to exhaust memory is a
 * failure mode a polite crawler has to survive. Real marketing homepages are far below this.
 */
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Redirect chains beyond this are treated as a loop rather than followed indefinitely. */
export const MAX_REDIRECTS = 5;

/** robots.txt is small; it gets a shorter leash than a page fetch. */
export const ROBOTS_TIMEOUT_MS = 8_000;

/** A sitemap or favicon probe is smaller still, and never worth spending the budget waiting on. */
export const PROBE_TIMEOUT_MS = 8_000;

/**
 * How many *content* pages one audit reads, homepage included. Well under §13's cap of 10, and
 * the real constraint anyway is the 30-second budget: at 2 seconds between requests, plus robots
 * and two small probes, four pages is roughly what fits before the budget — not the page cap —
 * becomes what stops us. Reading fewer pages is not a compromise on accuracy so much as the
 * thing that keeps the accuracy honest: pages we never reached are reported as unmeasured.
 */
export const MAX_CONTENT_PAGES_PER_BUSINESS = 4;

/**
 * URL fragments that mark a page as worth reading beyond the homepage, in priority order.
 *
 * Contact comes first and by a distance. Six of the eight §5.2 contactability checks ask "is X
 * anywhere on the site", and on a real small-business site the phone, the address, the hours and
 * the form all live on /contact rather than the homepage. Judging those from the homepage alone
 * would manufacture findings — the single largest source of false positives available to this
 * system.
 */
export const PRIORITY_PAGE_PATTERNS: { role: "contact" | "about" | "social"; pattern: RegExp }[] = [
  { role: "contact", pattern: /contact|get-?in-?touch|reach-?us|find-?us|book|appointment|quote|estimate|schedule/i },
  {
    // Added after `crystaldtf.com` — a Priority 1 lead — produced four fired social checks worth
    // 95 points while `crystaldtf.com/pages/socials` linked to Facebook, Instagram, TikTok and
    // YouTube. The homepage of that Shopify theme carries no social links at all, so reading the
    // homepage, contact and about pages found nothing and the checks said so with confidence.
    // Telling that owner their socials are not connected would have been wrong out loud, on a
    // call, about the one thing they had clearly bothered to set up.
    role: "social",
    pattern: /social|follow-?us|connect|our-?socials|find-?us-?on|community/i,
  },
  { role: "about", pattern: /about|who-?we-?are|our-?story|services|what-?we-?do|team/i },
];
