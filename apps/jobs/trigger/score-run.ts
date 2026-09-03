import { businesses, createDbClient, findings } from "@lead-intel/db";
import { logger, task } from "@trigger.dev/sdk";
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
  run: async (payload: { runId?: string; limit?: number }) => {
    const db = createDbClient();

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
    }

    const summary = { scored, unscorable, passedGate, tiers: Object.fromEntries(tiers) };
    logger.info("rescored", summary);
    return summary;
  },
});
