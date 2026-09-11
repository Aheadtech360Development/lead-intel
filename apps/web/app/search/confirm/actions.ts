"use server";

import { redirect } from "next/navigation";
import type { discoveryTask } from "@lead-intel/jobs/discovery";
import { tasks } from "@trigger.dev/sdk";
import { enqueueBlockedBecause, explainEnqueueFailure } from "@/lib/enqueue";
import { attachTriggerRun, failJobRun, startJobRun } from "@/lib/job-runs";
import { createClient } from "@/lib/supabase/server";

/**
 * Creates the run row (pipeline Stage 0 → the moment the operator confirmed) and enqueues the
 * discovery task. Next.js only ever enqueues; Trigger.dev does the actual work — the same
 * boundary the rest of this repo already draws around the service role key.
 */
export async function createRun(formData: FormData): Promise<void> {
  const niche = (formData.get("niche") as string)?.trim();
  const location = (formData.get("location") as string)?.trim();
  const radiusMiles = Number(formData.get("radiusMiles"));
  const maxBusinessesRaw = formData.get("maxBusinesses") as string | null;
  const maxSpendDollarsRaw = formData.get("maxSpendDollars") as string | null;

  if (!niche || !location || !Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    redirect(`/search?error=${encodeURIComponent("Missing or invalid search — please try again.")}`);
  }

  const maxBusinesses = maxBusinessesRaw ? Number(maxBusinessesRaw) : null;
  const maxSpendCents = maxSpendDollarsRaw ? Math.round(Number(maxSpendDollarsRaw) * 100) : null;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const { data: run, error } = await supabase
    .from("runs")
    .insert({
      niche,
      location,
      radius_miles: radiusMiles,
      max_businesses: maxBusinesses,
      max_spend_cents: maxSpendCents,
      created_by: typeof claims?.sub === "string" ? claims.sub : null,
      status: "planning",
    })
    .select("id")
    .single();

  if (error || !run) {
    redirect(`/search?error=${encodeURIComponent(error?.message ?? "Could not create the run.")}`);
  }

  /**
   * Discovery reports itself like every other job now.
   *
   * It was the one button in the product that did not. Pressing it created a run, enqueued a task
   * and redirected, and the progress banner — which follows the operator around every other screen
   * — stayed empty, because nothing had written a row for it to show. That is exactly the gap the
   * operator hit: the search may well have started, and there was no way to tell.
   */
  const jobRunId = await startJobRun(supabase, {
    kind: "discovery",
    label: `Searching Google Maps for "${niche}" near ${location}`,
  });

  // Checked before the SDK is called, so a missing or development key is named in words that say
  // what to do about it rather than surfacing as an SDK error — or, worse, succeeding silently into
  // an environment with no worker. See lib/enqueue.ts.
  const blocked = enqueueBlockedBecause();
  if (blocked.blocked) {
    await failJobRun(supabase, jobRunId, blocked.why);
    await supabase
      .from("runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), errors: { enqueue: blocked.why } })
      .eq("id", run.id);
    redirect(`/search?error=${encodeURIComponent(blocked.why)}`);
  }

  try {
    const handle = await tasks.trigger<typeof discoveryTask>("discovery", { runId: run.id, jobRunId });
    await attachTriggerRun(supabase, jobRunId ?? null, handle.id);
  } catch (err) {
    // Record why enqueueing failed instead of swallowing it. An earlier version caught this
    // silently on the reasoning that "Trigger.dev may not be configured yet" — which left a run
    // stuck on "planning" with no way to tell a missing key from a real outage. Writing the
    // reason onto the run makes the failure visible on its own status page, which is the same
    // rule the rest of the pipeline follows: a step that could not run never looks like one that
    // ran fine.
    const why = explainEnqueueFailure(err);
    await failJobRun(supabase, jobRunId, why);
    await supabase
      .from("runs")
      .update({ status: "failed", finished_at: new Date().toISOString(), errors: { enqueue: why } })
      .eq("id", run.id);

    // Shown on the screen they came from, not only on the run's own page. An operator who pressed a
    // button and was sent to a page that quietly says "failed" somewhere down it has been told, in
    // the strictly technical sense, and not in any useful one.
    redirect(`/search?error=${encodeURIComponent(why)}`);
  }

  redirect(`/search/runs/${run.id}`);
}
