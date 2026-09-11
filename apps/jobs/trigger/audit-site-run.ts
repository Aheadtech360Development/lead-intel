import { businesses, createDbClient, fieldMetadata, pageAudits } from "@lead-intel/db";
import { logger, task } from "@trigger.dev/sdk";
import { and, eq, notExists, sql } from "drizzle-orm";
import { jobProgress } from "../src/job-progress.js";
import { auditSiteTask } from "./audit-site.js";

/**
 * The page-by-page audit, across the whole list rather than one business at a time.
 *
 * The single-business version has a button on each record, which is right for checking one lead
 * before ringing it. It is useless for the actual job: there are hundreds of businesses, and
 * "press this button, wait forty seconds, go back, press the next one" is not a workflow anybody
 * would finish.
 *
 * **Selection is "has a website and has never been audited".** That makes re-running this the
 * natural way to pick up where a previous pass stopped — no separate resume path to get wrong, and
 * no risk of paying the model again for pages already judged. Passing explicit ids overrides that,
 * for the case where the operator wants a specific set re-read.
 *
 * Small batches on purpose. Each child run drives a real Chromium against somebody else's server,
 * and the queue behind `audit-site` already limits how many do that at once; chunking here only
 * keeps progress visible while it happens.
 */
const BATCH_SIZE = 8;

export const auditSiteRunTask = task({
  id: "audit-site-run",
  // A few hundred sites at roughly forty seconds each, four at a time. Two hours is the ceiling for
  // something genuinely stuck, not a target.
  maxDuration: 7200,
  run: async (payload: { businessIds?: string[]; limit?: number; jobRunId?: string | null }) => {
    const db = createDbClient();
    const progress = jobProgress(db, payload.jobRunId);

    try {

      const explicit = (payload.businessIds ?? []).filter((id) => id.length > 0);
      const targets = explicit.length > 0 ? explicit : await idsNeedingAudit(db, payload.limit ?? 2000);

      if (targets.length === 0) {
        const detail = "Every business with a website has already been read page by page. Nothing to do.";
        logger.info("nothing to audit");
        await progress.finish({ ok: true, detail });
        return { audited: 0, detail };
      }

      // Known only now, which is why the bar was drawn as a moving stripe until this point.
      await progress.start(targets.length, `Reading ${targets.length} websites, page by page`);
      logger.info("site audit starting", { targets: targets.length, explicit: explicit.length > 0 });

      let audited = 0;
      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        // The operator pressed Stop. Leave now; everything finished so far is kept.
      if (await progress.stopped()) return { stoppedByOperator: true } as never;
      const chunk = targets.slice(i, i + BATCH_SIZE);

        // AndWait so the count on screen is honest: without it this task would finish in a second
        // and report "done" while several hundred browsers were still opening.
        await auditSiteTask.batchTriggerAndWait(chunk.map((id) => ({ payload: { businessId: id } })));

        audited += chunk.length;
        await progress.setDone(audited, `Read ${audited} of ${targets.length} websites`);
        logger.info("audited", { done: audited, of: targets.length });
      }

      await progress.finish({
        ok: true,
        detail:
          `Read ${audited} ${audited === 1 ? "website" : "websites"} page by page. ` +
          `The browser time is billed by Trigger.dev; the page judgements cost roughly ` +
          `${(audited * 0.36).toFixed(0)}¢ of Gemini in total.`,
      });

      logger.info("site audit finished", { audited });
      return { audited, detail: null };
    } catch (err) {
      /**
       * The row must stop saying "running" whatever happens.
       *
       * Without this a task that throws leaves its row `running` for ever, and that is not
       * cosmetic: the banner shows on every screen while anything is running, and reading screens
       * reload themselves every five seconds while it is up. One crashed job would leave the whole
       * product permanently reloading and permanently claiming to be busy, with nothing the
       * operator could press to clear it.
       *
       * Re-thrown afterwards, so Trigger.dev still sees the failure, still retries if configured
       * to, and still records it in its own log. This only makes the operator's screen honest.
       */
      await progress.finish({
        ok: false,
        detail: `It stopped with an error: ${err instanceof Error ? err.message : String(err)}`,
      });
      throw err;
    }
  },
});

/**
 * Businesses with a website that nobody has read page by page yet.
 *
 * A business with no `website_url` is skipped rather than attempted: the audit would open a browser,
 * find nothing to open, and record a failure that reads like a fault of theirs. That is the same
 * distinction the crawler draws between "no website" and "we could not reach it", and it matters
 * for the same reason — one is a fact about them and the other is a fact about us.
 */
async function idsNeedingAudit(db: ReturnType<typeof createDbClient>, limit: number): Promise<string[]> {
  const hasWebsite = sql`exists (
    select 1 from ${fieldMetadata}
    where ${fieldMetadata.businessId} = ${businesses.id}
      and ${fieldMetadata.fieldName} = 'website_url'
      and ${fieldMetadata.value} is not null
      and ${fieldMetadata.value} <> ''
  )`;

  const neverAudited = notExists(
    db.select({ one: sql`1` }).from(pageAudits).where(eq(pageAudits.businessId, businesses.id)),
  );

  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.status, "active"), hasWebsite, neverAudited))
    .limit(limit);

  return rows.map((r) => r.id);
}
