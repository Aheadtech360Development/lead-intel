import { choosePages, classifyPage, extractStructure, type ChosenPage } from "@lead-intel/core";
import { businesses, describeDbError, fieldMetadata, pageAudits, type Database } from "@lead-intel/db";
import { screenshotPath, supabaseStorage } from "@lead-intel/providers";
import { isRenderOk, renderPage, startBrowser, type RenderedPage } from "@lead-intel/providers/render";
import * as cheerio from "cheerio";
import { and, eq } from "drizzle-orm";
import type { JobProgress } from "./job-progress.js";

/**
 * Auditing one business's whole website.
 *
 * **One browser per site, not per page.** Starting Chromium costs about three seconds and a site
 * has up to eight pages; launching per page would roughly triple the machine time, and machine time
 * is exactly what Trigger.dev bills. Measured on real sites: about 38 seconds a site, six seconds a
 * page.
 *
 * The order is fixed by dependency. The home page must be rendered before anything else, because
 * its links are the only way to discover the rest — a site's own navigation is the sitemap that
 * always exists.
 */

export interface SiteAuditSummary {
  businessId: string;
  pagesAudited: number;
  pagesReadable: number;
  types: string[];
  elapsedMs: number;
  /** Set when nothing could be audited at all, with the reason. */
  failed: string | null;
  screenshotsStored: number;
  /**
   * Why no picture was kept, when none was. Reported rather than swallowed: a missing screenshot
   * with no explanation looks identical to a page that had nothing worth showing, and the first
   * time this ran the worker had no storage credentials at all — which would have been an invisible
   * failure repeated across every business on the list.
   */
  screenshotProblem: string | null;
}

/**
 * Screenshots are **kept** only for these. Every page is photographed; the rest are shown to the
 * model and discarded, which is what keeps the whole list inside Supabase's free gigabyte.
 *
 * Read at upload time, never at capture time — see the note in the page loop for what happened when
 * it was read too early.
 */
const SCREENSHOT_TYPES = new Set(["home", "products"]);

export async function auditSite(
  db: Database,
  businessId: string,
  /**
   * Optional on purpose. The audit is run from a script and from tests as well as from the button,
   * and neither of those has a row to report into. Reporting is a courtesy to whoever is watching;
   * requiring it would make the work depend on the audience.
   */
  progress?: JobProgress,
): Promise<SiteAuditSummary> {
  const startedAt = Date.now();
  const empty = {
    businessId,
    pagesAudited: 0,
    pagesReadable: 0,
    types: [] as string[],
    screenshotsStored: 0,
    screenshotProblem: null,
  };

  const [business] = await db
    .select({ displayName: businesses.displayName })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) throw new Error(`business ${businessId} not found`);

  const [urlRow] = await db
    .select({ value: fieldMetadata.value })
    .from(fieldMetadata)
    .where(and(eq(fieldMetadata.businessId, businessId), eq(fieldMetadata.fieldName, "website_url")))
    .limit(1);

  if (!urlRow?.value) {
    // Not an error. A business with no website is a lead, not a failure — see the demand rule in
    // packages/core/src/scoring/demand.ts, which is what surfaces these.
    return { ...empty, elapsedMs: Date.now() - startedAt, failed: "This business has no website to audit." };
  }

  const homeUrl = urlRow.value.startsWith("http") ? urlRow.value : `https://${urlRow.value}`;

  await progress?.say(`Opening ${new URL(homeUrl).hostname}`);
  const started = await startBrowser();
  if (!started.ok) {
    // A fact about our machine, not about them. Recorded as such so a failed run never leaves a
    // business looking like its site is broken.
    return { ...empty, elapsedMs: Date.now() - startedAt, failed: `The browser would not start: ${started.detail}` };
  }

  try {
    const home = await renderPage({
      browser: started.session.browser,
      url: homeUrl,
      screenshot: true,
    });

    let screenshotsStored = 0;
    let screenshotProblem: string | null = null;

    const homeShot = await storeAudit(db, businessId, { url: homeUrl, type: "home", because: "Every audit starts at the home page." }, home, "certain", "It is the site's root address.");
    if (homeShot.path) screenshotsStored += 1;
    screenshotProblem ??= homeShot.problem;

    if (!isRenderOk(home)) {
      return {
        ...empty,
        pagesAudited: 1,
        elapsedMs: Date.now() - startedAt,
        failed: `The home page could not be read (${home.outcome}), so there was nothing to find the other pages from.`,
      };
    }

    // The site's own navigation is the only sitemap that always exists.
    const chosen = choosePages({ homeUrl, links: linksFrom(home.html, homeUrl) });

    // The size is knowable only now, once the home page has been read and its links followed. Said
    // here rather than guessed at the top: a bar that invents its denominator tells the operator
    // something false about how long they are waiting.
    await progress?.start(chosen.length, `Found ${chosen.length} pages worth reading`);
    await progress?.tick("Home page read");
    const types = ["home"];
    let readable = 1;

    for (const page of chosen.slice(1)) {
      /**
       * Always captured, then kept only if the page turns out to be one worth keeping.
       *
       * It used to ask `SCREENSHOT_TYPES.has(page.type)` here, and that was wrong by one step. At
       * this point `page.type` is the guess made from the **address alone**, before the page has
       * been read; the real classification happens two lines below, from the title and headings.
       * So a page the address guessed as "other" and the content proved was the product page was
       * stored as a product page with no picture — because the decision to take one had already
       * been made under the old guess, and there is no going back for it without loading the page
       * a second time.
       *
       * On a real Shopify site that meant both product pages had no screenshot while the operator
       * had specifically asked for exactly those two. Capturing costs a few hundred milliseconds on
       * a page already loaded; uploading is what costs storage, and that decision still waits for
       * the final type.
       */
      const rendered = await renderPage({
        browser: started.session.browser,
        url: page.url,
        screenshot: true,
      });

      // Re-classified now that the page itself can be read. The first classification saw only the
      // address and the link text; the page's own headings are the third opinion, and they are the
      // one that catches a `/shop` with no cart behind it.
      const classification = isRenderOk(rendered)
        ? reclassify(page, rendered)
        : { type: page.type, confidence: "guess" as const, because: "The page could not be read, so its type is only a guess from the address." };

      const shot = await storeAudit(db, businessId, page, rendered, classification.confidence, classification.because, classification.type);
      if (shot.path) screenshotsStored += 1;
      screenshotProblem ??= shot.problem;

      types.push(classification.type);
      if (isRenderOk(rendered)) readable += 1;
      await progress?.tick(`Read ${types.length} of ${chosen.length}: ${page.url.replace(/^https?:\/\/[^/]+/, "") || "/"}`);
    }

    /**
     * Forget pages this audit did not choose.
     *
     * The audit describes the site as it is now, and a row left behind from a previous run does
     * not. This bit itself immediately: an earlier pass had audited `/search` and
     * `/customer_authentication/redirect` before those were recognised as machinery, and after the
     * fix the rows stayed — so the table said nine pages while the audit had chosen seven, and a
     * checklist would have run against two pages the audit no longer believed in.
     *
     * The same applies to a page the business deletes. Keeping it would let an operator open a
     * scorecard for a URL that has been a 404 for a month.
     */
    const kept = new Set(chosen.map((c) => c.url));
    const stale = await db
      .select({ id: pageAudits.id, url: pageAudits.url })
      .from(pageAudits)
      .where(eq(pageAudits.businessId, businessId));

    for (const row of stale) {
      if (!kept.has(row.url)) await db.delete(pageAudits).where(eq(pageAudits.id, row.id));
    }

    return {
      businessId,
      pagesAudited: chosen.length,
      pagesReadable: readable,
      types,
      elapsedMs: Date.now() - startedAt,
      failed: null,
      screenshotsStored,
      screenshotProblem,
    };
  } finally {
    // Always. A leaked browser holds a few hundred megabytes, and across a run that is the
    // difference between finishing and being killed for memory.
    await started.session.close();
  }
}

/** Every href on the page, resolved. Cheerio rather than the browser: the HTML is already here. */
function linksFrom(html: string, baseUrl: string): { url: string; linkText: string | null }[] {
  const $ = cheerio.load(html);
  const out: { url: string; linkText: string | null }[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    try {
      out.push({ url: new URL(href, baseUrl).toString(), linkText: $(el).text().replace(/\s+/g, " ").trim() || null });
    } catch {
      // A malformed href is one bad link, not a reason to stop reading the page.
    }
  });
  return out.slice(0, 500);
}

function reclassify(page: ChosenPage, rendered: RenderedPage & { html: string }) {
  const structure = extractStructure(rendered.html);
  const $ = cheerio.load(rendered.html);

  /**
   * The `<title>` matters as much as the h1, and more often.
   *
   * The first version passed only the h1, and on a real Shopify site every page but one had no h1
   * at all — so the address was the only signal and every page came back `guess`. Those same pages
   * had perfectly clear titles: "Contact Us – Crystal DTF". A classification is only as confident
   * as the number of signals that agree, and throwing one away for no reason made all of them
   * guesses.
   */
  const title = $("title").first().text().replace(/\s+/g, " ").trim() || null;
  const headings = [structure.hero.h1, ...$("h2").slice(0, 5).map((_, el) => $(el).text().trim()).get()].filter(
    (h): h is string => typeof h === "string" && h.length > 0,
  );

  return classifyPage({
    url: page.url,
    title,
    headings,
    // The visible text is what separates a shop from a services page called "shop".
    text: rendered.html.replace(/<[^>]+>/g, " ").slice(0, 20_000),
  });
}

/**
 * The screenshot, uploaded, or null.
 *
 * Kept for the home page and, where there is one, the product page — the two an operator would put
 * in front of a client. Every other page's picture is taken for the model to look at and then
 * discarded, which is what keeps the whole list inside Supabase's free gigabyte.
 *
 * A failed upload costs the picture and nothing else. The measurements are the valuable part of an
 * audit and they are already in hand by this point; losing them because a bucket was full would be
 * the wrong trade entirely.
 */
async function uploadScreenshot(
  businessId: string,
  pageType: string,
  base64: string | null,
): Promise<{ path: string | null; problem: string | null }> {
  // Not a problem: this page's picture was never meant to be kept.
  if (!base64 || !SCREENSHOT_TYPES.has(pageType)) return { path: null, problem: null };

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    // Names only what is actually missing. The first version listed both variables whichever was
    // absent, which sent the operator looking for a setting that was already there.
    const missing = [!url ? "SUPABASE_URL" : null, !key ? "SUPABASE_SERVICE_ROLE_KEY" : null].filter(Boolean);
    return {
      path: null,
      problem:
        `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set on the worker, so ` +
        `screenshots cannot be stored. Everything else in this audit was measured normally.`,
    };
  }

  const storage = supabaseStorage({ url, serviceKey: key });
  const path = screenshotPath(businessId, pageType);
  const result = await storage.put(path, Buffer.from(base64, "base64"), "image/jpeg");
  return result.ok ? { path: result.file.path, problem: null } : { path: null, problem: result.detail };
}

async function storeAudit(
  db: Database,
  businessId: string,
  page: ChosenPage,
  rendered: RenderedPage,
  confidence: string,
  typeBecause: string,
  typeOverride?: string,
): Promise<{ path: string | null; problem: string | null }> {
  const pageType = typeOverride ?? page.type;
  const uploaded = await uploadScreenshot(businessId, pageType, rendered.screenshot);
  const row = {
    businessId,
    url: page.url,
    finalUrl: rendered.finalUrl,
    pageType,
    typeConfidence: confidence,
    chosenBecause: page.because,
    typeBecause,
    outcome: rendered.outcome,
    httpStatus: rendered.status,
    // Only for a page that actually loaded. Structure from a half-rendered page produces findings
    // about a page that never existed.
    structure: isRenderOk(rendered) ? extractStructure(rendered.html) : null,
    layout: rendered.layout,
    screenshotPath: uploaded.path,
    consoleErrors: rendered.consoleErrors,
    failedRequests: rendered.failedRequests,
    elapsedMs: rendered.elapsedMs,
    detail: rendered.detail,
    renderedAt: new Date(),
  };

  try {
    // Re-auditing updates rather than accumulating, so one page never carries two verdicts.
    await db.insert(pageAudits).values(row).onConflictDoUpdate({
      target: [pageAudits.businessId, pageAudits.url],
      set: row,
    });
  } catch (err) {
    throw new Error(`failed to store the audit of ${page.url}: ${describeDbError(err)}`);
  }

  return uploaded;
}
