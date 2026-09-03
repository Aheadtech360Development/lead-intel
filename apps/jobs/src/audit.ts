import {
  classifyPresence,
  extractContacts,
  findSocialProfiles,
  parsePage,
  runFreeChecks,
  type PresenceEvidence,
  type SiteEvidence,
} from "@lead-intel/core";
import { businesses, describeDbError, identityKeys, runs, type Database } from "@lead-intel/db";
import { crawlSite, isFetchOk, type CrawlSiteResult } from "@lead-intel/providers";
import { and, eq } from "drizzle-orm";
import { upsertFieldMetadata } from "./field-metadata.js";
import { upsertFindings } from "./findings.js";
import { scoreAndStore } from "./scoring.js";

export interface AuditSummary {
  businessId: string;
  name: string;
  domain: string | null;
  status: SiteEvidence["presence"];
  crawlOutcome: PresenceEvidence["fetchOutcome"];
  pagesRead: number;
  problemsFound: number;
  unmeasured: number;
  topProblems: string[];
  problemScore: number | null;
  intentScore: number;
  tier: number | null;
  route: string | null;
  passedGate: boolean;
}

/**
 * Audits one business's website end to end: crawl it under the §13 rules, decide its presence
 * state (spec §4), run every FREE check answerable from what was fetched (§5, §6.3), and record
 * the verdict, the findings, and the evidence behind both.
 *
 * Lives here rather than inside the Trigger.dev task so the whole pipeline can be run directly
 * against the database as well — which is how it gets verified against real sites before a batch.
 * The task is then only queueing and logging around this function, and a local run exercises the
 * same code rather than a second copy of it that could drift.
 */
export async function auditBusiness(db: Database, businessId: string): Promise<AuditSummary> {
  // The niche comes from the run that discovered this business — S14 asks whether the homepage
  // title mentions the service someone would search for, and the run's search term is the only
  // place the system knows what that service is.
  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.displayName,
      city: businesses.city,
      runId: businesses.discoveredInRun,
      niche: runs.niche,
    })
    .from(businesses)
    .leftJoin(runs, eq(businesses.discoveredInRun, runs.id))
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) throw new Error(`business ${businessId} not found`);

  const [domainKey] = await db
    .select({ value: identityKeys.keyValue })
    .from(identityKeys)
    .where(and(eq(identityKeys.businessId, business.id), eq(identityKeys.keyType, "domain")))
    .limit(1);
  const domain = domainKey?.value ?? null;

  const crawl = domain ? await crawlSite({ domain }) : null;
  const evidence = buildPresenceEvidence(domain, crawl);
  const verdict = classifyPresence(evidence);

  const siteEvidence: SiteEvidence = {
    businessName: business.name,
    city: business.city ?? null,
    niche: business.niche ?? null,
    domain,
    presence: verdict.status,
    httpsOk: crawl?.httpsOk ?? null,
    pages:
      crawl?.pages.map((page) => ({
        url: page.url,
        role: page.role,
        html: page.html,
        xRobotsTag: page.xRobotsTag,
      })) ?? [],
    robots: {
      source: crawl?.robots.source ?? "unreachable",
      blocksSearchEngines: crawl?.robots.blocksSearchEngines ?? null,
    },
    sitemapFound: crawl?.sitemapFound ?? null,
    faviconFound: crawl?.faviconFound ?? null,
    internalLinks: crawl?.internalLinks ?? null,
    contactPageUnread: crawl?.contactPageUnread ?? false,
    socialPageUnread: crawl?.socialPageUnread ?? false,
    now: new Date(),
  };

  const results = runFreeChecks(siteEvidence);
  const problems = results
    .filter((r) => r.outcome === "fired" && r.family !== "N")
    .sort((a, b) => b.points - a.points);
  const unmeasured = results.filter((r) => r.outcome === "not_measured");

  try {
    await db
      .update(businesses)
      .set({
        websiteStatus: verdict.status,
        manualReviewStatus: verdict.needsManualReview,
        // Replaces rather than appends: this is the current reason the record needs review, and
        // re-crawling a site that has since recovered must clear the old one.
        manualReviewReasons: verdict.needsManualReview ? ["unclear_website_status"] : [],
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, business.id));

    await upsertFieldMetadata(db, business.id, [
      ...buildCrawlFields(crawl, siteEvidence),
      // The verdict and its reason are stored as fields too, so the record page can show why a
      // business is marked the way it is without re-deriving it.
      { fieldName: "website_status_reason", value: verdict.reason, sourceName: "own_crawl" },
      ...buildContactFields(siteEvidence, domain),
      ...buildSocialProfileFields(siteEvidence),
    ]);

    await upsertFindings(db, business.id, results, {
      sourceName: "own_crawl",
      runId: business.runId ?? null,
    });
  } catch (err) {
    // describeDbError, not err.message: Drizzle's wrapper names the query and hides the cause.
    throw new Error(`failed to record audit for ${business.name}: ${describeDbError(err)}`);
  }

  // Scored from the findings just written, not from the ones in memory — see scoreAndStore for
  // why. It also means scoring is one code path whether it runs here or in a standalone rescore.
  const score = await scoreAndStore(db, business.id);

  return {
    businessId: business.id,
    name: business.name,
    domain,
    status: verdict.status,
    crawlOutcome: evidence.fetchOutcome,
    pagesRead: siteEvidence.pages.length,
    problemsFound: problems.length,
    unmeasured: unmeasured.length,
    topProblems: problems.slice(0, 3).map((r) => `${r.checkId} (${r.points})`),
    problemScore: score.problemScore,
    intentScore: score.intentScore,
    tier: score.tier,
    route: score.route,
    passedGate: score.passedGate,
  };
}

function buildPresenceEvidence(domain: string | null, crawl: CrawlSiteResult | null): PresenceEvidence {
  if (!domain || !crawl) {
    // Nothing to fetch. classifyPresence returns "unclear" here rather than "no website" — see
    // its doc comment for why one check out of §4's three is not enough to claim that.
    return { hasWebsiteOnListing: false, domain: null, fetchOutcome: "not_attempted" };
  }
  const homepage = crawl.homepage;
  return {
    hasWebsiteOnListing: true,
    domain,
    fetchOutcome: homepage.outcome,
    httpStatus: homepage.status ?? null,
    finalUrl: homepage.finalUrl ?? null,
    html: isFetchOk(homepage) ? homepage.html : null,
  };
}

/**
 * The contact details the crawler found on the business's own site, promoted from a by-product of
 * the K7 check into first-class fields.
 *
 * These were already being extracted and stored inside `findings.detail` — 73 of 209 businesses
 * had an email nobody could see, several of them the owner's own. Nothing new is fetched here and
 * nothing costs anything; the same pages the checks already read are read once more.
 */
function buildContactFields(
  site: SiteEvidence,
  domain: string | null,
): { fieldName: string; value: string; sourceName: string }[] {
  if (site.pages.length === 0) return [];

  const contacts = extractContacts(site.pages.map(parsePage), domain);
  const fields: { fieldName: string; value: string; sourceName: string }[] = [];

  if (contacts.email) fields.push({ fieldName: "contact_email", value: contacts.email, sourceName: "own_crawl" });
  if (contacts.allEmails.length > 1) {
    fields.push({
      fieldName: "contact_email_all",
      value: contacts.allEmails.slice(0, 8).join(", "),
      sourceName: "own_crawl",
    });
  }
  if (contacts.phone) {
    fields.push({ fieldName: "contact_phone_web", value: contacts.phone, sourceName: "own_crawl" });
  }
  if (contacts.ownerName) {
    fields.push({ fieldName: "contact_name", value: contacts.ownerName, sourceName: "own_crawl" });
    if (contacts.ownerNameSource) {
      // Where the name came from travels with it. A name whose provenance is invisible is a name
      // an operator has to take on trust, and this system does not ask anyone to do that.
      fields.push({ fieldName: "contact_name_source", value: contacts.ownerNameSource, sourceName: "own_crawl" });
    }
  }

  return fields;
}

/**
 * The social profile URLs the checks found, promoted to fields of their own.
 *
 * They were already being matched and already being thrown away — `runSocialChecks` kept the
 * platform names and dropped the hrefs. Everything that reads those accounts needs the handle:
 * Instagram's follower count and published business category, and whether a Facebook page is
 * running ads. Recovering them from the crawl we already do is free; searching the platforms by
 * business name later would be both a cost and a guess.
 *
 * Stored as the full URL rather than a bare handle. The URL is what was on the page, and the
 * handle is derivable from it — going the other way means inventing the part that was never
 * written down.
 */
function buildSocialProfileFields(site: SiteEvidence): { fieldName: string; value: string; sourceName: string }[] {
  if (site.pages.length === 0) return [];

  const pages = site.pages.map(parsePage);
  const profiles = findSocialProfiles(pages);
  const wanted: Record<string, string> = {
    Instagram: "instagram_url",
    Facebook: "facebook_url",
    TikTok: "tiktok_url",
    LinkedIn: "linkedin_url",
    YouTube: "youtube_url_site",
    X: "x_url",
    Twitter: "x_url",
  };

  return Object.entries(profiles)
    .filter(([name]) => wanted[name] !== undefined)
    .map(([name, href]) => ({ fieldName: wanted[name] as string, value: href, sourceName: "own_crawl" }));
}

function buildCrawlFields(
  crawl: CrawlSiteResult | null,
  site: SiteEvidence,
): { fieldName: string; value: string; sourceName: string }[] {
  if (!crawl) return [];
  const homepage = crawl.homepage;
  const fields = [
    { fieldName: "crawl_outcome", value: homepage.outcome, sourceName: "own_crawl" },
    { fieldName: "crawl_elapsed_ms", value: String(crawl.elapsedMs), sourceName: "own_crawl" },
    { fieldName: "robots_source", value: crawl.robots.source, sourceName: "own_crawl" },
    { fieldName: "pages_read", value: String(site.pages.length), sourceName: "own_crawl" },
  ];
  if (homepage.status !== null && homepage.status !== undefined) {
    fields.push({ fieldName: "http_status", value: String(homepage.status), sourceName: "own_crawl" });
  }
  if (crawl.resolvedUrl) {
    fields.push({ fieldName: "final_url", value: crawl.resolvedUrl, sourceName: "own_crawl" });
  }
  if (isFetchOk(homepage)) {
    const title = extractTitle(homepage.html);
    if (title) fields.push({ fieldName: "page_title", value: title, sourceName: "own_crawl" });
  }

  // A short text digest of what the site says, for the operator's category rules to match against.
  //
  // Deliberately **not** raw HTML, which this project does not store: this is the visible words
  // from the pages already read, collapsed and cut at 2,000 characters. Rules like "if the site
  // says DTF, file it under Printing > DTF" need something to read, and without this they could
  // only look at the business name and the domain — which is where the least specific wording is.
  //
  // Bounded on purpose. It is enough to categorise and far too little to reconstruct a page.
  const digest = site.pages
    .map(parsePage)
    .map((page) => page.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  if (digest.length > 0) {
    fields.push({ fieldName: "site_text", value: digest, sourceName: "own_crawl" });
  }
  if (!isFetchOk(homepage) && homepage.detail) {
    fields.push({ fieldName: "crawl_detail", value: homepage.detail.slice(0, 500), sourceName: "own_crawl" });
  }
  return fields;
}

/** First <title> on the page, trimmed and bounded. One field, and a regex is honest about that —
 *  the real parsing happens in packages/core, where thirty checks share one reviewed surface. */
function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html);
  const text = match?.[1]?.replace(/\s+/g, " ").trim();
  return text && text.length > 0 ? text.slice(0, 200) : null;
}
