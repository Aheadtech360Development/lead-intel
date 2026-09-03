import { pageContentBlindSpot } from "./coverage.js";
import type { PageFacts } from "./parse.js";
import { fired, notMeasured, passed } from "./result.js";
import { LOCAL_BUSINESS_SCHEMA_TYPES } from "./signatures.js";
import type { CheckResult, SiteEvidence } from "./types.js";

/**
 * §5.3 — the FREE half of the SEO area. S1–S8 need Places Details or a rank lookup and are not
 * produced here.
 *
 * S12 and S13 read a probe and robots.txt rather than the page, so they answer even when what
 * came back was a redirect stub. S9, S10, S11 and S14 read the markup and are gated on it.
 */
export function runSeoChecks(evidence: SiteEvidence, pages: PageFacts[]): CheckResult[] {
  const home = pages[0] ?? null;
  const blindSpot = pageContentBlindSpot(pages);
  const alwaysAnswerable = [sitemap(evidence), blockedFromSearch(evidence, home)];

  if (blindSpot !== null || home === null) {
    return ["S9", "S10", "S11", "S14"]
      .map((id) => notMeasured(id, blindSpot ?? "The site could not be read."))
      .concat(alwaysAnswerable);
  }

  return [
    localBusinessSchema(pages),
    pageTitle(pages),
    metaDescription(home),
    titleRelevance(home, evidence),
    ...alwaysAnswerable,
  ];
}

/** S9. Any page carrying the markup counts — many sites put it only on their contact page. */
function localBusinessSchema(pages: PageFacts[]): CheckResult {
  const types = pages.flatMap((page) => page.schemaTypes);
  const localTypes = types.filter((type) => {
    const bare = type.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase();
    return LOCAL_BUSINESS_SCHEMA_TYPES.includes(bare);
  });

  if (localTypes.length > 0) {
    return passed("S9", `The site carries LocalBusiness markup (${[...new Set(localTypes)].join(", ")}).`, {
      types: [...new Set(localTypes)],
    });
  }
  return fired(
    "S9",
    "The site has no LocalBusiness markup, so Google has to guess the business's name, address and hours from the page text.",
    { detail: { schemaTypesFound: [...new Set(types)].slice(0, 10) } },
  );
}

/**
 * S10 — "absent, empty, or repeated". The duplicate half needs at least two pages to mean
 * anything; when only the homepage was read, an absent title still fires and a present one
 * passes with the limitation stated rather than silently assumed away.
 */
function pageTitle(pages: PageFacts[]): CheckResult {
  const home = pages[0];
  if (!home) return notMeasured("S10", "No page was read.");

  if (home.title === null || home.title.length === 0) {
    return fired("S10", "The homepage has no title tag — search results and browser tabs have nothing to show but the URL.");
  }

  const titled = pages.filter((page) => page.title !== null);
  const distinct = new Set(titled.map((page) => (page.title ?? "").toLowerCase()));
  if (titled.length >= 2 && distinct.size < titled.length) {
    return fired("S10", `Pages share the same title ("${home.title}"), so search engines cannot tell them apart.`, {
      detail: { titles: titled.map((page) => page.title) },
    });
  }

  if (pages.length < 2) {
    return passed("S10", `The homepage has a title ("${home.title}"). Only one page was read, so duplicates across pages were not checked.`, {
      title: home.title,
      pagesRead: 1,
    });
  }
  return passed("S10", "Every page read has its own title.", { titles: titled.map((page) => page.title) });
}

function metaDescription(home: PageFacts): CheckResult {
  if (home.metaDescription && home.metaDescription.trim().length > 0) {
    return passed("S11", "The homepage has a meta description.");
  }
  return fired(
    "S11",
    "The homepage has no meta description, so Google writes its own snippet from whatever text it finds first.",
  );
}

function sitemap(evidence: SiteEvidence): CheckResult {
  if (evidence.sitemapFound === true) return passed("S12", "The site publishes a sitemap.");
  if (evidence.sitemapFound === false) {
    return fired("S12", "The site has no sitemap, so search engines have to find its pages by following links alone.");
  }
  return notMeasured("S12", "Whether the site publishes a sitemap could not be established.");
}

/**
 * S13, at 40 points the heaviest FREE check in the SEO area — and the one most easily got wrong.
 *
 * "Search engines blocked" is about *search engines*, not about us. A robots.txt that turns away
 * `AheadTech360LeadBot` while welcoming Googlebot describes our crawler, not the business's
 * visibility, and firing on it would put a 40-point problem on a site that has none. The robots
 * evidence this reads is therefore evaluated against Googlebot (see providers' robots.ts), and
 * the markup half checks `noindex` in both the meta tag and the X-Robots-Tag header — a site can
 * carry no `noindex` anywhere in its HTML and still be de-indexed entirely by that header.
 */
function blockedFromSearch(evidence: SiteEvidence, home: PageFacts | null): CheckResult {
  const robotsBlocks = evidence.robots.blocksSearchEngines;
  const noindexMeta = home?.metaRobots?.includes("noindex") ?? false;
  const noindexHeader = home?.xRobotsTag?.includes("noindex") ?? false;

  if (robotsBlocks === true) {
    return fired("S13", "The site's robots.txt tells search engines not to crawl it — it cannot appear in Google at all.", {
      detail: { source: "robots.txt" },
    });
  }
  if (noindexMeta || noindexHeader) {
    return fired("S13", `The homepage carries a "noindex" instruction (${noindexHeader ? "X-Robots-Tag header" : "meta tag"}), which removes it from Google entirely.`, {
      detail: { source: noindexHeader ? "x-robots-tag" : "meta robots" },
    });
  }
  if (robotsBlocks === null && home === null) {
    return notMeasured("S13", "Neither robots.txt nor the homepage could be read, so indexability is unknown.");
  }
  if (robotsBlocks === null) {
    // The page itself was readable and carries no noindex, which is the larger half of the
    // question — but robots.txt was not, so this is stated rather than glossed over.
    return passed("S13", "The homepage carries no 'noindex' instruction. robots.txt could not be read, so only the page itself was checked.", {
      robotsSource: evidence.robots.source,
    });
  }
  return passed("S13", "Nothing blocks search engines from the site.");
}

/**
 * S14. Needs to know what the business does and where it is; both come from the run and the
 * business record rather than from the page. With neither available there is nothing to look
 * for, and the check says so rather than firing on an empty comparison.
 */
function titleRelevance(home: PageFacts, evidence: SiteEvidence): CheckResult {
  const haystack = `${home.title ?? ""} ${home.headings.join(" ")}`.toLowerCase();
  if (haystack.trim().length === 0) {
    return notMeasured("S14", "The homepage has neither a title nor a heading to check.");
  }

  const city = evidence.city?.trim().toLowerCase() ?? "";
  const niche = evidence.niche?.trim().toLowerCase() ?? "";
  if (city.length === 0 && niche.length === 0) {
    return notMeasured("S14", "Neither the city nor the service is known for this business, so the title could not be judged against them.");
  }

  const cityFound = city.length > 0 && haystack.includes(city);
  // The niche is a search phrase ("screen printing"), so any substantial word from it counts —
  // a title reading "Custom Printing in Miami" is doing the job the check is about.
  const nicheWords = niche.split(/\s+/).filter((word) => word.length >= 4);
  const nicheFound = nicheWords.some((word) => haystack.includes(word));

  if (cityFound || nicheFound) {
    return passed("S14", `The homepage title or heading mentions ${cityFound ? "the city" : "the service"}.`, {
      cityFound,
      nicheFound,
    });
  }
  return fired(
    "S14",
    `Neither "${evidence.city ?? "the city"}" nor the service appears in the homepage title or main heading — the two words someone searching locally would type.`,
    { detail: { title: home.title, headings: home.headings.slice(0, 3) } },
  );
}
