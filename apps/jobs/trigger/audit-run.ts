import { businesses, createDbClient, findings } from "@lead-intel/db";
import { logger, task } from "@trigger.dev/sdk";
import { and, eq, notExists, sql } from "drizzle-orm";
import { auditWebsiteTask } from "./audit-website.js";

/** batchTrigger accepts up to 1,000 runs per call on this SDK version; chunking well under that
 *  keeps each call small and makes progress visible in the logs as it goes. */
const BATCH_SIZE = 200;

/**
 * Fans the website audit out across businesses, one child run each.
 *
 * Selection is "has no findings yet" by default, which makes re-running this the natural way to
 * pick up where a previous pass stopped — no separate resume path to get wrong, and no
 * re-crawling of sites already analysed. It is deliberately keyed on `findings` rather than on
 * "has been crawled": a business crawled before a check existed has not been analysed by the
 * checks that exist now, and keying on the crawl would leave it silently behind. Pass
 * `recrawlAll` to override that once the refresh policy (spec §14) actually exists.
 */
export const auditRunTask = task({
  id: "audit-run",
  maxDuration: 600,
  run: async (payload: { runId?: string; limit?: number; recrawlAll?: boolean }) => {
    const db = createDbClient();

    // "Not analysed yet" = no findings row at all. findings is already the record of every check
    // that has run against a business, so it answers this without a new column to keep in sync.
    const notAnalysed = notExists(
      db
        .select({ one: sql`1` })
        .from(findings)
        .where(eq(findings.businessId, businesses.id)),
    );

    const conditions = [eq(businesses.status, "active")];
    if (!payload.recrawlAll) conditions.push(notAnalysed);
    if (payload.runId) conditions.push(eq(businesses.discoveredInRun, payload.runId));

    const rows = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(...conditions))
      .limit(payload.limit ?? 5000);

    if (rows.length === 0) {
      logger.info("nothing to audit", { runId: payload.runId ?? null });
      return { queued: 0 };
    }

    logger.info("queueing website audits", { count: rows.length });

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE);
      // batchTrigger, not batchTriggerAndWait: this parent has no need of the results, and not
      // waiting keeps it off the clock while hundreds of children work through the queue.
      await auditWebsiteTask.batchTrigger(chunk.map((row) => ({ payload: { businessId: row.id } })));
      logger.info("queued batch", { from: i, to: i + chunk.length });
    }

    return { queued: rows.length };
  },
});
