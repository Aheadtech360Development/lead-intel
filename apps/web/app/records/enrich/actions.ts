"use server";

import {
  DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
  ENRICHMENT_DEFINITIONS,
  isEnrichmentSource,
  type EnrichmentSource,
} from "@lead-intel/shared";
import type { enrichRunTask } from "@lead-intel/jobs/enrich";
import { tasks } from "@trigger.dev/sdk";
import { redirect } from "next/navigation";
import { enqueueBlockedBecause, explainEnqueueFailure } from "@/lib/enqueue";
import { attachTriggerRun, failJobRun, startJobRun } from "@/lib/job-runs";
import { createClient } from "@/lib/supabase/server";

/**
 * The most businesses a source may be bought for in one submission.
 *
 * Only sources the operator chose to pick by hand appear here. Meta ads is 11.6¢ — 45× an Instagram
 * profile — and the instruction was that it gets decided one business at a time. A ceiling makes
 * that true of the request itself, so a filter with 330 rows behind it cannot become a $38 run
 * however the form was put together.
 */
const HAND_PICKED_MAX: Partial<Record<EnrichmentSource, number>> = {
  meta_ads: 25,
};

/**
 * Takes the operator's decision to spend money and hands it to the worker.
 *
 * Next.js only ever enqueues — the same boundary the discovery flow draws. The service role key
 * and every provider key live with the Trigger.dev worker, never in `apps/web`, so this action
 * cannot itself buy anything even if it were reached by mistake.
 *
 * The cap travels with the request. It is re-applied inside the runner per purchase, so the
 * ceiling the operator saw on the confirm screen is the ceiling actually enforced, not a number
 * the page displayed and then forgot.
 */
export async function buyEnrichment(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/login`);
  }

  const businessIds = formData.getAll("id").map(String).filter(Boolean);
  const sources = formData.getAll("source").map(String).filter(isEnrichmentSource);

  /**
   * Where a refusal sends the operator: back to this screen, with these businesses still on it.
   *
   * Every refusal here used to redirect to a bare /records/enrich?error=…, which drops the ids —
   * so the screen rendered "Nothing selected", the message sat above an empty page, and the
   * operator reasonably concluded something had run. That is how "I pressed Instagram and nothing
   * changed" happened with no job ever reaching the worker.
   */
  const back = (message: string) => {
    const q = new URLSearchParams();
    for (const id of businessIds) q.append("id", id);
    const only = String(formData.get("only") ?? "");
    if (only) q.set("only", only);
    q.set("error", message);
    return `/records/enrich?${q.toString()}`;
  };

  if (businessIds.length === 0) {
    redirect(back("No businesses were selected, so nothing was bought."));
  }
  if (sources.length === 0) {
    redirect(back("You did not tick anything to buy, so nothing was spent."),
    );
  }

  // The hand-picked rule, enforced on the request rather than on the page.
  //
  // The confirm screen hides Meta ads whenever the arrival was "everything matching my filter", but
  // a hidden field saying so would be a claim the form makes about itself. This checks the thing
  // that actually matters — how many businesses one submission would buy it for — so the guarantee
  // holds however the request was assembled.
  const overreach = sources.filter((s) => HAND_PICKED_MAX[s] !== undefined && businessIds.length > HAND_PICKED_MAX[s]!);
  if (overreach.length > 0) {
    const source = overreach[0]!;
    redirect(back(`${ENRICHMENT_DEFINITIONS[source].label} is bought business by business, not for a whole list. ` +
          `You selected ${businessIds.length}; the most it will do at once is ${HAND_PICKED_MAX[source]}. ` +
          `Nothing was spent — tick the specific businesses you want it for and try again.`,
      ),
    );
  }

  const capDollars = Number(formData.get("capDollars"));
  const capCents =
    Number.isFinite(capDollars) && capDollars > 0
      ? Math.round(capDollars * 100)
      : DEFAULT_ENRICHMENT_SPEND_CAP_CENTS;

  const jobRunId = await startJobRun(supabase, {
    kind: "enrich-run",
    label: `Buying ${sources.length === 1 ? sources[0] : `${sources.length} kinds of data`} for ${businessIds.length} ${
      businessIds.length === 1 ? "business" : "businesses"
    }`,
    total: businessIds.length,
  });

  // Checked before the SDK is called. A missing key otherwise surfaces as an SDK error nobody can
  // act on, and a *development* key on the live site is worse: it is accepted, the job is queued
  // into an environment whose only worker is a laptop, and nothing ever runs or complains. See
  // lib/enqueue.ts.
  const blocked = enqueueBlockedBecause();
  if (blocked.blocked) {
    await failJobRun(supabase, jobRunId, blocked.why);
    redirect(back(blocked.why));
  }

  try {
    const handle = await tasks.trigger<typeof enrichRunTask>("enrich-run", { businessIds, sources, capCents, jobRunId });
    await attachTriggerRun(supabase, jobRunId ?? null, handle.id);
  } catch (err) {
    await failJobRun(supabase, jobRunId, explainEnqueueFailure(err));
    // Surfaced, not swallowed. An operator who pressed "buy" and saw a success page while nothing
    // ran would go looking for data that was never fetched — the same reasoning that made the
    // discovery flow record its own enqueue failures rather than hiding them.
    redirect(back(explainEnqueueFailure(err),
      ),
    );
  }

  /**
   * Back to where the purchase was about.
   *
   * One business — almost always the record's own "Analyse their Instagram" button — goes back to
   * that record, where the new numbers will actually appear. It used to land on the leads list,
   * so the operator bought something for one business and was then shown four hundred others,
   * none of them visibly different.
   */
  if (businessIds.length === 1) {
    redirect(
      `/records/${businessIds[0]}?saved=${encodeURIComponent(
        "Buying it now — usually under a minute. The bar at the top shows when it is done; the new numbers, " +
          "score and row colour appear here once it finishes.",
      )}`,
    );
  }

  redirect(
    `/records?bought=${encodeURIComponent(
      `Buying data for ${businessIds.length} businesses, up to $${(capCents / 100).toFixed(2)}. It appears on each record as it arrives.`,
    )}`,
  );
}
