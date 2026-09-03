import { fetchPage } from "./fetch-page.js";
import { probeUrl, type ProbeVerdict } from "./probe.js";
import { fetchRobots, type RobotsRules } from "./robots.js";
import {
  MAX_CONTENT_PAGES_PER_BUSINESS,
  MAX_PAGES_PER_BUSINESS,
  MIN_DELAY_BETWEEN_REQUESTS_MS,
  PER_BUSINESS_BUDGET_MS,
  PRIORITY_PAGE_PATTERNS,
} from "./policy.js";
import type { FetchPageResult } from "./types.js";

export type PageRole = "homepage" | "contact" | "about" | "social";

export interface CrawledPage {
  url: string;
  role: PageRole;
  html: string;
  status: number;
  /** The X-Robots-Tag header this page was served with, if any. Feeds S13. */
  xRobotsTag: string | null;
}

export interface CrawlSiteParams {
  /** Normalised domain, e.g. "example.com" — schemes are added here, not by the caller. */
  domain: string;
  fetchImpl?: typeof fetch;
  /** Injected so tests do not actually wait out the 2-second politeness delay. */
  sleepImpl?: (ms: number) => Promise<void>;
  budgetMs?: number;
  maxPages?: number;
}

export interface CrawlSiteResult {
  /** The homepage attempt — what presence classification is decided from. */
  homepage: FetchPageResult;
  /** Every page we successfully read, homepage first. Empty when the homepage failed. */
  pages: CrawledPage[];
  /** Which scheme finally answered, if either did. */
  resolvedUrl: string | null;
  /**
   * `true` — HTTPS served the site. `false` — HTTPS did not, but plain HTTP did, which is §5.1's
   * W4 exactly. `null` — neither answered, so nothing is known about the certificate and W4 must
   * report itself unmeasured rather than blame a site that is simply down.
   */
  httpsOk: boolean | null;
  robots: {
    source: RobotsRules["source"];
    blockedHomepage: boolean;
    /** Does robots.txt forbid a search engine the homepage? Null when nothing was readable. */
    blocksSearchEngines: boolean | null;
    sitemapDeclared: boolean;
  };
  /** Does a sitemap exist? Null when neither robots.txt nor the probe could answer. */
  sitemapFound: ProbeVerdict;
  /** Does /favicon.ico exist? Null when the probe could not answer. */
  faviconFound: ProbeVerdict;
  /**
   * Distinct same-site page URLs linked from the homepage. Null when the homepage was never
   * read — the difference between "this site has two pages" and "we never saw the site".
   */
  internalLinks: string[] | null;
  /**
   * True when the homepage linked to a contact-like page that we then failed to read. The §5.2
   * checks must treat "not found" as unmeasured in that case: the page most likely to hold the
   * phone number and the form is precisely the one we missed.
   */
  contactPageUnread: boolean;
  /**
   * True when the homepage links to a page that looks like it lists the business's social
   * profiles and the budget ran out before it could be read.
   *
   * The same admission `contactPageUnread` makes, for the same reason. Social links are not
   * reliably on a homepage — `crystaldtf.com` keeps all four of theirs on `/pages/socials` and
   * none anywhere else — so "we found no social profiles" is only a claim worth making when the
   * page most likely to hold them has actually been read.
   */
  socialPageUnread: boolean;
  pagesFetched: number;
  elapsedMs: number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Crawls one business's site under the §13 rules, which this function is the sole enforcer of:
 * robots.txt first, one request at a time, at least 2 seconds apart, a page cap and a total time
 * budget. Callers get a result, never a raw fetch loop they could accidentally run too fast.
 *
 * HTTPS is tried first and HTTP only as a fallback. That order matters beyond preference: a site
 * reachable on HTTP but not HTTPS is a real finding (§5.1 W4, "no valid HTTPS"), and the fallback
 * is what lets us tell that apart from a site that is simply down.
 *
 * Work is done in **descending value order**, each step guarded by what is left of the budget:
 * robots, homepage, contact page, sitemap probe, favicon probe, about page. When the budget runs
 * out the remaining steps simply do not happen and their results stay `null`, which the checks
 * then report as *not measured*. Degrading into silence rather than into a guess is the whole
 * design: a slow site should cost us findings, never accuracy.
 */
export async function crawlSite(params: CrawlSiteParams): Promise<CrawlSiteResult> {
  const sleep = params.sleepImpl ?? defaultSleep;
  const budgetMs = params.budgetMs ?? PER_BUSINESS_BUDGET_MS;
  const maxPages = Math.min(params.maxPages ?? MAX_CONTENT_PAGES_PER_BUSINESS, MAX_PAGES_PER_BUSINESS);
  const startedAt = Date.now();
  const remaining = () => budgetMs - (Date.now() - startedAt);
  const fetchImplOption = params.fetchImpl ? { fetchImpl: params.fetchImpl } : {};

  const origin = `https://${params.domain}`;
  const robots = await fetchRobots({ origin, ...fetchImplOption });

  let requestsMade = 0;
  let pagesFetched = 0;

  /** §13's politeness delay before every request after the first, plus whatever the site asked
   *  for. Returns false when there is not enough budget left to both wait and fetch. */
  const waitTurn = async (): Promise<boolean> => {
    if (requestsMade === 0) return remaining() > 0;
    const delay = Math.max(MIN_DELAY_BETWEEN_REQUESTS_MS, robots.crawlDelayMs ?? 0);
    if (remaining() <= delay) return false;
    await sleep(delay);
    return remaining() > 0;
  };

  const finish = (over: Partial<CrawlSiteResult>): CrawlSiteResult => ({
    homepage: {
      outcome: "fetch_failed",
      finalUrl: null,
      status: null,
      detail: "no attempt completed within the time budget",
      elapsedMs: Date.now() - startedAt,
    },
    pages: [],
    resolvedUrl: null,
    httpsOk: null,
    robots: {
      source: robots.source,
      blockedHomepage: false,
      blocksSearchEngines: robots.allowsSearchEngines(`${origin}/`) === null ? null : !robots.allowsSearchEngines(`${origin}/`),
      sitemapDeclared: robots.sitemapUrls.length > 0,
    },
    sitemapFound: robots.sitemapUrls.length > 0 ? true : null,
    faviconFound: null,
    internalLinks: null,
    contactPageUnread: false,
    socialPageUnread: false,
    pagesFetched,
    elapsedMs: Date.now() - startedAt,
    ...over,
  });

  // ---------- 1. homepage, HTTPS first ----------

  const candidates: { url: string; https: boolean }[] = [
    { url: `https://${params.domain}/`, https: true },
    { url: `http://${params.domain}/`, https: false },
  ];

  let homepage: FetchPageResult | null = null;
  let httpsOk: boolean | null = null;
  let resolvedUrl: string | null = null;

  for (const candidate of candidates) {
    if (!robots.isAllowed(candidate.url)) {
      // Their site, their rules. Recorded as its own outcome so it can never be mistaken for
      // either a healthy site or a broken one.
      return finish({
        homepage: {
          outcome: "blocked_by_robots",
          finalUrl: candidate.url,
          status: null,
          detail: null,
          elapsedMs: Date.now() - startedAt,
        },
        robots: {
          source: robots.source,
          blockedHomepage: true,
          blocksSearchEngines: robots.allowsSearchEngines(candidate.url) === null ? null : !robots.allowsSearchEngines(candidate.url),
          sitemapDeclared: robots.sitemapUrls.length > 0,
        },
      });
    }

    if (!(await waitTurn())) break;

    const result = await fetchPage({ url: candidate.url, ...fetchImplOption });
    requestsMade += 1;
    pagesFetched += 1;
    homepage = result;

    if (result.outcome === "ok") {
      httpsOk = candidate.https;
      resolvedUrl = result.finalUrl;
      break;
    }
    if (candidate.https && result.outcome === "tls_failure") {
      httpsOk = false; // recorded now; the HTTP attempt below decides whether the site is alive
    }

    // A DNS failure is the only crawl outcome that produces "dead" on its own, at 100 points and
    // with no manual review — someone acts on it by phoning a business and offering to rebuild
    // their site. One failed lookup is thin evidence for that, and a resolver that answers on the
    // second attempt is common enough that this pays for itself. The budget guard means a genuinely
    // dead domain costs one extra second, and a live one stops being condemned by a blip.
    if (result.outcome === "dns_failure" && (await waitTurn())) {
      const retry = await fetchPage({ url: candidate.url, ...fetchImplOption });
      requestsMade += 1;
      pagesFetched += 1;
      homepage = retry;
      if (retry.outcome === "ok") {
        httpsOk = candidate.https;
        resolvedUrl = retry.finalUrl;
        break;
      }
      // Two different answers mean the resolver is unreliable, not that the domain is absent.
      if (retry.outcome !== "dns_failure") {
        homepage = { ...retry, outcome: retry.outcome === "dns_temporary" ? "dns_temporary" : retry.outcome };
      }
    }
    // An HTTP-level answer (4xx/5xx) or a served non-page means the host is up and has spoken.
    // Retrying over plain HTTP would not change that answer, so we stop rather than spend a
    // second request to be told the same thing.
    if (result.outcome === "http_error" || result.outcome === "not_html" || result.outcome === "too_large") {
      break;
    }
  }

  if (homepage === null || homepage.outcome !== "ok") {
    return finish({
      ...(homepage ? { homepage } : {}),
      // Nothing answered on either scheme: this says the site is unreachable, not that its
      // certificate is bad. W4 must stay unmeasured rather than fire on a site that is down.
      httpsOk: null,
    });
  }

  const pages: CrawledPage[] = [
    {
      url: homepage.finalUrl,
      role: "homepage",
      html: homepage.html,
      status: homepage.status,
      xRobotsTag: homepage.xRobotsTag,
    },
  ];

  // ---------- 2. pick the pages worth reading next ----------

  const internalLinks = extractInternalLinks(homepage.html, homepage.finalUrl);
  const queue = selectPriorityPages(internalLinks, homepage.finalUrl);
  const contactCandidate = queue.find((page) => page.role === "contact") ?? null;
  const socialCandidate = queue.find((page) => page.role === "social") ?? null;

  for (const target of queue) {
    if (pages.length >= maxPages) break;
    if (!robots.isAllowed(target.url)) continue;
    if (!(await waitTurn())) break;

    const result = await fetchPage({ url: target.url, ...fetchImplOption });
    requestsMade += 1;
    pagesFetched += 1;
    if (result.outcome === "ok") {
      pages.push({
        url: result.finalUrl,
        role: target.role,
        html: result.html,
        status: result.status,
        xRobotsTag: result.xRobotsTag,
      });
    }

    // The contact page is the one worth spending the budget on; everything after it is a bonus,
    // so the probes go next and the about page waits until they are done.
    if (target.role === "contact") break;
  }

  const contactRead = pages.some((page) => page.role === "contact");
  const contactPageUnread = contactCandidate !== null && !contactRead;

  // ---------- 3. small probes: sitemap (S12) and favicon (W11) ----------

  let sitemapFound: ProbeVerdict = robots.sitemapUrls.length > 0 ? true : null;
  if (sitemapFound === null) {
    const sitemapUrl = safeUrl("/sitemap.xml", homepage.finalUrl);
    if (sitemapUrl && robots.isAllowed(sitemapUrl) && (await waitTurn())) {
      const probe = await probeUrl({ url: sitemapUrl, expect: "xml", ...fetchImplOption });
      requestsMade += 1;
      sitemapFound = probe.found;
    }
  }

  let faviconFound: ProbeVerdict = null;
  const faviconUrl = safeUrl("/favicon.ico", homepage.finalUrl);
  if (faviconUrl && robots.isAllowed(faviconUrl) && (await waitTurn())) {
    const probe = await probeUrl({ url: faviconUrl, expect: "image", ...fetchImplOption });
    requestsMade += 1;
    faviconFound = probe.found;
  }

  // ---------- 4. whatever budget is left goes to the remaining pages ----------

  for (const target of queue) {
    if (pages.length >= maxPages) break;
    if (pages.some((page) => page.url === target.url)) continue;
    if (target.role === "contact" && contactRead) continue;
    if (!robots.isAllowed(target.url)) continue;
    if (!(await waitTurn())) break;

    const result = await fetchPage({ url: target.url, ...fetchImplOption });
    requestsMade += 1;
    pagesFetched += 1;
    if (result.outcome === "ok") {
      pages.push({
        url: result.finalUrl,
        role: target.role,
        html: result.html,
        status: result.status,
        xRobotsTag: result.xRobotsTag,
      });
    }
  }

  return finish({
    homepage,
    pages,
    resolvedUrl,
    httpsOk,
    robots: {
      source: robots.source,
      blockedHomepage: false,
      blocksSearchEngines:
        robots.allowsSearchEngines(homepage.finalUrl) === null ? null : !robots.allowsSearchEngines(homepage.finalUrl),
      sitemapDeclared: robots.sitemapUrls.length > 0,
    },
    sitemapFound,
    faviconFound,
    internalLinks,
    contactPageUnread,
    socialPageUnread: socialCandidate !== null && !pages.some((page) => page.role === "social"),
  });
}

/**
 * Same-site page URLs linked from a page, deduplicated and normalised.
 *
 * A deliberately plain regex rather than a parser. Its job here is navigation — deciding which
 * URL to request next — and being approximate about that costs nothing: a link it misses is a
 * page we do not visit. The analytical reading of a page (how many pages, which platforms, what
 * markup) happens in packages/core with a real HTML parser, where being approximate would
 * instead cost a wrong finding.
 */
export function extractInternalLinks(html: string, baseUrl: string): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const found = new Map<string, string>();
  const hrefPattern = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

  for (const match of html.matchAll(hrefPattern)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (raw.length === 0) continue;
    if (/^(#|mailto:|tel:|javascript:|sms:|data:)/i.test(raw)) continue;

    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (!sameSite(url.hostname, base.hostname)) continue;
    // Files, not pages. Counting a PDF as one of a site's four pages would flatter it.
    if (/\.(pdf|jpe?g|png|gif|webp|svg|ico|css|js|zip|mp4|mp3|docx?|xlsx?)$/i.test(url.pathname)) continue;

    url.hash = "";
    const key = url.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    if (key === "/" || key === "") continue; // the homepage itself is not a second page
    if (!found.has(key)) found.set(key, url.toString());
  }

  return [...found.values()];
}

/** Treats www and the bare host as the same site, and any subdomain of it as part of it too. */
function sameSite(host: string, baseHost: string): boolean {
  const strip = (h: string) => h.replace(/^www\./i, "").toLowerCase();
  const a = strip(host);
  const b = strip(baseHost);
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

/** Orders the candidate links by how much a check needs them, contact first. */
function selectPriorityPages(links: string[], baseUrl: string): { url: string; role: PageRole }[] {
  const picked: { url: string; role: PageRole }[] = [];
  const taken = new Set<string>();

  for (const { role, pattern } of PRIORITY_PAGE_PATTERNS) {
    for (const link of links) {
      if (taken.has(link)) continue;
      let path: string;
      try {
        path = new URL(link, baseUrl).pathname;
      } catch {
        continue;
      }
      if (!pattern.test(path)) continue;
      taken.add(link);
      picked.push({ url: link, role });
      break; // one page per role is enough; the budget is better spent elsewhere
    }
  }

  return picked;
}

function safeUrl(path: string, base: string): string | null {
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}
