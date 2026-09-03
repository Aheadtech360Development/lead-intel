/**
 * Live smoke test for the FREE checks — crawls a handful of real sites and prints what the
 * checks concluded, writing nothing to the database.
 *
 * Run before any batch. Every production bug in this project so far has sat exactly where the
 * code met an external reality the tests had mocked; the habit that keeps catching them is
 * looking at real output by hand before trusting it at scale.
 *
 *   node apps/jobs/smoke-checks.mjs aheadtech360.com tshirtsflorida.com
 */
import { classifyPresence, runFreeChecks } from "@lead-intel/core";
import { crawlSite, isFetchOk } from "@lead-intel/providers";

const domains = process.argv.slice(2);
if (domains.length === 0) {
  console.error("usage: node apps/jobs/smoke-checks.mjs <domain> [domain...]");
  process.exit(1);
}

for (const domain of domains) {
  const startedAt = Date.now();
  const crawl = await crawlSite({ domain });
  const homepage = crawl.homepage;

  const verdict = classifyPresence({
    hasWebsiteOnListing: true,
    domain,
    fetchOutcome: homepage.outcome,
    httpStatus: homepage.status ?? null,
    finalUrl: homepage.finalUrl ?? null,
    html: isFetchOk(homepage) ? homepage.html : null,
  });

  const results = runFreeChecks({
    businessName: domain,
    city: null,
    niche: null,
    domain,
    presence: verdict.status,
    httpsOk: crawl.httpsOk,
    pages: crawl.pages.map((p) => ({ url: p.url, role: p.role, html: p.html, xRobotsTag: p.xRobotsTag })),
    robots: { source: crawl.robots.source, blocksSearchEngines: crawl.robots.blocksSearchEngines },
    sitemapFound: crawl.sitemapFound,
    faviconFound: crawl.faviconFound,
    internalLinks: crawl.internalLinks,
    contactPageUnread: crawl.contactPageUnread,
    now: new Date(),
  });

  const problems = results.filter((r) => r.outcome === "fired" && r.family !== "N");
  const credits = results.filter((r) => r.outcome === "fired" && r.family === "N");
  const unmeasured = results.filter((r) => r.outcome === "not_measured");
  const passed = results.filter((r) => r.outcome === "passed");

  console.log(`\n${"=".repeat(78)}\n${domain}  —  ${verdict.status}  (${Date.now() - startedAt}ms)`);
  console.log(
    `  pages read: ${crawl.pages.map((p) => `${p.role}=${p.url}`).join(", ") || "none"}`,
  );
  console.log(
    `  https=${crawl.httpsOk}  sitemap=${crawl.sitemapFound}  favicon=${crawl.faviconFound}  ` +
      `robots=${crawl.robots.source}  blocksSE=${crawl.robots.blocksSearchEngines}  ` +
      `contactUnread=${crawl.contactPageUnread}  internalLinks=${crawl.internalLinks?.length ?? "null"}`,
  );
  console.log(`  ${problems.length} problems · ${passed.length} clean · ${unmeasured.length} unmeasured`);

  for (const r of problems.slice().sort((a, b) => b.points - a.points)) {
    console.log(`   ✗ ${r.checkId.padEnd(4)} ${String(r.points).padStart(3)}  ${r.evidence}`);
  }
  for (const r of credits) console.log(`   + ${r.checkId.padEnd(4)} ${String(r.points).padStart(3)}  ${r.evidence}`);
  for (const r of unmeasured) console.log(`   ? ${r.checkId.padEnd(4)}      ${r.evidence}`);
  console.log(`   passed: ${passed.map((r) => r.checkId).join(" ")}`);
}
