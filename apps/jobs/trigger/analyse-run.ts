import { businesses, createDbClient, fieldMetadata, findings } from "@lead-intel/db";
import { logger, task } from "@trigger.dev/sdk";
import { and, eq, notExists, sql } from "drizzle-orm";
import { auditWebsiteTask } from "./audit-website.js";
import { categoriseRunTask } from "./categorise.js";
import { pageSpeedTask } from "./pagespeed.js";
import { scoreRunTask } from "./score-run.js";
import { youTubeRunTask } from "./youtube.js";

/**
 * The whole free analysis, end to end, for businesses that have never had it: crawl their site,
 * run every check, measure PageSpeed, then score.
 *
 * It exists because the three steps had only ever been run one at a time from a terminal, and the
 * consequence showed up the first time an operator imported a file. 121 businesses were created,
 * the confirmation said "run the website analysis to score them", and there was no way to do that
 * from the application. They sat in the list reading "Not scored / Couldn't check" — which looks
 * exactly like 121 businesses whose websites are broken, rather than 121 nobody had looked at.
 *
 * **Why this waits where the other run tasks do not.** `audit-run` and `pagespeed-run` fan out with
 * `batchTrigger` and return immediately, which is right for them: discovery kicks them off and has
 * no use for the results. Here the steps genuinely depend on each other — PageSpeed needs a
 * website status the crawl decides, and scoring needs findings that do not exist until both have
 * finished. Firing all three at once would score businesses on an empty findings table and write
 * "nothing is wrong with them", which is the worst available answer.
 *
 * Nothing here costs money. The crawl is ours, PageSpeed is free, scoring is arithmetic. Paid
 * lookups stay where they belong — behind the priced confirm screen on /records/enrich.
 */

/** Chunk size for one batchTriggerAndWait. Well under the SDK's 1,000 so progress stays visible. */
const BATCH_SIZE = 50;

export const analyseRunTask = task({
  id: "analyse-run",
  maxDuration: 3600,
  run: async (payload: {
    businessIds?: string[];
    limit?: number;
    /**
     * Businesses to sort into categories once the analysis has finished. Empty means "do not
     * categorise"; the Categories screen runs its own whole-list pass separately.
     *
     * Done here rather than triggered alongside because a category rule reads the text the crawl
     * produces. Fired in parallel it would sort a freshly imported file on evidence that does not
     * exist yet and file most of it under nothing.
     */
    categoriseIds?: string[];
    /**
     * Sort the **whole list** afterwards rather than a named set.
     *
     * What discovery and the "Analyse them now" button want. Neither of them knows which businesses
     * it is about to create or fix — discovery passes an empty id list meaning "everything without
     * findings" — so neither can name ids to categorise. Re-sorting everything is free, reads only
     * stored text, and is deterministic, so doing it whole costs nothing but a little time and
     * removes the case where a business is analysed and then left uncategorised because the step
     * that would have labelled it had nothing to go on.
     */
    categoriseAll?: boolean;
    /** Set when the operator asked for categories but not for a crawl. */
    skipAnalysis?: boolean;
    /**
     * Re-read businesses that were analysed **before** the crawler learned to store a given field.
     *
     * "Never analysed" is the absence of a findings row, and that definition has a blind spot this
     * exists to cover: a business crawled last month has findings, so every path here skips it —
     * even though the crawler now keeps things it did not keep then. `site_text` is the live case.
     * The code that stores it was written with the category rules; the 292 businesses crawled
     * before that have findings and no page text, so the website half of every category rule has
     * nothing to read and the button that would have fixed it correctly decides there is no work.
     *
     * Naming the missing field rather than adding a "re-crawl everything" flag keeps the pass
     * resumable and self-limiting: it selects exactly what is missing, so running it twice does
     * half the work the second time, and running it after it finishes does none.
     */
    refreshMissingField?: string;
  }) => {
    const db = createDbClient();

    const explicit = (payload.businessIds ?? []).filter((id) => id.length > 0);
    const toCategorise = (payload.categoriseIds ?? []).filter((id) => id.length > 0);

    // Categorise-only: the operator asked for sorting without a crawl, so there is nothing here to
    // wait for. Returning early keeps that from spending an hour of task budget doing no work.
    if (payload.skipAnalysis) {
      let categorised = 0;
      if (payload.categoriseAll) {
        const run = await categoriseRunTask.triggerAndWait({});
        if (run.ok) categorised = run.output.categorised;
      } else if (toCategorise.length > 0) {
        const run = await categoriseRunTask.triggerAndWait({ businessIds: toCategorise });
        if (run.ok) categorised = run.output.categorised;
      }
      // The count that came back, not the count sent. "Sorted 40 of the 121 I looked at" is a
      // different and more useful fact than "asked about 121" — most rules match some and not all.
      logger.info("categorise only", { categorised, asked: toCategorise.length });
      return { audited: 0, measured: 0, categorised, youtube: null };
    }

    // "Never analysed" is the absence of a findings row, the same definition `audit-run` uses.
    // Keyed on findings rather than on "has been crawled" because a business crawled before a
    // check existed has not been analysed by the checks that exist now.
    const toAudit =
      explicit.length > 0
        ? explicit
        : payload.refreshMissingField
          ? await idsMissingField(db, payload.refreshMissingField, payload.limit ?? 5000)
          : await idsWithoutFindings(db, payload.limit ?? 5000);

    logger.info("analysis starting", { toAudit: toAudit.length, explicit: explicit.length > 0 });

    let audited = 0;
    for (let i = 0; i < toAudit.length; i += BATCH_SIZE) {
      const chunk = toAudit.slice(i, i + BATCH_SIZE);
      // AndWait, unlike the other run tasks: PageSpeed below reads the website status this decides.
      await auditWebsiteTask.batchTriggerAndWait(chunk.map((id) => ({ payload: { businessId: id } })));
      audited += chunk.length;
      logger.info("crawled", { done: audited, of: toAudit.length });
    }

    // Re-asked rather than reused. A crawl can end in `no_website` or a temporary DNS failure, and
    // measuring PageSpeed for a site the crawler never reached would spend a request to learn
    // nothing. The `pagespeed_outcome` field is the record of "we already tried this one".
    const toMeasure = await idsWithoutPageSpeed(db, explicit, payload.limit ?? 5000);

    let measured = 0;
    for (let i = 0; i < toMeasure.length; i += BATCH_SIZE) {
      const chunk = toMeasure.slice(i, i + BATCH_SIZE);
      await pageSpeedTask.batchTriggerAndWait(chunk.map((id) => ({ payload: { businessId: id } })));
      measured += chunk.length;
      logger.info("measured", { done: measured, of: toMeasure.length });
    }

    // YouTube (O8) last, because it is the only step that can run out rather than finish. It stops
    // itself when the daily quota is gone and leaves the rest for tomorrow, so putting it here
    // means a quota that ran out never costs the crawl, the speed test or the scores.
    let youtube: { checked: number; remaining: number; stoppedOnQuota: boolean } = {
      checked: 0,
      remaining: 0,
      stoppedOnQuota: false,
    };
    const youtubeRun = await youTubeRunTask.triggerAndWait({});
    if (youtubeRun.ok) youtube = youtubeRun.output;
    else logger.warn("YouTube pass did not complete; scores below are otherwise unaffected");

    // Scores everything analysed, not only this batch. Rescoring is pure arithmetic over findings
    // already stored — no crawl, no cost — and running it whole means one set of weights applies
    // to the entire list rather than the newest rows carrying a different vintage.
    await scoreRunTask.triggerAndWait({});

    // Last, because it is the only step that reads what the crawl wrote. A rule looking for
    // "embroidery" on a website needs the website to have been read first.
    let categorised = 0;
    if (payload.categoriseAll) {
      const run = await categoriseRunTask.triggerAndWait({});
      if (run.ok) categorised = run.output.categorised;
    } else if (toCategorise.length > 0) {
      const run = await categoriseRunTask.triggerAndWait({ businessIds: toCategorise });
      if (run.ok) categorised = run.output.categorised;
    }

    logger.info("analysis finished", { audited, measured, categorised, youtube });
    return { audited, measured, categorised, youtube };
  },
});

async function idsWithoutFindings(
  db: ReturnType<typeof createDbClient>,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        eq(businesses.status, "active"),
        notExists(db.select({ one: sql`1` }).from(findings).where(eq(findings.businessId, businesses.id))),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

/**
 * Businesses with a website that are missing a named field.
 *
 * The website requirement is not decoration. Without it this would keep selecting the 35 businesses
 * that have no site at all, crawl them, fail for the same reason as last time, and select them
 * again on the next run — a backfill that never finishes and reports the same number forever.
 */
async function idsMissingField(
  db: ReturnType<typeof createDbClient>,
  fieldName: string,
  limit: number,
): Promise<string[]> {
  const hasWebsite = sql`exists (
    select 1 from ${fieldMetadata}
    where ${fieldMetadata.businessId} = ${businesses.id}
      and ${fieldMetadata.fieldName} = 'website_url'
  )`;
  const missing = notExists(
    db
      .select({ one: sql`1` })
      .from(fieldMetadata)
      .where(and(eq(fieldMetadata.businessId, businesses.id), eq(fieldMetadata.fieldName, fieldName))),
  );

  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.status, "active"), hasWebsite, missing))
    .limit(limit);
  return rows.map((r) => r.id);
}

async function idsWithoutPageSpeed(
  db: ReturnType<typeof createDbClient>,
  explicit: string[],
  limit: number,
): Promise<string[]> {
  const notMeasured = notExists(
    db
      .select({ one: sql`1` })
      .from(fieldMetadata)
      .where(and(eq(fieldMetadata.businessId, businesses.id), eq(fieldMetadata.fieldName, "pagespeed_outcome"))),
  );

  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.status, "active"), notMeasured))
    .limit(limit);

  const ids = rows.map((r) => r.id);
  return explicit.length > 0 ? ids.filter((id) => explicit.includes(id)) : ids;
}
