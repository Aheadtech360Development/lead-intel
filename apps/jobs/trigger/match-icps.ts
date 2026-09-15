import { createDbClient } from "@lead-intel/db";
import { logger, task } from "@trigger.dev/sdk";
import { jobProgress } from "../src/job-progress.js";
import { matchAllIcps } from "../src/match-icps.js";

/**
 * Works out again which ICP every business is.
 *
 * Free, and safe to run as often as the ICPs change — it reads facts already stored and writes a
 * name. That is the point: editing an ICP and seeing the result is meant to be a loop tight enough
 * to actually use, not a batch job somebody schedules.
 */
export const matchIcpsRunTask = task({
  id: "match-icps-run",
  maxDuration: 900,
  run: async (payload: { businessIds?: string[]; jobRunId?: string | null }) => {
    const db = createDbClient();
    // An import passes the rows it created; the ICPs screen passes nothing and means everything.
    // Both are the same pass over the same ICPs — only the scope differs.
    const progress = jobProgress(db, payload.jobRunId);

    try {
      await progress.say("Matching every business against your ICPs");

      const summary = await matchAllIcps(db, payload.businessIds);
      logger.info("matched icps", { ...summary, scoped: (payload.businessIds ?? []).length > 0 });

      await progress.finish({
        ok: true,
        detail: `Put ${summary.matched} into an ICP, cleared ${summary.cleared}, and ${summary.unmatched} matched no ICP at all.`,
      });
      return summary;
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
