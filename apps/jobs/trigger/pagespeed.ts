import { businesses, createDbClient, fieldMetadata } from "@lead-intel/db";
import { logger, queue, task } from "@trigger.dev/sdk";
import { and, eq, notExists, sql } from "drizzle-orm";
import { pageSpeedBusiness } from "../src/pagespeed.js";

/**
 * PageSpeed runs Lighthouse on Google's own machines, so the limit that matters is their rate
 * limit, not politeness to the site — the requests do not come from us. Google allows a few
 * hundred queries a minute on a keyed project; five at a time stays comfortably inside that while
 * keeping a full pass to a sensible wall-clock time.
 */
const pageSpeedQueue = queue({ name: "pagespeed", concurrencyLimit: 5 });

/**
 * Measures one business's mobile performance (spec §5.1 W6, W7).
 *
 * `maxDuration` is generous because Lighthouse genuinely is: a slow small-business site on a
 * throttled mobile profile regularly takes over a minute, and those are the sites W6 exists to
 * find. Cutting the run short would turn "slow" into "unmeasured" — precisely backwards.
 */
export const pageSpeedTask = task({
  id: "pagespeed",
  queue: pageSpeedQueue,
  maxDuration: 300,
  run: async (payload: { businessId: string }) => {
    const db = createDbClient();
    const summary = await pageSpeedBusiness(db, payload.businessId);
    logger.info("pagespeed measured", { ...summary });
    return summary;
  },
});

/** batchTrigger accepts up to 1,000 runs per call; chunking well under that keeps progress visible. */
const BATCH_SIZE = 200;

/**
 * Fans PageSpeed out across businesses that have not been measured yet.
 *
 * "Not measured" is keyed on a `pagespeed_outcome` field, so a business whose run failed still
 * counts as attempted and is not retried forever on every pass — re-running with `remeasureAll`
 * is the deliberate way to try those again.
 */
export const pageSpeedRunTask = task({
  id: "pagespeed-run",
  maxDuration: 600,
  run: async (payload: { runId?: string; limit?: number; remeasureAll?: boolean }) => {
    const db = createDbClient();

    const notMeasured = notExists(
      db
        .select({ one: sql`1` })
        .from(fieldMetadata)
        .where(and(eq(fieldMetadata.businessId, businesses.id), eq(fieldMetadata.fieldName, "pagespeed_outcome"))),
    );

    const conditions = [eq(businesses.status, "active")];
    if (!payload.remeasureAll) conditions.push(notMeasured);
    if (payload.runId) conditions.push(eq(businesses.discoveredInRun, payload.runId));

    const rows = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(...conditions))
      .limit(payload.limit ?? 5000);

    if (rows.length === 0) {
      logger.info("nothing to measure");
      return { queued: 0 };
    }

    logger.info("queueing PageSpeed runs", { count: rows.length });
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      await pageSpeedTask.batchTrigger(chunk.map((row) => ({ payload: { businessId: row.id } })));
      logger.info("queued batch", { from: i, to: i + chunk.length });
    }

    return { queued: rows.length };
  },
});
