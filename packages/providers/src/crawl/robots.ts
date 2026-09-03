import robotsParserImport from "robots-parser";
import { CRAWLER_ROBOTS_TOKEN, CRAWLER_USER_AGENT, ROBOTS_TIMEOUT_MS } from "./policy.js";

/**
 * robots-parser ships an `index.d.ts` that opens with the shorthand `declare module
 * 'robots-parser';` and then also declares a default export. TypeScript resolves the import to
 * the namespace rather than the function, so calling it fails to typecheck even though the
 * runtime value is exactly the function we want (verified directly: an ESM default import of
 * this package yields a callable that parses rules and crawl-delays correctly).
 *
 * Rather than sprinkle `any` at the call site, the two methods actually used are declared here.
 * `isAllowed` really can return `undefined` — that is the library saying "no rule matched", not
 * an oversight, and fetchRobots below treats it as such.
 */
interface RobotsTxt {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
  getCrawlDelay(userAgent?: string): number | undefined;
  getSitemaps(): string[];
}
const robotsParser = robotsParserImport as unknown as (url: string, body: string) => RobotsTxt;

/**
 * The user agent S13 is actually about. §5.3's check is "search engines blocked" — not "we were
 * blocked". A site that turns away `AheadTech360LeadBot` while welcoming Google has no SEO
 * problem at all, and telling its owner otherwise would be a sales call built on our own
 * crawler's reflection.
 */
const SEARCH_ENGINE_TOKEN = "Googlebot";

export interface RobotsRules {
  /** May *we* fetch this specific URL? */
  isAllowed(url: string): boolean;
  /** Would a search engine be allowed this URL? Null when there was no robots.txt to read. */
  allowsSearchEngines(url: string): boolean | null;
  /** Sitemap URLs the file declares. Empty when none — the cheapest possible answer to S12. */
  sitemapUrls: string[];
  /** Crawl-delay the site asked for, in ms, if any. Policy's own minimum still applies on top. */
  crawlDelayMs: number | null;
  /**
   * How we came to these rules. "missing" and "unreachable" both mean no robots.txt constrained
   * us — but they are recorded separately because they are different facts about the site, and
   * §13's spirit is that we never blur what we know into what we assume.
   */
  source: "fetched" | "missing" | "unreachable" | "malformed";
}

/**
 * No robots.txt means no restriction — the standard's own default, not an assumption of ours.
 * `allowsSearchEngines` returns null rather than true: "there is no file saying otherwise" is
 * genuinely different from "we read the file and it permits crawling", and S13 needs the
 * difference. A site whose robots.txt we could not reach has not been measured.
 */
function permissive(source: RobotsRules["source"]): RobotsRules {
  return {
    isAllowed: () => true,
    allowsSearchEngines: () => (source === "missing" ? true : null),
    sitemapUrls: [],
    crawlDelayMs: null,
    source,
  };
}

/**
 * Fetches and parses a site's robots.txt. §13: "robots.txt fetched first and respected. A site
 * that blocks everything is recorded as such."
 *
 * Never throws. A site whose robots.txt we cannot read is not a site we get to crawl freely by
 * accident — but neither is it an error worth failing the whole audit over, so the outcome is
 * recorded in `source` and the caller decides what that means.
 */
export async function fetchRobots(params: {
  origin: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<RobotsRules> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? ROBOTS_TIMEOUT_MS);

  let robotsUrl: string;
  try {
    robotsUrl = new URL("/robots.txt", params.origin).toString();
  } catch {
    clearTimeout(timer);
    return permissive("unreachable");
  }

  try {
    const response = await fetchImpl(robotsUrl, {
      method: "GET",
      headers: { "User-Agent": CRAWLER_USER_AGENT },
      signal: controller.signal,
    });

    // 404 is the common, correct case: the site simply has no robots.txt.
    if (response.status === 404 || response.status === 410) return permissive("missing");
    if (!response.ok) return permissive("unreachable");

    const body = await response.text();
    const parsed = robotsParser(robotsUrl, body);

    return {
      isAllowed: (url: string) => {
        // robots-parser returns undefined when it has no opinion; no rule means allowed.
        const verdict = parsed.isAllowed(url, CRAWLER_ROBOTS_TOKEN);
        return verdict !== false;
      },
      allowsSearchEngines: (url: string) => parsed.isAllowed(url, SEARCH_ENGINE_TOKEN) !== false,
      sitemapUrls: safeSitemaps(parsed),
      crawlDelayMs: toDelayMs(parsed.getCrawlDelay(CRAWLER_ROBOTS_TOKEN)),
      source: "fetched",
    };
  } catch {
    return permissive("unreachable");
  } finally {
    clearTimeout(timer);
  }
}

/** getSitemaps() is the one method here not exercised by every crawl, so it is guarded: a parser
 *  surprise on one site must not cost us the robots rules we already read successfully. */
function safeSitemaps(parsed: RobotsTxt): string[] {
  try {
    const sitemaps = parsed.getSitemaps();
    return Array.isArray(sitemaps) ? sitemaps.filter((s) => typeof s === "string" && s.length > 0) : [];
  } catch {
    return [];
  }
}

function toDelayMs(seconds: number | undefined): number | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return null;
  // A site asking for an implausibly long delay would stall the whole audit; cap it and let the
  // per-business time budget be what actually ends the crawl.
  return Math.min(seconds, 30) * 1000;
}
