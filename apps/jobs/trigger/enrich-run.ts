import { createDbClient } from "@lead-intel/db";
import { DEFAULT_ENRICHMENT_SPEND_CAP_CENTS, type EnrichmentSource } from "@lead-intel/shared";
import { logger, task } from "@trigger.dev/sdk";
import { jobProgress } from "../src/job-progress.js";
import { runEnrichmentSource, type EnrichmentRunResult } from "../src/enrich.js";

/**
 * Buys the paid data an operator explicitly selected and confirmed a price for.
 *
 * Runs here rather than in the web request for the same reason discovery does: the service role
 * key and the provider keys belong to the worker, never to `apps/web`. The website's job is to
 * show a price and take a decision; this task's job is to spend no more than that decision
 * allowed.
 *
 * The cap is shared across sources rather than applied to each. Two sources ticked on one screen
 * are one budget, and a cap that reset per source would let a $5 limit spend $10.
 */
export const enrichRunTask = task({
  id: "enrich-run",
  maxDuration: 900,
  run: async (payload: { businessIds: string[]; sources: EnrichmentSource[]; capCents?: number; jobRunId?: string | null }) => {
    const db = createDbClient();
    const capCents = payload.capCents ?? DEFAULT_ENRICHMENT_SPEND_CAP_CENTS;

    logger.info("enrichment starting", {
      businesses: payload.businessIds.length,
      sources: payload.sources,
      capDollars: (capCents / 100).toFixed(2),
    });

    const progress = jobProgress(db, payload.jobRunId);

    try {
      // Counted in sources, not businesses: one source runs as a batch, so "2 of 3 kinds of data
      // bought" is the only honest denominator available while it is happening.
      await progress.start(payload.sources.length, `Buying ${payload.sources.length} kinds of data`);

      const results: EnrichmentRunResult[] = [];
      let spentCents = 0;

      for (const source of payload.sources) {
        const remaining = capCents - spentCents;
        if (remaining <= 0) {
          logger.warn("spend limit reached — remaining sources not run", { notRun: source });
          await progress.finish({
            ok: true,
            detail:
              `Stopped at your $${(capCents / 100).toFixed(2)} limit. ${source} was not bought. ` +
              `Everything already paid for is safe.`,
          });
          return {
            spentDollars: (spentCents / 100).toFixed(2),
            bought: results.reduce((n, r) => n + r.bought, 0),
            alreadyHad: results.reduce((n, r) => n + r.skippedAlreadyBought, 0),
            couldNotBuy: results.reduce((n, r) => n + r.skippedIneligible, 0),
            failed: results.reduce((n, r) => n + r.failed, 0),
            results,
          };
        }

        await progress.say(`Buying ${source}`);

        const result = await runEnrichmentSource(db, {
          source,
          businessIds: payload.businessIds,
          capCents: remaining,
        });
        spentCents += result.spentCents;
        results.push(result);

        // The spend goes up on screen as it is spent, not after. The operator asked for every price
        // to say what it is for; this one says it is this purchase, so far.
        await progress.tick(`Bought ${result.bought} × ${source}`, result.spentCents);
        logger.info("source finished", { ...result });
      }

      const summary = {
        spentDollars: (spentCents / 100).toFixed(2),
        bought: results.reduce((n, r) => n + r.bought, 0),
        alreadyHad: results.reduce((n, r) => n + r.skippedAlreadyBought, 0),
        couldNotBuy: results.reduce((n, r) => n + r.skippedIneligible, 0),
        failed: results.reduce((n, r) => n + r.failed, 0),
        results,
      };

      logger.info("enrichment finished", { ...summary });

      await progress.finish({
        ok: summary.failed === 0,
        detail:
          `Bought ${summary.bought} for $${summary.spentDollars}. ` +
          `${summary.alreadyHad} were already paid for and cost nothing again. ` +
          `${summary.couldNotBuy} could not be bought at all` +
          `${summary.failed > 0 ? `, and ${summary.failed} failed` : ""}.`,
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
