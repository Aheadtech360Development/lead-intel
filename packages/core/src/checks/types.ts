import type { CheckCostClass, CheckFamily, CheckOutcome, ServiceArea, WebsiteStatus } from "@lead-intel/shared";

export type PageRole = "homepage" | "contact" | "about" | "social";

/** One page the crawler actually read. Mirrors providers' CrawledPage without importing it —
 *  packages/core stays independent of any one source of pages. */
export interface SitePage {
  url: string;
  role: PageRole;
  html: string;
  /** The X-Robots-Tag header the page was served with, if any. */
  xRobotsTag?: string | null;
}

/**
 * Everything the FREE checks are allowed to see. Assembled by apps/jobs from a crawl result plus
 * what the business record already knows; nothing in packages/core fetches any of it.
 *
 * Every field that can be *unknown* is typed `| null` rather than defaulted, and the checks treat
 * null as "not measured" rather than as a negative answer. That is the whole discipline of this
 * module in one sentence: a site we could not read must never score as a site with no problems
 * (spec §13).
 */
export interface SiteEvidence {
  businessName: string;
  /** From the business record. Used by S14; null when unknown. */
  city: string | null;
  /** The niche the run searched for. Used by S14; null when unknown. */
  niche: string | null;
  domain: string | null;
  /** The §4 verdict already reached by classifyPresence — W1/W2/W3 are read from it. */
  presence: WebsiteStatus;
  /** true = HTTPS served the site; false = only plain HTTP did; null = neither answered. */
  httpsOk: boolean | null;
  /** Every page read, homepage first. Empty when nothing was readable. */
  pages: SitePage[];
  robots: {
    source: "fetched" | "missing" | "unreachable" | "malformed";
    /** Does robots.txt forbid a *search engine* the homepage? Null when unreadable. */
    blocksSearchEngines: boolean | null;
  };
  /** Does a sitemap exist? Null when nothing could answer. */
  sitemapFound: boolean | null;
  /** Does a favicon exist at /favicon.ico? Null when the probe never ran. */
  faviconFound: boolean | null;
  /** Same-site page URLs linked from the homepage. Null when the homepage was never read. */
  internalLinks: string[] | null;
  /** True when a contact-like page existed but could not be read — see K-family coverage. */
  contactPageUnread: boolean;
  /** The site links to a page that looks like it lists their social profiles, and it was not read. */
  socialPageUnread: boolean;
  /** PageSpeed results for W6/W7. Absent or null when PageSpeed has not run for this business. */
  performance?: PerformanceEvidence | null;
  /** Today, injected so every check is a pure function of its input. */
  now: Date;
}

/**
 * What PageSpeed measured, reduced to what W6 and W7 need. Mirrors the provider's own result
 * without importing it — packages/core stays independent of any one source.
 *
 * Deliberately **not** gated by the crawl's page-content blind spot. PageSpeed runs a real
 * browser, so it measures a single-page app exactly as a visitor experiences it — the one place
 * in this system where an app shell is not an obstacle. A site our crawler could not read can
 * still have a perfectly measurable, and perfectly terrible, load time.
 */
export interface PerformanceEvidence {
  /** Lighthouse performance score, 0-100. Null when the run produced no score. */
  performanceScore: number | null;
  /** Largest Contentful Paint in ms — the metric §5.1's W6 thresholds are written against. */
  lcpMs: number | null;
  /** Why nothing could be measured, when nothing could. Shown to the operator verbatim. */
  unavailableReason?: string | null;
}

export interface CheckResult {
  checkId: string;
  family: CheckFamily;
  area: ServiceArea | null;
  costClass: CheckCostClass;
  outcome: CheckOutcome;
  /** Points earned. Zero unless the outcome is `fired`. */
  points: number;
  /**
   * Points this check put on the table. Zero when it did not run — §6.1: a check that could not
   * run "is left out of both sides. It never counts as a pass and never counts against the
   * business." The database enforces the same rule (findings_points_match_outcome).
   */
  maxPoints: number;
  /** A sentence an operator can read on the business page and act on. */
  evidence: string;
  /** What was actually found. Display and debugging only; never scored. */
  detail?: Record<string, unknown>;
}
