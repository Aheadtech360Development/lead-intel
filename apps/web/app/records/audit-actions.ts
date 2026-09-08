"use server";

import type { auditSiteRunTask } from "@lead-intel/jobs/audit-site-run";
import type { scoreRunTask } from "@lead-intel/jobs/score";
import { tasks } from "@trigger.dev/sdk";
import { redirect } from "next/navigation";
import { enqueueBlockedBecause, explainEnqueueFailure } from "@/lib/enqueue";
import { failJobRun, startJobRun } from "@/lib/job-runs";
import { createClient } from "@/lib/supabase/server";

/**
 * The two whole-list buttons that the product was missing.
 *
 * Both tasks behind them existed, worked, and had no way to be started from the application — the
 * same hole the CSV importer and the single-business audit each had in turn. The operator's report
 * was the general form of it: *"jo jo functionality humne banai hain unke buttons hon or workable
 * hon"*.
 */

/**
 * Reads every website page by page.
 *
 * The per-record button is right for checking one lead before ringing it, and useless for the
 * actual job: hundreds of businesses, forty seconds each, and no way to queue them. This is that
 * button for the whole list.
 *
 * **What it costs.** The browser time is billed by **Trigger.dev**, the service that runs every
 * background job here — measured at about forty seconds of `medium-1x` per site. The page
 * judgements are billed by **Google AI Studio (Gemini)**, whose job is the one thing measurement
 * cannot do: saying whether a page actually works. That has measured at 0.36¢ per site, so a
 * three-hundred-site pass is a little over a dollar. Every call is written to the ledger, so the
 * figure on the Data & spend screen is counted rather than quoted.
 */
export async function auditEveryWebsite(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/records?error=${encodeURIComponent("You are not signed in.")}`);
  }

  const businessIds = formData.getAll("id").map(String).filter(Boolean);

  const jobRunId = await startJobRun(supabase, {
    kind: "audit-site-run",
    label:
      businessIds.length > 0
        ? `Reading ${businessIds.length} ${businessIds.length === 1 ? "website" : "websites"} page by page`
        : "Reading every website that has not been read page by page",
    total: businessIds.length > 0 ? businessIds.length : null,
  });

  // Checked before the SDK is called. A missing key otherwise surfaces as an SDK error nobody can
  // act on, and a *development* key on the live site is worse: it is accepted, the job is queued
  // into an environment whose only worker is a laptop, and nothing ever runs or complains. See
  // lib/enqueue.ts.
  const blocked = enqueueBlockedBecause();
  if (blocked.blocked) {
    await failJobRun(supabase, jobRunId, blocked.why);
    redirect(`/records?error=${encodeURIComponent(blocked.why)}`);
  }

  try {
    await tasks.trigger<typeof auditSiteRunTask>("audit-site-run", { businessIds, jobRunId });
  } catch (err) {
    await failJobRun(supabase, jobRunId, explainEnqueueFailure(err));
    redirect(
      `/records?error=${encodeURIComponent(
        explainEnqueueFailure(err),
      )}`,
    );
  }

  redirect(
    `/records?saved=${encodeURIComponent(
      "Reading websites page by page now. The bar at the top of the screen shows how far along it is, " +
        "and updates itself while you carry on working.",
    )}`,
  );
}

/**
 * Reads only the businesses the operator ticked.
 *
 * A separate action from `auditEveryWebsite` rather than the same one with an empty list, because
 * in that action an empty list *means* "everything" — so a mis-click on "read ticked" with nothing
 * ticked would quietly start a three-hundred-site pass. Here an empty list is an error, and says so.
 *
 * The ids arrive from the table's own checkboxes: the button sits inside that form and overrides
 * where it submits, so the ticks the operator can see are exactly the ids this receives.
 */
export async function auditTickedWebsites(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/records?error=${encodeURIComponent("You are not signed in.")}`);
  }

  const businessIds = formData.getAll("id").map(String).filter(Boolean);
  if (businessIds.length === 0) {
    redirect(
      `/records?error=${encodeURIComponent(
        "Nothing was ticked, so nothing ran. Tick the businesses you want read, then press this again — " +
          "or use “Read them page by page” at the top to do the whole list.",
      )}`,
    );
  }

  const jobRunId = await startJobRun(supabase, {
    kind: "audit-site-run",
    label: `Reading ${businessIds.length} ticked ${businessIds.length === 1 ? "website" : "websites"} page by page`,
    total: businessIds.length,
  });

  const blocked = enqueueBlockedBecause();
  if (blocked.blocked) {
    await failJobRun(supabase, jobRunId, blocked.why);
    redirect(`/records?error=${encodeURIComponent(blocked.why)}`);
  }

  try {
    // Explicit ids, so these are re-read even if they have been audited before — which is the point
    // of ticking them. The whole-list button is the one that skips what it has already done.
    await tasks.trigger<typeof auditSiteRunTask>("audit-site-run", { businessIds, jobRunId });
  } catch (err) {
    await failJobRun(supabase, jobRunId, explainEnqueueFailure(err));
    redirect(`/records?error=${encodeURIComponent(explainEnqueueFailure(err))}`);
  }

  redirect(
    `/records?saved=${encodeURIComponent(
      `Reading ${businessIds.length} ${businessIds.length === 1 ? "website" : "websites"} page by page. ` +
        `The bar at the top shows how far along it is. Open any of them to see the pages, the screenshots ` +
        `and what the model made of them.`,
    )}`,
  );
}

/**
 * Re-scores every business from the findings already stored.
 *
 * No crawl, no browser, no provider — pure arithmetic over what is already in the database, which
 * is exactly why it is safe to offer as a button. It exists because the weights and the cut-off are
 * meant to be tuned: changing them should not cost a re-crawl, and until now there was no way to
 * apply a change without one.
 */
export async function rescoreEverything(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") {
    redirect(`/records?error=${encodeURIComponent("You are not signed in.")}`);
  }

  const jobRunId = await startJobRun(supabase, {
    kind: "score-run",
    label: "Re-scoring and re-sorting every business",
  });

  // Checked before the SDK is called. A missing key otherwise surfaces as an SDK error nobody can
  // act on, and a *development* key on the live site is worse: it is accepted, the job is queued
  // into an environment whose only worker is a laptop, and nothing ever runs or complains. See
  // lib/enqueue.ts.
  const blocked = enqueueBlockedBecause();
  if (blocked.blocked) {
    await failJobRun(supabase, jobRunId, blocked.why);
    redirect(`/records?error=${encodeURIComponent(blocked.why)}`);
  }

  try {
    await tasks.trigger<typeof scoreRunTask>("score-run", { jobRunId });
  } catch (err) {
    await failJobRun(supabase, jobRunId, explainEnqueueFailure(err));
    redirect(
      `/records?error=${encodeURIComponent(
        explainEnqueueFailure(err),
      )}`,
    );
  }

  redirect(
    `/records?saved=${encodeURIComponent(
      "Re-scoring everything from the checks already stored. This costs nothing — no website is read again.",
    )}`,
  );
}

/**
 * The two "get paid data" buttons, as server actions.
 *
 * They used to be plain submits on a `method="get"` form pointing straight at /records/enrich. That
 * worked, and the Claim buttons in the rows of that same form were already server actions reached
 * by `formAction`, so mixing the two was demonstrably fine.
 *
 * Making all three the same kind of thing is a tidiness choice rather than a fix: one form, one
 * mechanism, and no need for the next person to work out why two buttons in one bar submit by
 * different routes. Nothing the operator sees changes — these still only *navigate* to the confirm
 * screen, and still buy nothing.
 */
async function toEnrich(formData: FormData, scope: "ticked" | "filtered"): Promise<never> {
  const params = new URLSearchParams();

  // Every f_* filter the table carried, forwarded untouched. The confirm screen re-derives the set
  // from these through the same predicate the list used — see lib/lead-filters.ts.
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("f_") && typeof value === "string" && value) params.append(key, value);
  }

  if (scope === "filtered") {
    params.set("scope", "filtered");
  } else {
    for (const id of formData.getAll("id")) {
      if (typeof id === "string" && id) params.append("id", id);
    }
  }

  redirect(`/records/enrich?${params.toString()}`);
}

export async function getPaidDataForTicked(formData: FormData): Promise<void> {
  await toEnrich(formData, "ticked");
}

export async function getPaidDataForFiltered(formData: FormData): Promise<void> {
  await toEnrich(formData, "filtered");
}
