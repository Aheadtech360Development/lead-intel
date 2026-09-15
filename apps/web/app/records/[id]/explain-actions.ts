"use server";

import {
  EXPLAIN_BUSINESS_SYSTEM,
  buildExplainPrompt,
  cannotExplain,
  parseExplanation,
  type ExplainInput,
} from "@lead-intel/core";
import { callGemini, parseJsonAnswer } from "@lead-intel/providers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Writes a plain-language briefing about one business, from findings that already exist.
 *
 * **Generated once and stored, not on every page load.** Three reasons, in order of how much they
 * matter: a model asked twice gives two different answers, and a briefing that changes each time
 * you open the record is one nobody can rely on; regenerating on render would spend money every
 * time a page is refreshed; and a stored summary can carry the date it was written, which a
 * freshly-generated one silently cannot.
 *
 * Stored as ordinary `field_metadata` rows with `source_name` naming the model, so it sits in the
 * same provenance system as everything else — an operator can see that this sentence came from
 * gemini-2.5-flash on a given date, exactly as they can see that a phone number came from a CSV.
 */
export async function explainBusiness(formData: FormData): Promise<void> {
  const businessId = String(formData.get("id") ?? "").trim();
  if (!businessId) redirect("/records");

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (typeof claimsData?.claims?.sub !== "string") {
    redirect(`/records/${businessId}?error=${encodeURIComponent("You are not signed in.")}`);
  }

  const [{ data: business }, { data: fields }, { data: findings }] = await Promise.all([
    supabase
      .from("businesses")
      .select("display_name, city, route, icp_name")
      .eq("id", businessId)
      .maybeSingle(),
    supabase.from("field_metadata").select("field_name, value").eq("business_id", businessId),
    supabase
      .from("findings")
      .select("check_id, evidence, points, outcome")
      .eq("business_id", businessId)
      .eq("outcome", "fired")
      .order("points", { ascending: false }),
  ]);

  if (!business) redirect("/records");

  const siteText = (fields ?? []).find((f) => f.field_name === "site_text")?.value ?? null;
  const input: ExplainInput = {
    businessName: business.display_name,
    city: business.city,
    siteText,
    // Only what fired. An unfired check is not evidence of anything, and handing the model a list
    // of things that did *not* happen is how a summary ends up mentioning a problem nobody found.
    firedChecks: (findings ?? []).map((f) => ({
      checkId: f.check_id,
      evidence: f.evidence ?? "",
      points: Number(f.points ?? 0),
    })),
    route: business.route,
    operatorCategory: business.icp_name
      ? String(business.icp_name)
      : null,
  };

  // Refused before anything is spent. A name and a town produce fluent invention, which is the one
  // output this feature must never produce.
  const refusal = cannotExplain(input);
  if (refusal) {
    redirect(`/records/${businessId}?error=${encodeURIComponent(refusal)}`);
  }

  const result = await callGemini({
    apiKey: process.env.GEMINI_API_KEY,
    system: EXPLAIN_BUSINESS_SYSTEM,
    user: buildExplainPrompt(input),
    json: true,
    maxOutputTokens: 1800,
  });

  if (!result.ok) {
    redirect(
      `/records/${businessId}?error=${encodeURIComponent(
        `Could not write the summary: ${result.detail} The findings below are unaffected.`,
      )}`,
    );
  }

  const json = parseJsonAnswer<unknown>(result);
  if (!json.ok) {
    redirect(`/records/${businessId}?error=${encodeURIComponent(`The model's answer could not be read: ${json.detail}`)}`);
  }

  const parsed = parseExplanation(json.value);
  if (!parsed.ok) {
    redirect(`/records/${businessId}?error=${encodeURIComponent(parsed.detail)}`);
  }

  const now = new Date().toISOString();
  const rows = [
    { field_name: "ai_summary", value: parsed.explanation.summary },
    { field_name: "ai_category_verdict", value: parsed.explanation.categoryVerdict },
    { field_name: "ai_category_note", value: parsed.explanation.categoryNote },
    // Token counts kept so the cost of this feature is measurable from the data rather than
    // estimated. Every other spend in this product is auditable; this one should be too.
    { field_name: "ai_tokens", value: `${result.inputTokens}/${result.outputTokens}` },
  ];

  for (const row of rows) {
    const { error } = await supabase.from("field_metadata").upsert(
      {
        business_id: businessId,
        field_name: row.field_name,
        value: row.value,
        source_name: "gemini-2.5-flash",
        // "unconfirmed" deliberately. This is a model's reading of evidence, not a measurement —
        // calling it verified would put it on the same footing as a crawled fact, and the whole
        // design of this feature rests on those being visibly different things.
        //
        // It was "unverified" until this bug: that is not one of the four values the column allows
        // (verified, unconfirmed, not_found, not_yet_validated), so every write was rejected by the
        // database — and because the error below went unchecked, the action then redirected to a
        // success page with nothing saved. A paid API call, a cheerful redirect, and no data.
        verification_status: "unconfirmed" as const,
        last_verified_at: now,
        updated_at: now,
      },
      { onConflict: "business_id,field_name" },
    );

    // Checked, now. An unchecked write is a lie waiting to happen: the model had already been
    // called and paid for by this point, so silence here cost money *and* produced nothing, while
    // the screen said it had worked.
    if (error) {
      redirect(
        `/records/${businessId}?error=${encodeURIComponent(
          `The summary was written but could not be saved: ${error.message}`,
        )}`,
      );
    }
  }

  revalidatePath(`/records/${businessId}`);
  redirect(`/records/${businessId}#summary`);
}
