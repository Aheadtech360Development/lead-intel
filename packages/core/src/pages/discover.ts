import { classifyPage, type PageType } from "./classify.js";

/**
 * Choosing which pages of a site to audit.
 *
 * The budget is small and the choice matters more than the size of it. A blog-heavy site will offer
 * forty links, thirty of them posts; taking the first eight would audit eight blog posts and never
 * see the services page. So this picks for **variety of page type** first and only then fills up.
 *
 * Pure: links in, a shortlist out. Nothing here fetches.
 */

/** Home plus seven. Raised from the old crawler's four, which could not reach a pricing page. */
export const PAGE_BUDGET = 8;

/**
 * Which types are worth spending the budget on, best first.
 *
 * Ordered by how much a page of that type tells you about whether this business is worth calling.
 * Services and contact describe what they sell and whether you can reach them; a blog post is the
 * least informative page on any small business site, and sits last deliberately.
 */
const TYPE_PRIORITY: PageType[] = [
  "services",
  "contact",
  "products",
  "pricing",
  "about",
  "reviews",
  "blog",
  "other",
];

/**
 * Paths that are machinery rather than pages.
 *
 * Auditing crystaldtf.com pulled in `/customer_authentication/redirect` — a Shopify login bounce —
 * and `/search`, an empty results page. Eight seconds of render time between them, and no checklist
 * has anything to say about either: nobody browses to a login redirect, and a search page with no
 * query is a blank form. Worse, they crowd out a real page that would have fitted in the budget.
 *
 * Matched on path segments so `/pages/about-us` survives while `/account/login` does not.
 */
const UTILITY_PATHS =
  /\/(cart|checkouts?|account|accounts|login|logout|register|signin|sign-in|signup|sign-up|customer_authentication|search|wishlist|compare|password|challenge|apps|admin|wp-admin|wp-login|feed|rss|sitemap[^/]*|privacy|terms|returns?|refund|shipping-policy|cookie)(\/|$|\.)/i;

export interface DiscoveredLink {
  url: string;
  linkText?: string | null;
}

export interface ChosenPage {
  url: string;
  type: PageType;
  /** Why this page was picked, for the record — a page audited for no stated reason is noise. */
  because: string;
}

/**
 * The pages to audit, home first.
 *
 * `homeUrl` is always included and always first: every checklist has something to say about it, and
 * it is the page the operator will look at.
 */
export function choosePages(params: {
  homeUrl: string;
  links: DiscoveredLink[];
  budget?: number;
}): ChosenPage[] {
  const budget = params.budget ?? PAGE_BUDGET;
  const home = normalise(params.homeUrl);
  const chosen: ChosenPage[] = [
    { url: params.homeUrl, type: "home", because: "Every audit starts at the home page." },
  ];
  if (budget <= 1) return chosen;

  const origin = originOf(params.homeUrl);
  const seen = new Set([stripTrailingSlash(home)]);

  // One candidate per URL, classified once. Sites link the same page from the nav, the hero and the
  // footer, and auditing it three times would spend most of the budget on one page.
  const candidates: { url: string; type: PageType; confidence: string }[] = [];
  for (const link of params.links) {
    const url = normalise(link.url, params.homeUrl);
    if (!url) continue;
    if (originOf(url) !== origin) continue;

    const key = stripTrailingSlash(url);
    if (seen.has(key)) continue;
    seen.add(key);

    // Machinery, not pages. Checked after deduplication so the same utility link appearing in the
    // nav and the footer costs one test rather than two.
    if (UTILITY_PATHS.test(pathOf(url))) continue;

    // Skip anything that is plainly a file rather than a page — a PDF price list is worth knowing
    // about, but rendering it in a browser produces no header, no CTA and no structure at all.
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?|csv)$/i.test(pathOf(url))) continue;

    const classified = classifyPage({ url, linkText: link.linkText ?? null });
    if (classified.type === "home") continue;
    candidates.push({ url, type: classified.type, confidence: classified.confidence });
  }

  // First pass: the best example of each type, most useful type first. This is what stops a blog
  // from eating the budget.
  for (const type of TYPE_PRIORITY) {
    if (chosen.length >= budget) break;
    // A confident match beats a guess for the same type — `/contact` over a link merely labelled
    // "get in touch" on a page whose address says nothing.
    const best =
      candidates.find((c) => c.type === type && c.confidence === "likely") ??
      candidates.find((c) => c.type === type);
    if (!best) continue;
    chosen.push({ url: best.url, type, because: `The best ${type} page found on the site.` });
    candidates.splice(candidates.indexOf(best), 1);
  }

  /**
   * Second pass: use spare budget, but only up to a point.
   *
   * **The budget is a ceiling, not a target.** Filling it unconditionally meant a site with seven
   * links — five of them blog posts — got five blog posts audited, which is thirty seconds of
   * render time for a page type that is the least informative on any small business site. Spare
   * budget left unspent is money saved, not opportunity wasted.
   *
   * Two of a type is the most that ever adds anything: a second services page can describe a
   * different service. A second blog post cannot — "do they publish, and how recently" is answered
   * by the first one.
   */
  for (const type of TYPE_PRIORITY) {
    const cap = type === "blog" ? 1 : 2;
    for (const candidate of candidates.filter((c) => c.type === type)) {
      if (chosen.length >= budget) return chosen;
      if (chosen.filter((c) => c.type === type).length >= cap) break;
      chosen.push({ url: candidate.url, type, because: `A second ${type} page, and there was budget left.` });
    }
  }

  return chosen;
}

/** Absolute, fragment- and query-free. A `?utm_source` does not make a different page. */
function normalise(url: string, base?: string): string {
  try {
    const parsed = base ? new URL(url, base) : new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function originOf(url: string): string {
  try {
    // The host without `www.`, so `example.com` and `www.example.com` are one site rather than two.
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
