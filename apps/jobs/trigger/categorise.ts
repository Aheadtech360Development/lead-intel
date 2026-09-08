import { createDbClient } from "@lead-intel/db";
import { logger, task } from "@trigger.dev/sdk";
import { jobProgress } from "../src/job-progress.js";
import { categoriseAll } from "../src/categorise.js";

/**
 * Re-sorts every business through the operator's current category rules.
 *
 * Free, and safe to run as often as the rules change — it reads text already stored and writes a
 * category. That is the point: editing a rule and seeing the result is meant to be a loop tight
 * enough to actually use, not a batch job somebody schedules.
 */
export const categoriseRunTask = task({
  id: "categorise-run",
  maxDuration: 900,
  run: async (payload: { businessIds?: string[]; jobRunId?: string | null }) => {
    const db = createDbClient();
    // An import passes the rows it created; the Categories screen passes nothing and means
    // everything. Both are the same pass over the same rules — only the scope differs.
    const progress = jobProgress(db, payload.jobRunId);

    try {
      await progress.say("Applying every rule to every business");

      const summary = await categoriseAll(db, payload.businessIds);
      logger.info("categorised", { ...summary, scoped: (payload.businessIds ?? []).length > 0 });

      await progress.finish({
        ok: true,
        detail: `Sorted ${summary.categorised} into a category, cleared ${summary.cleared}, and ${summary.unmatched} matched no rule at all.`,
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
