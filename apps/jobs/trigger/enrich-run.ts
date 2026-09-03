import { createDbClient } from "@lead-intel/db";
import { DEFAULT_ENRICHMENT_SPEND_CAP_CENTS, type EnrichmentSource } from "@lead-intel/shared";
import { logger, task } from "@trigger.dev/sdk";
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
  run: async (payload: { businessIds: string[]; sources: EnrichmentSource[]; capCents?: number }) => {
    const db = createDbClient();
    const capCents = payload.capCents ?? DEFAULT_ENRICHMENT_SPEND_CAP_CENTS;

    logger.info("enrichment starting", {
      businesses: payload.businessIds.length,
      sources: payload.sources,
      capDollars: (capCents / 100).toFixed(2),
    });

    const results: EnrichmentRunResult[] = [];
    let spentCents = 0;

    for (const source of payload.sources) {
      const remaining = capCents - spentCents;
      if (remaining <= 0) {
        logger.warn("spend limit reached — remaining sources not run", { notRun: source });
        break;
      }

      const result = await runEnrichmentSource(db, {
        source,
        businessIds: payload.businessIds,
        capCents: remaining,
      });
      spentCents += result.spentCents;
      results.push(result);

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
    return summary;
  },
});
