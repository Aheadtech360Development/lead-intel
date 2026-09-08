import { createDbClient } from "@lead-intel/db";
import { logger, queue, task } from "@trigger.dev/sdk";
import { auditSite } from "../src/audit-site.js";
import { critiquePages } from "../src/critique-pages.js";
import { jobProgress } from "../src/job-progress.js";

/**
 * The browser audit for one business's website.
 *
 * **`medium-1x`, not the default.** Chromium wants about a gigabyte to itself; the default
 * `small-1x` gives it half of one, and it dies partway through a page with an error that reads like
 * a broken website rather than a starved container.
 *
 * **Concurrency of four.** Trigger.dev's free plan allows twenty concurrent runs, but twenty
 * browsers is twenty gigabytes and a great deal of simultaneous load on other people's servers.
 * Four keeps a 400-site pass inside a couple of hours while staying a polite visitor — the same
 * reasoning the crawler's own limit follows.
 */
export const auditSiteQueue = queue({ name: "audit-site", concurrencyLimit: 4 });

export const auditSiteTask = task({
  id: "audit-site",
  queue: auditSiteQueue,
  machine: "medium-1x",
  // A slow site with eight pages is a few minutes. Ten is a ceiling for something genuinely stuck,
  // not a target.
  maxDuration: 600,
  run: async (payload: { businessId: string; jobRunId?: string | null }) => {
    const db = createDbClient();
    const progress = jobProgress(db, payload.jobRunId);

    try {

      const summary = await auditSite(db, payload.businessId, progress);

      if (summary.failed) {
        // Logged, not thrown. "We could not read their site" is a result about a business, and a
        // thrown error would retry the whole thing three times to learn the same thing.
        logger.warn("site not audited", { businessId: payload.businessId, why: summary.failed });
        await progress.finish({ ok: false, detail: summary.failed });
        return { ...summary, critique: null };
      }

      logger.info("site audited", {
        businessId: payload.businessId,
        pages: summary.pagesAudited,
        readable: summary.pagesReadable,
        seconds: Math.round(summary.elapsedMs / 1000),
        screenshotsStored: summary.screenshotsStored,
      });

      // Surfaced separately, because it is a fact about our configuration rather than their website.
      if (summary.screenshotProblem) {
        logger.warn("screenshots not stored", { businessId: payload.businessId, why: summary.screenshotProblem });
      }

      /**
       * The critique runs here rather than inside `auditSite`, and that separation is on purpose.
       *
       * `auditSite` is about a browser and nothing else — it can be run, tested and reasoned about
       * with no API key and no money involved. Asking a model is a different kind of operation with a
       * different failure mode and a price, so it sits beside the audit rather than inside it.
       *
       * It runs in the same task because an operator pressed one button. Measured cost is roughly
       * $0.0006 a page — under half a cent for a whole site — billed by **Google AI Studio (Gemini)**,
       * whose job here is the one judgement code cannot make: whether the page actually works. Every
       * call is written to `provider_calls`, so that figure stays checkable rather than quoted.
       */
      await progress.say("Asking the model what the measurements miss");
      const critique = await critiquePages(db, payload.businessId);
      logger.info("pages critiqued", {
        businessId: payload.businessId,
        critiqued: critique.critiqued,
        skipped: critique.skipped,
        failed: critique.failed,
        cents: Number(critique.costCents.toFixed(4)),
        stopped: critique.stopped,
      });

      await progress.finish({
        ok: true,
        detail:
          `Read ${summary.pagesAudited} ${summary.pagesAudited === 1 ? "page" : "pages"}, ` +
          `${summary.pagesReadable} of them fully. ` +
          `${summary.screenshotsStored > 0 ? `Kept ${summary.screenshotsStored} screenshot${summary.screenshotsStored === 1 ? "" : "s"}. ` : ""}` +
          `${critique.critiqued} judged by the model` +
          `${critique.costCents > 0 ? `, costing ${critique.costCents.toFixed(2)}¢ of Gemini` : ""}.` +
          // Why the model judged fewer pages than were read. Without this the line said
          // "0 judged by the model." and stopped, which is a result with its reason removed — the
          // exact shape of silent failure this whole product keeps having to fix.
          `${critique.stopped ? ` ${critique.stopped}` : ""}` +
          `${critique.failed > 0 && !critique.stopped ? ` ${critique.failed} could not be judged.` : ""}` +
          `${summary.screenshotProblem ? ` No screenshots kept: ${summary.screenshotProblem}` : ""}`,
      });

      return { ...summary, critique };
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
