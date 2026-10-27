"use server";

import {
  EXAMPLE_ICPS,
  SUGGEST_RULE_SYSTEM,
  buildSuggestRulePrompt,
  parseSuggestedRule,
} from "@lead-intel/core";
import { callGemini, parseJsonAnswer } from "@lead-intel/providers";
// Type-only, exactly as the enrich and analyse actions do it. A runtime `await import()` of the
// task would drag the worker's whole dependency tree — Drizzle, the database driver, the
// providers — into the web bundle, which is both wrong and what broke the build when it was
// written that way. The task id is a string; only its payload type is needed here.
import type { matchIcpsRunTask } from "@lead-intel/jobs/match-icps";
import { tasks } from "@trigger.dev/sdk";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enqueueBlockedBecause, explainEnqueueFailure } from "@/lib/enqueue";
import { attachTriggerRun, failJobRun, startJobRun } from "@/lib/job-runs";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/viewer";

/**
 * Editing the rules that decide a business's category.
 *
 * Applying them is deliberately a separate, explicit action rather than something that happens on
 * save. Re-categorising touches every business in the list, and an operator experimenting with a
 * rule should be able to write three of them and then apply once — not watch the whole dataset
 * shift under each keystroke.
 */

/** Comma or newline separated, whichever the operator typed. Blank entries dropped. */
function terms(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function optionalNumber(value: FormDataEntryValue | null): number | null {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Turns a sentence the operator typed into a draft rule, using Gemini.
 *
 * **Nothing is saved.** The suggestion is redirected back into the same query-string draft the
 * Preview button uses, so the model's answer arrives as a filled-in form *with the preview already
 * run beneath it* — the operator sees the words and the businesses those words would catch in one
 * step, before anything is written. That was the whole worry about letting a model write the terms,
 * and this is the answer to it: not a better model, a visible result.
 *
 * This is the one place `apps/web` calls a provider directly rather than enqueueing to the worker,
 * and the reason is that it is interactive. A three-second question the operator is waiting on does
 * not belong in a background queue they would have to refresh to see. The key is read server-side
 * and has no `NEXT_PUBLIC_` prefix, so it never reaches the browser; bulk work that costs real money
 * per business still goes through the worker and the ledger, as it must.
 */
export async function suggestRule(formData: FormData): Promise<void> {
  await requireAdmin("/icps");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") redirect("/icps?error=You+are+not+signed+in.");

  const description = String(formData.get("description") ?? "").trim();
  if (description.length < 10) {
    redirect(
      `/icps?error=${encodeURIComponent(
        "Describe what you are looking for in a sentence or two — a few words is not enough to pick keywords from.",
      )}#write`,
    );
  }

  const [{ data: existing }, { data: samples }] = await Promise.all([
    supabase.from("icps").select("name, industry").limit(50),
    // Real wording from the operator's own list. Without it the model proposes textbook trade
    // vocabulary; with it, terms come from how these businesses actually write about themselves.
    supabase.from("field_metadata").select("value").eq("field_name", "site_text").limit(12),
  ]);

  const result = await callGemini({
    apiKey: process.env.GEMINI_API_KEY,
    system: SUGGEST_RULE_SYSTEM,
    user: buildSuggestRulePrompt({
      description,
      existingRules: (existing ?? []).map((r) => ({
        name: r.name,
        industry: r.industry,
      })),
      sampleSiteText: (samples ?? []).map((s) => s.value as string),
    }),
    json: true,
    maxOutputTokens: 2400,
  });

  if (!result.ok) {
    redirect(
      `/icps?error=${encodeURIComponent(
        `Could not get a suggestion: ${result.detail} Nothing was changed — you can still write the rule by hand below.`,
      )}#write`,
    );
  }

  const parsedJson = parseJsonAnswer<unknown>(result);
  if (!parsedJson.ok) {
    redirect(
      `/icps?error=${encodeURIComponent(`The model's answer could not be read: ${parsedJson.detail}`)}#write`,
    );
  }

  const suggested = parseSuggestedRule(parsedJson.value);
  if (!suggested.ok) {
    redirect(`/icps?error=${encodeURIComponent(suggested.detail)}#write`);
  }

  const rule = suggested.rule;
  const query = new URLSearchParams({
    // `preview=1` makes the page run the match immediately, so the suggestion never appears without
    // the number that says whether it is any good.
    preview: "1",
    ai: "1",
    name: rule.name,
    industry: rule.industry,
    searchTerms: rule.searchTerms.join(", "),
    priority: "50",
    anyOf: rule.anyOf.join(", "),
    websiteAnyOf: rule.websiteAnyOf.join(", "),
    instagramAnyOf: rule.instagramAnyOf.join(", "),
    noneOf: rule.noneOf.join(", "),
    aiUnderstood: rule.understood,
    aiReasons: JSON.stringify(rule.reasons),
    aiCost: `${result.inputTokens}/${result.outputTokens}`,
  });
  if (rule.requireAll) query.set("requireAll", "on");
  if (rule.minFollowers !== null) query.set("minFollowers", String(rule.minFollowers));
  if (rule.maxFollowers !== null) query.set("maxFollowers", String(rule.maxFollowers));

  redirect(`/icps?${query.toString()}#write`);
}

export async function saveRule(formData: FormData): Promise<void> {
  await requireAdmin("/icps");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") redirect("/icps?error=You+are+not+signed+in.");

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const industry = String(formData.get("industry") ?? "").trim();

  if (!name || !industry) {
    redirect(`/icps?error=${encodeURIComponent("An ICP needs a name and an industry.")}`);
  }

  const anyOf = terms(formData.get("anyOf"));
  const websiteAnyOf = terms(formData.get("websiteAnyOf"));
  const instagramAnyOf = terms(formData.get("instagramAnyOf"));
  const minFollowers = optionalNumber(formData.get("minFollowers"));
  const maxFollowers = optionalNumber(formData.get("maxFollowers"));
  const requireAll = formData.get("requireAll") === "on";
  const groupsFilled = [anyOf, websiteAnyOf, instagramAnyOf].filter((g) => g.length > 0).length;

  // The conditions. Each is a claim about a fact, so each can also carry an ICP on its own — an
  // ICP of "anyone in Texas with 20 reviews" is a real thing to want and needs no words at all.
  const requiresWebsite = formData.get("requiresWebsite") === "on";
  const minReviews = optionalNumber(formData.get("minReviews"));
  const places = terms(formData.get("places"));
  const searchTerms = terms(formData.get("searchTerms"));
  const gated = requiresWebsite || minReviews !== null || places.length > 0;

  // A rule with neither terms nor a follower gate matches nothing at all — the matcher ignores it
  // on purpose. Saying so here is better than saving it and letting the operator wonder why it
  // never fires.
  if (groupsFilled === 0 && minFollowers === null && maxFollowers === null && !gated) {
    redirect(
      `/icps?error=${encodeURIComponent(
        "This ICP has nothing to recognise a business by. Add some words to at least one of the three boxes, " +
          "or set a condition such as a follower range, a review count or a place.",
      )}`,
    );
  }

  // "Must match every box" with one box filled is the same rule as "any box", written in a way
  // that suggests it does something it does not. Refused rather than silently accepted, because
  // the operator who ticks it is expecting a stricter rule than they are about to get.
  if (requireAll && groupsFilled < 2) {
    redirect(
      `/icps?error=${encodeURIComponent(
        "“Must match every box” needs at least two boxes filled in — that is what makes it stricter. " +
          "With one box it would behave exactly like the normal setting.",
      )}`,
    );
  }

  const row = {
    name,
    industry,
    priority: Number(formData.get("priority") ?? 100) || 100,
    enabled: formData.get("enabled") === "on",
    sources: formData.getAll("sources").map(String).filter(Boolean),
    any_of: anyOf,
    none_of: terms(formData.get("noneOf")),
    website_any_of: websiteAnyOf,
    instagram_any_of: instagramAnyOf,
    require_all: requireAll,
    min_followers: minFollowers,
    max_followers: maxFollowers,
    search_terms: searchTerms,
    requires_website: requiresWebsite,
    min_reviews: minReviews,
    places,
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from("icps").update(row).eq("id", id)
    : await supabase.from("icps").insert({ ...row, created_by: userId });

  if (error) redirect(`/icps?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/icps");
  redirect("/icps?saved=1");
}

export async function deleteRule(formData: FormData): Promise<void> {
  await requireAdmin("/icps");
  const id = String(formData.get("id") ?? "");
  if (id) {
    const supabase = await createClient();
    const { error: deleteError } = await supabase.from("icps").delete().eq("id", id);
  if (deleteError) {
    redirect(`/icps?error=${encodeURIComponent(`Could not delete the rule: ${deleteError.message}`)}`);
  }
  }
  revalidatePath("/icps");
  redirect("/icps?saved=1");
}

/** Seeds the starter rules, so the first screen is never an empty form. */
export async function addExampleRules(): Promise<void> {
  await requireAdmin("/icps");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") redirect("/icps?error=You+are+not+signed+in.");

  const { error } = await supabase.from("icps").insert(
    EXAMPLE_ICPS.map((r) => ({
      created_by: userId,
      name: r.name,
      industry: r.industry,
      priority: r.priority,
      enabled: true,
      sources: r.sources,
      any_of: r.anyOf,
      none_of: r.noneOf,
      website_any_of: r.websiteAnyOf,
      instagram_any_of: r.instagramAnyOf,
      require_all: r.requireAll,
      min_followers: r.minFollowers,
      max_followers: r.maxFollowers,
      search_terms: r.searchTerms,
      requires_website: r.requiresWebsite,
      min_reviews: r.minReviews,
      places: r.places,
    })),
  );
  if (error) redirect(`/icps?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/icps");
  redirect("/icps?saved=1");
}

/**
 * Runs every rule over every business.
 *
 * Enqueued rather than done here: it touches the whole list, and a server action that walks a few
 * hundred records is a request that times out at exactly the moment the dataset gets interesting.
 */
export async function applyRules(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") redirect("/icps?error=You+are+not+signed+in.");

  const jobRunId = await startJobRun(supabase, {
    kind: "match-icps-run",
    label: "Matching every business against your ICPs",
  });

  // Checked before the SDK is called. A missing key otherwise surfaces as an SDK error nobody can
  // act on, and a *development* key on the live site is worse: it is accepted, the job is queued
  // into an environment whose only worker is a laptop, and nothing ever runs or complains. See
  // lib/enqueue.ts.
  const blocked = enqueueBlockedBecause();
  if (blocked.blocked) {
    await failJobRun(supabase, jobRunId, blocked.why);
    redirect(`/icps?error=${encodeURIComponent(blocked.why)}`);
  }

  try {
    const handle = await tasks.trigger<typeof matchIcpsRunTask>("match-icps-run", { jobRunId });
    await attachTriggerRun(supabase, jobRunId ?? null, handle.id);
  } catch (err) {
    await failJobRun(supabase, jobRunId, explainEnqueueFailure(err));
    redirect(
      `/icps?error=${encodeURIComponent(
        explainEnqueueFailure(err),
      )}`,
    );
  }

  redirect("/icps?applied=1");
}
