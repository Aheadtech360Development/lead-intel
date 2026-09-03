import { createDbClient } from "@lead-intel/db";
import { logger, task } from "@trigger.dev/sdk";
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
  run: async (payload: { businessIds?: string[] }) => {
    const db = createDbClient();
    // An import passes the rows it created; the Categories screen passes nothing and means
    // everything. Both are the same pass over the same rules — only the scope differs.
    const summary = await categoriseAll(db, payload.businessIds);
    logger.info("categorised", { ...summary, scoped: (payload.businessIds ?? []).length > 0 });
    return summary;
  },
});
