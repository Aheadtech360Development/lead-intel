"use server";

import type { analyseRunTask } from "@lead-intel/jobs/analyse";
import type { auditSiteTask } from "@lead-intel/jobs/audit-site";
import { tasks } from "@trigger.dev/sdk";
import { redirect } from "next/navigation";
import { enqueueBlockedBecause, explainEnqueueFailure } from "@/lib/enqueue";
import { attachTriggerRun, failJobRun, startJobRun } from "@/lib/job-runs";
import { createClient } from "@/lib/supabase/server";

/**
 * Starts the page-by-page audit for one business.
 *
 * This button is the whole reason the audit is usable. Everything behind it — the browser, the page
 * discovery, the structure extraction, the checklists — was built and tested and had no way to be
 * run from the application at all, which is precisely the hole the CSV importer had: work that
 * happens correctly and invisibly is work nobody can use.
 *
 * As everywhere, Next.js only enqueues. The browser runs on the Trigger.dev worker, where the
 * database credentials and the storage key live.
 *
 * **It costs machine time, not a provider.** Measured at about 38 seconds of `medium-1x` on
 * Trigger.dev per site — the same account that already runs the crawl and the scoring, out of the
 * same monthly credit. No third party is paid anything.
 */
export async function auditWebsite(formData: FormData): Promise<void> {
  const businessId = String(formData.get("id") ?? "").trim();
  if (!businessId) redirect("/records");

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/records/${businessId}?tab=website&error=${encodeURIComponent("You are not signed in.")}`);
  }

  // Named after the business, because this job's progress is shown on that business's own record
  // as well as in the banner that follows the operator around the product.
  const { data: business } = await supabase
    .from("businesses")
    .select("display_name")
    .eq("id", businessId)
    .maybeSingle();

  const jobRunId = await startJobRun(supabase, {
    kind: "audit-site",
    label: `Reading ${business?.display_name ?? "their"} website, page by page`,
    businessId,
  });

  // Checked before the SDK is called. A missing key otherwise surfaces as an SDK error nobody can
  // act on, and a *development* key on the live site is worse: it is accepted, the job is queued
  // into an environment whose only worker is a laptop, and nothing ever runs or complains. See
  // lib/enqueue.ts.
  const blocked = enqueueBlockedBecause();
  if (blocked.blocked) {
    await failJobRun(supabase, jobRunId, blocked.why);
    redirect(`/records/${businessId}?tab=website&error=${encodeURIComponent(blocked.why)}`);
  }

  try {
    const handle = await tasks.trigger<typeof auditSiteTask>("audit-site", { businessId, jobRunId });
    await attachTriggerRun(supabase, jobRunId ?? null, handle.id);
  } catch (err) {
    await failJobRun(supabase, jobRunId, explainEnqueueFailure(err));
    // Surfaced, not swallowed. An operator who pressed the button and saw a cheerful message while
    // nothing ran would wait for scorecards that were never coming.
    redirect(
      `/records/${businessId}?tab=website&error=${encodeURIComponent(
        explainEnqueueFailure(err),
      )}`,
    );
  }

  redirect(
    `/records/${businessId}?tab=website&saved=${encodeURIComponent(
      "Reading their website now, page by page — usually under a minute. Refresh to see the scorecards. " +
        "It costs machine time on Trigger.dev and nothing to any provider.",
    )}`,
  );
}

/**
 * Everything, on one business, in the right order.
 *
 * The operator asked for a single button that gets them the whole picture of a lead rather than
 * having to know which of three passes to run. It chains rather than fans out, because the two
 * passes write to the same record and their evidence is not of equal weight: the plain crawl
 * decides `website_status`, the browser can overturn a "couldn't check", and whichever lands last
 * wins. Running them side by side would make the result depend on which finished first.
 *
 * **What it costs.** The crawl, the checks, the speed test and the scoring are free — our own code
 * and Google's free PageSpeed API. Only the page judgements cost anything: about **0.36¢** with
 * **Google AI Studio (Gemini)**, plus browser time on **Trigger.dev**, which runs every background
 * job here. Nothing is bought from any data provider; buying is always a separate, confirmed step.
 */
export async function fullAnalyse(formData: FormData): Promise<void> {
  const businessId = String(formData.get("id") ?? "").trim();
  if (!businessId) redirect("/records");

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/records/${businessId}?error=${encodeURIComponent("You are not signed in.")}`);
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("display_name")
    .eq("id", businessId)
    .maybeSingle();

  const jobRunId = await startJobRun(supabase, {
    kind: "analyse-run",
    label: `Full analysis of ${business?.display_name ?? "this business"}`,
    businessId,
  });

  const blocked = enqueueBlockedBecause();
  if (blocked.blocked) {
    await failJobRun(supabase, jobRunId, blocked.why);
    redirect(`/records/${businessId}?error=${encodeURIComponent(blocked.why)}`);
  }

  try {
    const handle = await tasks.trigger<typeof analyseRunTask>("analyse-run", {
      businessIds: [businessId],
      matchAllIcps: false,
      matchIcpIds: [businessId],
      // The browser pass last. See the note on thenAuditSites in the task.
      thenAuditSites: true,
      jobRunId,
    });
    await attachTriggerRun(supabase, jobRunId ?? null, handle.id);
  } catch (err) {
    await failJobRun(supabase, jobRunId, explainEnqueueFailure(err));
    redirect(`/records/${businessId}?error=${encodeURIComponent(explainEnqueueFailure(err))}`);
  }

  redirect(
    `/records/${businessId}?saved=${encodeURIComponent(
      "Running the full analysis: reading their site, checking it against all 51 rules, opening it in a " +
        "real browser page by page, then scoring it again. A couple of minutes. The bar at the top shows " +
        "how far along it is.",
    )}`,
  );
}
