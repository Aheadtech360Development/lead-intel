import { jobRuns, type Database } from "@lead-intel/db";
import { eq, sql } from "drizzle-orm";

/**
 * Advancing the row the web app created when the operator pressed the button.
 *
 * Every function here **swallows its own failures**. Progress is a courtesy to the person watching;
 * a job must never die because it could not report how far along it was. The alternative was tried
 * in spirit elsewhere in this codebase and is always wrong: an unchecked write that fails silently
 * is a lie, but a *reporting* write that throws takes the real work down with it.
 *
 * The counterpart to this is the honesty rule — `finish()` always writes a reason. A job that ends
 * with a blank detail is indistinguishable, on screen, from one that is still running.
 */

export interface JobProgress {
  /** Says the work has actually begun, and how big it turned out to be. */
  start(total: number | null, step?: string): Promise<void>;
  /** One unit done. `step` is what it is about to do next. */
  tick(step?: string, addCostCents?: number): Promise<void>;
  /** Replaces the current step line without advancing the count. */
  say(step: string): Promise<void>;
  /**
   * Sets the count outright, for a job that reports in batches rather than one at a time.
   *
   * `tick` is a write per unit, which is right when each unit is a browser or a purchase and wrong
   * when it is a millisecond of arithmetic. Scoring four hundred businesses through `tick` would
   * cost four hundred database writes to report on work that takes a few seconds — so it reports
   * every twentieth instead. But `say` alone leaves `done` at zero, which draws a bar frozen at 0%
   * underneath a line of text that is visibly moving. That is worse than no bar.
   */
  setDone(done: number, step?: string): Promise<void>;
  finish(outcome: { ok: boolean; detail: string }): Promise<void>;
  /**
   * True when the operator pressed Stop. Checked between batches by every long loop, so stopping
   * does not depend on how the platform treats child runs already in flight.
   */
  stopped(): Promise<boolean>;
}

export function jobProgress(db: Database, jobRunId: string | null | undefined): JobProgress {
  // A job triggered from a script, a retry, or anywhere that did not create a row still runs. It
  // simply reports to nobody, which is better than refusing to start.
  if (!jobRunId) {
    return {
      async start() {},
      async tick() {},
      async say() {},
      async setDone() {},
      async finish() {},
      async stopped() {
        return false;
      },
    };
  }

  const set = async (values: Record<string, unknown>): Promise<void> => {
    try {
      await db.update(jobRuns).set(values).where(eq(jobRuns.id, jobRunId));
    } catch {
      // Deliberately silent. See the note above.
    }
  };

  return {
    async start(total, step) {
      await set({ status: "running", total, ...(step === undefined ? {} : { step }) });
    },

    async tick(step, addCostCents) {
      try {
        await db
          .update(jobRuns)
          .set({
            // Incremented in SQL rather than read-modify-written, so two workers on the same job
            // cannot lose a count between them.
            status: "running",
            done: sql`${jobRuns.done} + 1`,
            ...(step === undefined ? {} : { step }),
            ...(addCostCents === undefined
              ? {}
              : { costCents: sql`${jobRuns.costCents} + ${String(addCostCents)}` }),
          })
          .where(eq(jobRuns.id, jobRunId));
      } catch {
        // Deliberately silent.
      }
    },

    async say(step) {
      /**
       * Saying anything at all means the work has begun.
       *
       * This was a real bug the first time the banner ran end to end: the audit reported "Opening
       * crystaldtf.com" while the row still said **queued**, because `start()` is only called once
       * the page count is known and the first step happens before that. The operator would have
       * watched a job describe what it was doing while insisting it had not begun.
       */
      await set({ status: "running", step });
    },

    async setDone(done, step) {
      await set({ status: "running", done, ...(step === undefined ? {} : { step }) });
    },

    async stopped() {
      try {
        const [row] = await db.select({ status: jobRuns.status }).from(jobRuns).where(eq(jobRuns.id, jobRunId)).limit(1);
        return row?.status === "failed";
      } catch {
        return false;
      }
    },

    async finish({ ok, detail }) {
      await set({
        status: ok ? "done" : "failed",
        // Always written. A finished row with no reason reads, on screen, exactly like one that is
        // still going.
        detail,
        step: null,
        finishedAt: new Date(),
      });
    },
  };
}
