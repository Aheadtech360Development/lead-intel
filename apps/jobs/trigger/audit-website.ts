import { createDbClient } from "@lead-intel/db";
import { logger, queue, task } from "@trigger.dev/sdk";
import { auditBusiness } from "../src/audit.js";

/**
 * Shared across every website audit. Crawling is I/O-bound and mostly spent waiting, so a modest
 * limit keeps many sites in flight without turning the worker into something that looks like a
 * burst of traffic from one address. Spec §13's own rate limit is per *host* and is enforced
 * inside crawlSite; this limit is about how many different hosts we visit at once.
 */
const auditQueue = queue({ name: "website-audit", concurrencyLimit: 8 });

/**
 * Audits one business's website. The work itself lives in `src/audit.ts` so the identical
 * pipeline can be run directly against the database when verifying against real sites; this task
 * is the queueing, the time budget and the logging around it.
 *
 * **One task per business, deliberately.** Discovery's single long loop already brushes the
 * 30-minute run cap (118 businesses took 17 minutes) and dies entirely when one record fails —
 * which is exactly how the first live Dallas run ended. Crawling is slower still, so the same
 * shape would not survive. Here each run is seconds long, one hostile site cannot take the batch
 * with it, and Trigger.dev's own retry and queue handling does the work that would otherwise be
 * hand-rolled.
 *
 * `maxDuration` is 180 rather than the crawl's own 30-second budget: the budget bounds time spent
 * *fetching*, and a business with a dozen findings also spends time writing them.
 */
export const auditWebsiteTask = task({
  id: "audit-website",
  queue: auditQueue,
  maxDuration: 180,
  run: async (payload: { businessId: string }) => {
    const db = createDbClient();
    const summary = await auditBusiness(db, payload.businessId);

    logger.info("website audited", {
      business: summary.name,
      domain: summary.domain,
      outcome: summary.crawlOutcome,
      presence: summary.status,
      pagesRead: summary.pagesRead,
      problemsFound: summary.problemsFound,
      unmeasured: summary.unmeasured,
      topProblems: summary.topProblems,
    });

    return summary;
  },
});
