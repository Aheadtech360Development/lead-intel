/**
 * The one place that checks whether a background job can actually be started.
 *
 * Two failures live here, and the second is the dangerous one.
 *
 * **No key.** The Trigger.dev SDK throws `You need to set the TRIGGER_API_URL and
 * TRIGGER_SECRET_KEY environment variables`, which is accurate and tells an operator nothing about
 * where to put it. That is what production actually did when "Find businesses" was pressed.
 *
 * **A dev key in production.** This one fails *silently*, which makes it worse. `tr_dev_…` is
 * accepted, the job is enqueued successfully, and it goes to the development environment — where
 * the only worker is a `trigger dev` process on somebody's laptop. With the laptop shut, the job
 * sits in a queue nobody is reading, for ever. Nothing errors. Nothing runs. The operator's report
 * was exactly this shape: *"shayad usne run kerdia tha lekin pata nhi chal raha tha"*.
 *
 * So the key is inspected before it is used, and both cases are named in words that say what to do.
 */

export type EnqueueBlock = { blocked: true; why: string } | { blocked: false };

/** True on Vercel's production deployment, false in preview and on a laptop. */
function isProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/**
 * Why this job cannot be started, or nothing.
 *
 * Checked before the SDK is called at all, so the message an operator reads is written for them
 * rather than for whoever wrote the SDK.
 */
export function enqueueBlockedBecause(): EnqueueBlock {
  const key = process.env.TRIGGER_SECRET_KEY;

  if (!key) {
    return {
      blocked: true,
      why:
        "Nothing ran: this site has no TRIGGER_SECRET_KEY, so it cannot reach the machine that does " +
        "background work. Add it in Vercel under Settings → Environment Variables, using the " +
        "PRODUCTION key from Trigger.dev: open your project, switch the environment to Production, then " +
        "the API keys page. It begins tr_prod_. Then redeploy this site.",
    };
  }

  /**
   * Anything that is not a production key, checked by what it *is* rather than by what it is not.
   *
   * Trigger.dev's own documentation is explicit that the environments are sealed off from each
   * other — "a Development key cannot access Production, and a Production key cannot access
   * Staging" — and that production keys are the ones beginning `tr_prod_`. So the test is whether
   * the key is a production one, not whether it is a development one: written the other way it
   * would wave a `tr_preview_sk_…` key straight through, which fails in exactly the same silent
   * way and would have to be found all over again.
   */
  if (isProduction() && !key.startsWith("tr_prod_")) {
    const kind = key.startsWith("tr_dev_") ? "DEVELOPMENT" : key.startsWith("tr_preview_") ? "PREVIEW" : "non-production";
    return {
      blocked: true,
      why:
        `Nothing ran: this live site is using a Trigger.dev ${kind} key. Jobs sent with it go to a ` +
        "different environment from the one the live worker runs in — for a development key that is " +
        "the `trigger dev` process on your own computer — so on the live site they queue up and never " +
        "run, with no error at all. Replace TRIGGER_SECRET_KEY in Vercel with the production key " +
        "(it begins tr_prod_) and redeploy.",
    };
  }

  return { blocked: false };
}

/**
 * Turns whatever the SDK threw into something an operator can act on.
 *
 * The raw message is kept on the end rather than replaced — when the cause is something neither of
 * us predicted, the original text is the only thing that will identify it.
 */
export function explainEnqueueFailure(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  if (/TRIGGER_SECRET_KEY|TRIGGER_API_URL/i.test(raw)) {
    return (
      "Nothing ran: this site cannot reach Trigger.dev, the service that does the background work. " +
      "Its key is missing or wrong. Add TRIGGER_SECRET_KEY in Vercel under Settings → Environment " +
      "Variables, using the production key from your Trigger.dev project, then redeploy."
    );
  }

  if (/401|403|unauthor/i.test(raw)) {
    return (
      "Nothing ran: Trigger.dev refused the key this site is using. It may have been rotated, or it " +
      `may belong to a different project. Check TRIGGER_SECRET_KEY in Vercel. (${raw})`
    );
  }

  return (
    `Nothing ran, and nothing was changed or spent: ${raw}. ` +
    "This usually means the background worker is not running."
  );
}
