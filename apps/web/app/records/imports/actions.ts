"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Removing the record of an uploaded file.
 *
 * The point of the screen this serves is that nothing vanishes: a file uploaded and never confirmed
 * is still listed, so an operator is never left wondering whether an import happened. That is worth
 * keeping — but it also means the list accumulates rows for files that turned out to be nothing, and
 * there was no way to clear them.
 *
 * **What this deliberately will not do.** `businesses.import_batch_id` is declared
 * `ON DELETE SET NULL`, so deleting a batch that created businesses would succeed quietly and leave
 * those businesses in the list with their origin still reading "from a file I imported" and no file
 * to point at. Nothing would break, nothing would warn, and the answer to "where did these 123
 * businesses come from" would be gone — which is the exact question this whole screen was built to
 * answer. So a batch that owns businesses is refused, with the count and a link to them, and the
 * operator can delete those first if they really mean it.
 */
export async function deleteImportBatch(formData: FormData): Promise<void> {
  const batchId = String(formData.get("batch") ?? "").trim();
  if (!batchId) redirect("/records/imports");

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/records/imports?error=${encodeURIComponent("You are not signed in.")}`);
  }

  const { data: batch } = await supabase
    .from("import_batches")
    .select("id, filename, status")
    .eq("id", batchId)
    .maybeSingle();

  if (!batch) {
    redirect(`/records/imports?error=${encodeURIComponent("That file is not in the list any more.")}`);
  }

  // Asked of the database rather than passed in from the page. A count rendered a minute ago is not
  // evidence about what is true now, and this is the check standing between a click and losing the
  // provenance of every business the file made.
  const { count } = await supabase
    .from("businesses")
    .select("id", { count: "exact", head: true })
    .eq("import_batch_id", batchId);

  const owned = count ?? 0;
  if (owned > 0) {
    redirect(
      `/records/imports?error=${encodeURIComponent(
        `“${batch.filename ?? "That file"}” created ${owned} businesses that are still in your list, so it was not deleted. ` +
          `Deleting it would leave those ${owned} saying they came from a file, with no file to open. ` +
          `Delete or archive those businesses first if you want the file gone.`,
      )}`,
    );
  }

  const { error } = await supabase.from("import_batches").delete().eq("id", batchId);
  if (error) {
    redirect(`/records/imports?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/records/imports");
  redirect(
    `/records/imports?done=${encodeURIComponent(
      `Removed “${batch.filename ?? "the file"}” from the list. It had created no businesses, so nothing else changed.`,
    )}`,
  );
}
