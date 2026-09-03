"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Logs what happened after outreach (spec §12 Phase 6).
 *
 * §8.2 and the outcomes table both turn on two columns: **which finding the opener used** and
 * **what objection came back**. Without the first, nobody can tell which finding produced a reply;
 * without the second, a finding that failed to land is indistinguishable from one that landed and
 * then hit a wall. Both are therefore captured here rather than left for later — they cannot be
 * reconstructed after the call.
 *
 * Written through the user's own session, so the outcomes RLS policy decides what may be inserted,
 * exactly as it does for every other write in this app.
 */
export async function logOutcome(businessId: string, formData: FormData): Promise<void> {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") throw new Error("Not signed in.");

  const channel = String(formData.get("channel") ?? "");
  const result = String(formData.get("result") ?? "");
  const objection = String(formData.get("objection") ?? "none");
  const openerArea = String(formData.get("opener_area") ?? "");
  const notes = String(formData.get("notes") ?? "").trim();
  const meetingDate = String(formData.get("meeting_date") ?? "").trim();

  if (!channel || !result) throw new Error("Channel and result are both required.");

  const { error } = await supabase.from("outcomes").insert({
    business_id: businessId,
    user_id: userId,
    channel,
    result,
    objection: objection || "none",
    // Null rather than a guess: an outcome logged without knowing which finding opened the
    // conversation is still worth having, and pretending to know would poison the feedback loop
    // that this column exists to feed.
    opener_area: openerArea || null,
    notes: notes.length > 0 ? notes.slice(0, 2000) : null,
    meeting_date: meetingDate.length > 0 ? new Date(meetingDate).toISOString() : null,
    // Preserved so outcome history survives a merge, even though business_id may later become a
    // tombstone pointing at the survivor.
    original_business_id: businessId,
  });

  if (error) throw new Error(`Could not log the outcome: ${error.message}`);

  revalidatePath(`/records/${businessId}`);
}
