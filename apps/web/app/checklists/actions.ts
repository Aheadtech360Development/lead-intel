"use server";

import { CHECKABLE_FIELDS, EXAMPLE_CHECKLIST_RULES, TESTS } from "@lead-intel/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Editing what a good page looks like.
 *
 * Nothing here re-runs an audit. The page structure is already stored, and the verdicts are worked
 * out fresh every time a record is opened — so a rule saved here changes every scorecard on the
 * next page load, with no job to wait for and nothing to re-crawl.
 */

function optionalNumber(value: FormDataEntryValue | null): number | null {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) ? Math.round(n) : null;
}

export async function saveChecklistRule(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") redirect("/checklists?error=You+are+not+signed+in.");

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const says = String(formData.get("says") ?? "").trim();
  const field = String(formData.get("field") ?? "").trim();
  const test = String(formData.get("test") ?? "").trim();

  if (!name || !says) {
    redirect(`/checklists?error=${encodeURIComponent("A rule needs a name and a sentence to show when it fails.")}`);
  }

  // The field must be one the extractors actually produce. A rule naming anything else would save
  // cleanly and then report itself broken on every page — better to refuse it here.
  if (!CHECKABLE_FIELDS.some((f) => f.id === field)) {
    redirect(`/checklists?error=${encodeURIComponent(`"${field}" is not something this system measures.`)}`);
  }
  if (!(TESTS as readonly string[]).includes(test)) {
    redirect(`/checklists?error=${encodeURIComponent(`"${test}" is not a test this system knows.`)}`);
  }

  const needsNumber = test === "at_least" || test === "at_most" || test === "equals";
  const value = optionalNumber(formData.get("value"));
  if (needsNumber && value === null) {
    redirect(
      `/checklists?error=${encodeURIComponent(
        `"${test.replace("_", " ")}" needs a number to compare against, otherwise the rule can never decide anything.`,
      )}`,
    );
  }

  const row = {
    name,
    page_type: String(formData.get("pageType") ?? "") || null,
    category: String(formData.get("category") ?? "").trim() || null,
    field,
    test,
    value: needsNumber ? value : null,
    weight: optionalNumber(formData.get("weight")) ?? 10,
    enabled: formData.get("enabled") === "on",
    says,
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from("page_checklists").update(row).eq("id", id)
    : await supabase.from("page_checklists").insert({ ...row, created_by: userId });

  if (error) redirect(`/checklists?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/checklists");
  redirect("/checklists?saved=1");
}

export async function deleteChecklistRule(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) {
    const supabase = await createClient();
    await supabase.from("page_checklists").delete().eq("id", id);
  }
  revalidatePath("/checklists");
  redirect("/checklists?saved=1");
}

/** Seeds the starter set, so the first visit is never a blank form. */
export async function addExampleChecklists(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") redirect("/checklists?error=You+are+not+signed+in.");

  const { error } = await supabase.from("page_checklists").insert(
    EXAMPLE_CHECKLIST_RULES.map((r) => ({
      created_by: userId,
      name: r.name,
      page_type: r.pageType,
      category: r.category,
      field: r.field,
      test: r.test,
      value: r.value,
      weight: r.weight,
      enabled: true,
      says: r.says,
    })),
  );
  if (error) redirect(`/checklists?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/checklists");
  redirect("/checklists?saved=1");
}
