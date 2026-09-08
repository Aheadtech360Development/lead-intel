import { businesses, createDbClient, findings } from "@lead-intel/db";
import { logger, task } from "@trigger.dev/sdk";
import { jobProgress } from "../src/job-progress.js";
import { and, eq, exists, sql } from "drizzle-orm";
import { scoreAndStore } from "../src/scoring.js";

/**
 * Rescores every analysed business from the findings already stored — no crawling, no cost.
 *
 * This exists because §6's numbers are meant to move. §10.3 names the gate cut-off as **the
 * lever**: "The lever, when a run would cost too much, is raising the gate cut-off — fewer
 * businesses get the paid lookups." Weights and the coverage floor are equally subject to
 * tuning against real outcomes. None of that should cost a re-crawl, and this task is why it
 * does not.
 *
 * Scoring one business is a few milliseconds of arithmetic around two small queries, so unlike
 * the audit this runs as a single loop rather than a fan-out — the whole dataset finishes inside
 * one run comfortably.
 */
export const scoreRunTask = task({
  id: "score-run",
  maxDuration: 900,
  run: async (payload: { runId?: string; limit?: number; jobRunId?: string | null }) => {
    const db = createDbClient();
    const progress = jobProgress(db, payload.jobRunId);

    try {

      const analysed = exists(
        db.select({ one: sql`1` }).from(findings).where(eq(findings.businessId, businesses.id)),
      );
      const conditions = [eq(businesses.status, "active"), analysed];
      if (payload.runId) conditions.push(eq(businesses.discoveredInRun, payload.runId));

      const rows = await db
        .select({ id: businesses.id, name: businesses.displayName })
        .from(businesses)
        .where(and(...conditions))
        .limit(payload.limit ?? 20_000);

      logger.info("rescoring", { count: rows.length });
      await progress.start(rows.length, `Re-scoring ${rows.length} businesses`);

      const tiers = new Map<string, number>();
      let scored = 0;
      let unscorable = 0;
      let passedGate = 0;

      for (const row of rows) {
        const score = await scoreAndStore(db, row.id);
        scored += 1;
        if (score.problemScore === null) unscorable += 1;
        if (score.passedGate) passedGate += 1;
        const key = score.tier === null ? "unscorable" : `tier ${score.tier}`;
        tiers.set(key, (tiers.get(key) ?? 0) + 1);

        // Every twenty rather than every one. Scoring a business is arithmetic and takes
        // milliseconds; a database write per business purely to move a bar would cost more than the
        // work it is reporting on. `setDone` rather than `say`, because `say` leaves the count at
        // zero and draws a bar frozen at 0% under a line of text that is visibly moving.
        if (scored % 20 === 0) await progress.setDone(scored, `Scored ${scored} of ${rows.length}`);
      }

      const summary = { scored, unscorable, passedGate, tiers: Object.fromEntries(tiers) };
      logger.info("rescored", summary);

      await progress.finish({
        ok: true,
        detail:
          `Re-scored ${scored} businesses. ${passedGate} are worth calling, ` +
          `${tiers.get("tier 1") ?? 0} of them Priority 1. ` +
          `${unscorable} could not be scored at all. This cost nothing.`,
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
