"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Both actions rely entirely on the businesses_update RLS policy to decide whether the write is
 * allowed — there is no ownership check here in application code. If a member tries to claim
 * something already claimed by someone else, the UPDATE affects 0 rows; revalidating the page
 * afterward shows the row's true current state either way, which is the honest feedback here
 * rather than a toast message — these are plain form actions, not wired to client-side state.
 */

export async function claimBusiness(businessId: string): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims) return;

  await supabase
    .from("businesses")
    .update({ claimed_by: claims.sub, claim_status: "claimed", claimed_at: new Date().toISOString() })
    .eq("id", businessId)
    .is("claimed_by", null);

  revalidatePath("/records");
}

export async function releaseClaim(businessId: string): Promise<void> {
  const supabase = await createClient();

  await supabase
    .from("businesses")
    .update({ claimed_by: null, claim_status: "unclaimed", claimed_at: null })
    .eq("id", businessId);

  revalidatePath("/records");
}
