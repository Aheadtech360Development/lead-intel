"use server";

import { redirect } from "next/navigation";
import type { discoveryTask } from "@lead-intel/jobs/discovery";
import { tasks } from "@trigger.dev/sdk";
import { enqueueBlockedBecause, explainEnqueueFailure } from "@/lib/enqueue";
import { attachTriggerRun, failJobRun, startJobRun } from "@/lib/job-runs";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/viewer";

/**
 * Creates the run row (pipeline Stage 0 → the moment the operator confirmed) and enqueues the
 * discovery task. Next.js only ever enqueues; Trigger.dev does the actual work — the same
 * boundary the rest of this repo already draws around the service role key.
 */
export async function createRun(formData: FormData): Promise<void> {
  await requireAdmin("/search");
  const icpId = ((formData.get("icp") as string) ?? "").trim();
  const typedNiche = (formData.get("niche") as string)?.trim();
  const location = (formData.get("location") as string)?.trim();
  const radiusMiles = Number(formData.get("radiusMiles"));
  const maxBusinessesRaw = formData.get("maxBusinesses") as string | null;
  const maxSpendDollarsRaw = formData.get("maxSpendDollars") as string | null;

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  /**
   * An ICP is several searches, so it becomes several runs — one per word.
   *
   * Kept as separate runs rather than folded into one: a run already means "this word, this place,
   * this grid", and every screen that reads a run — its progress, its cost, its grid of cells —
   * assumes that. Three words in one run would make all three of those lie, and would take away
   * the operator's ability to see that "embroidery" found sixty businesses and "patches" found
   * four.
   *
   * The words are read here rather than trusted from the form, so what runs is what the ICP says
   * at the moment the button was pressed.
   */
  const { data: icp } = icpId
    ? await supabase.from("icps").select("id, name, search_terms").eq("id", icpId).maybeSingle()
    : { data: null };
  const niches = icp
    ? ((icp.search_terms ?? []) as string[]).map((t) => t.trim()).filter((t) => t.length > 0)
    : typedNiche
      ? [typedNiche]
      : [];

  if (niches.length === 0 || !location || !Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    redirect(`/search?error=${encodeURIComponent("Missing or invalid search — please try again.")}`);
  }

  const maxBusinesses = maxBusinessesRaw ? Number(maxBusinessesRaw) : null;
  /**
   * The spend limit is the operator's answer to "how much may this cost me", and they answered it
   * once for the whole thing. Split across the words rather than applied to each, so choosing an
   * ICP with four words does not quietly turn a $5 limit into $20.
   */
  const totalSpendCents = maxSpendDollarsRaw ? Math.round(Number(maxSpendDollarsRaw) * 100) : null;
  const maxSpendCents = totalSpendCents === null ? null : Math.max(1, Math.floor(totalSpendCents / niches.length));
  const maxBusinessesEach =
    maxBusinesses === null ? null : Math.max(1, Math.floor(maxBusinesses / niches.length));

  const started: string[] = [];
  let firstFailure: string | null = null;

  for (const niche of niches) {
    const { data: run, error } = await supabase
      .from("runs")
      .insert({
        niche,
        location,
        radius_miles: radiusMiles,
        max_businesses: maxBusinessesEach,
        max_spend_cents: maxSpendCents,
        created_by: typeof claims?.sub === "string" ? claims.sub : null,
        status: "planning",
      })
      .select("id")
      .single();

    if (error || !run) {
      firstFailure ??= error?.message ?? "Could not create the run.";
      continue;
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
      label: icp
        ? `Searching Google Maps for "${niche}" near ${location} — ${icp.name}`
        : `Searching Google Maps for "${niche}" near ${location}`,
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
      firstFailure ??= blocked.why;
      continue;
    }

    try {
      const handle = await tasks.trigger<typeof discoveryTask>("discovery", { runId: run.id, jobRunId });
      await attachTriggerRun(supabase, jobRunId ?? null, handle.id);
      started.push(run.id);
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
      firstFailure ??= why;
    }
  }

  // Nothing started at all: say why, on the screen they pressed the button on.
  if (started.length === 0) {
    redirect(`/search?error=${encodeURIComponent(firstFailure ?? "Could not start the search.")}`);
  }

  // Some started and some did not. The ones that did are running and their work is real, so the
  // operator is taken to them — with the failure named rather than dropped.
  if (firstFailure) {
    redirect(`/search/runs/${started[0]}?partial=${encodeURIComponent(firstFailure)}&of=${niches.length}&started=${started.length}`);
  }

  redirect(`/search/runs/${started[0]}`);
}
