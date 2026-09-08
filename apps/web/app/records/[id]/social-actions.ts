"use server";

import { instagramHandle } from "@lead-intel/providers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Recording an Instagram account for a business whose website never gave us one.
 *
 * Instagram links are normally found by crawling a business's own site. That leaves a hole exactly
 * where it hurts most: a business with no website has no link to find, so it can never get a
 * follower count — and "no website but a big audience" is the operator's strongest buying signal.
 * Seventy-six businesses sit in that hole.
 *
 * **Why a person types it rather than a search finding it.** Searching Instagram by business name
 * costs about nine cents through Apify and has already produced the exact failure this would
 * repeat: a braiding salon whose website was a Booksy booking page came back as Booksy's own
 * account, 142,191 followers, category "Software". A wrong follower count does not sit quietly — it
 * sorts that business to the top of the list and gets repeated on a call. Seventy-six records is ten
 * minutes of pasting, and the operator can see whose account they are pasting.
 *
 * Nothing is bought here. The handle is stored; the priced lookup stays where every other purchase
 * lives.
 */
export async function saveInstagramUrl(formData: FormData): Promise<void> {
  const businessId = String(formData.get("id") ?? "").trim();
  if (!businessId) redirect("/records");

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/records/${businessId}?error=${encodeURIComponent("You are not signed in.")}`);
  }

  const raw = String(formData.get("instagram") ?? "").trim();

  // An empty box clears it. Someone who pasted the wrong account needs a way back, and making them
  // guess at a magic word for "remove this" would be worse than the mistake.
  if (raw.length === 0) {
    const { error: clearError } = await supabase
      .from("field_metadata")
      .delete()
      .eq("business_id", businessId)
      .in("field_name", ["instagram_url", "instagram_handle"]);

    revalidatePath(`/records/${businessId}`);

    // Checked, for the same reason every other write here is: a delete that failed followed by
    // "Instagram account removed." is the screen telling the operator something untrue.
    if (clearError) {
      redirect(
        `/records/${businessId}?error=${encodeURIComponent(`Could not remove it: ${clearError.message}`)}`,
      );
    }
    redirect(`/records/${businessId}?saved=${encodeURIComponent("Instagram account removed.")}`);
  }

  // The same parser the paid lookup uses, so what is stored is what will be bought. It rejects
  // Instagram's own routes — /p/, /reel/, /explore/ — and the platform accounts (booksybiz,
  // squarespace, wix) that caused the 142,191-follower mistake.
  const handle = instagramHandle(raw);
  if (!handle) {
    redirect(
      `/records/${businessId}?error=${encodeURIComponent(
        `"${raw}" is not an Instagram profile. Paste the profile address — instagram.com/theirname — ` +
          `or just the username. A link to a single post or a platform's own account will not work.`,
      )}`,
    );
  }

  const now = new Date().toISOString();
  const rows = [
    { field_name: "instagram_url", value: `https://instagram.com/${handle}` },
    { field_name: "instagram_handle", value: handle },
  ];

  for (const row of rows) {
    const { error } = await supabase.from("field_metadata").upsert(
      {
        business_id: businessId,
        field_name: row.field_name,
        value: row.value,
        // Named so provenance stays honest: this came from a person, not from a crawl. The record
        // shows the source next to every field, and "own_crawl" here would be a small lie.
        source_name: "operator_entry",
        verification_status: "verified" as const,
        last_verified_at: now,
        updated_at: now,
      },
      { onConflict: "business_id,field_name" },
    );

    // Checked, because an unchecked write that fails redirects to a success page and leaves the
    // operator believing they saved something they did not.
    if (error) {
      redirect(`/records/${businessId}?error=${encodeURIComponent(`Could not save it: ${error.message}`)}`);
    }
  }

  revalidatePath(`/records/${businessId}`);
  redirect(
    `/records/${businessId}?saved=${encodeURIComponent(
      `Saved @${handle}. Buy their Instagram from the leads list to get the follower count — ` +
        `that is what can move them to Priority 1.`,
    )}`,
  );
}
