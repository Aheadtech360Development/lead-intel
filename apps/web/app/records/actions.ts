"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Claiming a lead, and giving it back.
 *
 * Whether the write is *allowed* is left entirely to the `businesses_update` RLS policy — there is
 * no ownership check in application code. Someone claiming a lead another member already holds
 * updates zero rows, and the refreshed page then shows "Claimed by someone else", which is the
 * honest answer and needs no message of its own.
 *
 * What did need fixing is the other two cases.
 *
 * **A write that genuinely errors** — a denied policy, a dropped connection — used to be discarded.
 * The page came back looking exactly as it had, and an operator could reasonably conclude the
 * button did nothing rather than that something went wrong. Same shape as the explain-business bug:
 * an unchecked write is a lie waiting to happen.
 *
 * **The lead's own page was never revalidated.** Only `/records` was, so claiming from a business's
 * own record left that record showing stale state.
 */

export async function claimBusiness(businessId: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) redirect(`/records/${businessId}?error=${encodeURIComponent("You are not signed in.")}`);

  const { error } = await supabase
    .from("businesses")
    .update({ claimed_by: claims.sub, claim_status: "claimed", claimed_at: new Date().toISOString() })
    .eq("id", businessId)
    // Only if nobody holds it. Two people pressing at once is settled by the database rather than
    // by whoever's request happened to arrive second.
    .is("claimed_by", null);

  revalidatePath("/records");
  revalidatePath(`/records/${businessId}`);

  if (error) {
    redirect(
      `/records/${businessId}?error=${encodeURIComponent(
        `Could not claim it: ${error.message}. Nothing was changed.`,
      )}`,
    );
  }
}

export async function releaseClaim(businessId: string): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("businesses")
    .update({ claimed_by: null, claim_status: "unclaimed", claimed_at: null })
    .eq("id", businessId);

  revalidatePath("/records");
  revalidatePath(`/records/${businessId}`);

  if (error) {
    redirect(
      `/records/${businessId}?error=${encodeURIComponent(
        `Could not release it: ${error.message}. It is still claimed.`,
      )}`,
    );
  }
}
