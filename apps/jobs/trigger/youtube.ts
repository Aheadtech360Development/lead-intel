import { businesses, createDbClient, fieldMetadata } from "@lead-intel/db";
import { logger, queue, task } from "@trigger.dev/sdk";
import { and, eq, notExists, sql } from "drizzle-orm";
import { youTubeBusiness } from "../src/youtube.js";

/**
 * Two at a time. Unlike the crawl, the limit here is not politeness to a server — it is YouTube's
 * daily quota, and going faster does not buy more lookups. It only reaches the ceiling sooner and
 * makes the stop messier.
 */
const youTubeQueue = queue({ name: "youtube", concurrencyLimit: 2 });

export const youTubeTask = task({
  id: "youtube",
  queue: youTubeQueue,
  maxDuration: 120,
  run: async (payload: { businessId: string }) => {
    const db = createDbClient();
    const summary = await youTubeBusiness(db, payload.businessId);
    logger.info("youtube checked", { ...summary });
    return summary;
  },
});

/**
 * Looks up every business that has not been checked, and **stops when the quota runs out**.
 *
 * The stop is the whole design. YouTube allows 10,000 units a day and finding a channel by name
 * costs 100 of them, so roughly 100 businesses fit in a day and a few hundred take several. Every
 * other failure in this system is a fact about one business and the pass should carry on; running
 * out of quota is a fact about the day. Carrying on would write "we looked and found nothing"
 * against businesses nobody looked at — and because a stored outcome is what marks a business as
 * done, those would then be skipped forever.
 *
 * Nothing is written for the business that hit the wall, so re-running tomorrow resumes exactly
 * where this stopped.
 */
export const youTubeRunTask = task({
  id: "youtube-run",
  maxDuration: 3600,
  run: async (payload: { limit?: number; recheck?: boolean }) => {
    const db = createDbClient();

    const notLookedUp = notExists(
      db
        .select({ one: sql`1` })
        .from(fieldMetadata)
        .where(and(eq(fieldMetadata.businessId, businesses.id), eq(fieldMetadata.fieldName, "youtube_outcome"))),
    );

    const conditions = [eq(businesses.status, "active")];
    if (!payload.recheck) conditions.push(notLookedUp);

    const rows = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(...conditions))
      .limit(payload.limit ?? 5000);

    if (rows.length === 0) {
      logger.info("nothing to look up on YouTube");
      return { checked: 0, remaining: 0, stoppedOnQuota: false };
    }

    logger.info("checking YouTube", { count: rows.length });

    // Sequential rather than a fan-out, precisely so the quota stop can be honoured. A
    // `batchTrigger` of 300 children cannot be called off partway through.
    let checked = 0;
    for (const [index, row] of rows.entries()) {
      const summary = await youTubeBusiness(db, row.id);
      if (summary.quotaExhausted) {
        logger.info("daily quota reached — stopping", { checked, remaining: rows.length - index });
        return { checked, remaining: rows.length - index, stoppedOnQuota: true };
      }
      checked += 1;
    }

    return { checked, remaining: 0, stoppedOnQuota: false };
  },
});
