"use server";

import {
  EXAMPLE_CATEGORY_RULES,
  SUGGEST_RULE_SYSTEM,
  buildSuggestRulePrompt,
  parseSuggestedRule,
} from "@lead-intel/core";
import { callGemini, parseJsonAnswer } from "@lead-intel/providers";
// Type-only, exactly as the enrich and analyse actions do it. A runtime `await import()` of the
// task would drag the worker's whole dependency tree — Drizzle, the database driver, the
// providers — into the web bundle, which is both wrong and what broke the build when it was
// written that way. The task id is a string; only its payload type is needed here.
import type { categoriseRunTask } from "@lead-intel/jobs/categorise";
import { tasks } from "@trigger.dev/sdk";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { enqueueBlockedBecause, explainEnqueueFailure } from "@/lib/enqueue";
import { failJobRun, startJobRun } from "@/lib/job-runs";
import { createClient } from "@/lib/supabase/server";

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
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") redirect("/categories?error=You+are+not+signed+in.");

  const description = String(formData.get("description") ?? "").trim();
  if (description.length < 10) {
    redirect(
      `/categories?error=${encodeURIComponent(
        "Describe what you are looking for in a sentence or two — a few words is not enough to pick keywords from.",
      )}#write`,
    );
  }

  const [{ data: existing }, { data: samples }] = await Promise.all([
    supabase.from("category_rules").select("name, category, subcategory").limit(50),
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
        category: r.category,
        subcategory: r.subcategory,
      })),
      sampleSiteText: (samples ?? []).map((s) => s.value as string),
    }),
    json: true,
    maxOutputTokens: 2400,
  });

  if (!result.ok) {
    redirect(
      `/categories?error=${encodeURIComponent(
        `Could not get a suggestion: ${result.detail} Nothing was changed — you can still write the rule by hand below.`,
      )}#write`,
    );
  }

  const parsedJson = parseJsonAnswer<unknown>(result);
  if (!parsedJson.ok) {
    redirect(
      `/categories?error=${encodeURIComponent(`The model's answer could not be read: ${parsedJson.detail}`)}#write`,
    );
  }

  const suggested = parseSuggestedRule(parsedJson.value);
  if (!suggested.ok) {
    redirect(`/categories?error=${encodeURIComponent(suggested.detail)}#write`);
  }

  const rule = suggested.rule;
  const query = new URLSearchParams({
    // `preview=1` makes the page run the match immediately, so the suggestion never appears without
    // the number that says whether it is any good.
    preview: "1",
    ai: "1",
    name: rule.name,
    category: rule.category,
    subcategory: rule.subcategory ?? "",
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

  redirect(`/categories?${query.toString()}#write`);
}

export async function saveRule(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") redirect("/categories?error=You+are+not+signed+in.");

  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();

  if (!name || !category) {
    redirect(`/categories?error=${encodeURIComponent("A rule needs a name and a category.")}`);
  }

  const anyOf = terms(formData.get("anyOf"));
  const websiteAnyOf = terms(formData.get("websiteAnyOf"));
  const instagramAnyOf = terms(formData.get("instagramAnyOf"));
  const minFollowers = optionalNumber(formData.get("minFollowers"));
  const maxFollowers = optionalNumber(formData.get("maxFollowers"));
  const requireAll = formData.get("requireAll") === "on";
  const groupsFilled = [anyOf, websiteAnyOf, instagramAnyOf].filter((g) => g.length > 0).length;

  // A rule with neither terms nor a follower gate matches nothing at all — the matcher ignores it
  // on purpose. Saying so here is better than saving it and letting the operator wonder why it
  // never fires.
  if (groupsFilled === 0 && minFollowers === null && maxFollowers === null) {
    redirect(
      `/categories?error=${encodeURIComponent(
        "This rule has nothing to match on. Add some words to at least one of the three boxes, or a follower range.",
      )}`,
    );
  }

  // "Must match every box" with one box filled is the same rule as "any box", written in a way
  // that suggests it does something it does not. Refused rather than silently accepted, because
  // the operator who ticks it is expecting a stricter rule than they are about to get.
  if (requireAll && groupsFilled < 2) {
    redirect(
      `/categories?error=${encodeURIComponent(
        "“Must match every box” needs at least two boxes filled in — that is what makes it stricter. " +
          "With one box it would behave exactly like the normal setting.",
      )}`,
    );
  }

  const row = {
    name,
    category,
    subcategory: String(formData.get("subcategory") ?? "").trim() || null,
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
    updated_at: new Date().toISOString(),
  };

  const { error } = id
    ? await supabase.from("category_rules").update(row).eq("id", id)
    : await supabase.from("category_rules").insert({ ...row, created_by: userId });

  if (error) redirect(`/categories?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/categories");
  redirect("/categories?saved=1");
}

export async function deleteRule(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) {
    const supabase = await createClient();
    const { error: deleteError } = await supabase.from("category_rules").delete().eq("id", id);
  if (deleteError) {
    redirect(`/categories?error=${encodeURIComponent(`Could not delete the rule: ${deleteError.message}`)}`);
  }
  }
  revalidatePath("/categories");
  redirect("/categories?saved=1");
}

/** Seeds the starter rules, so the first screen is never an empty form. */
export async function addExampleRules(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (typeof userId !== "string") redirect("/categories?error=You+are+not+signed+in.");

  const { error } = await supabase.from("category_rules").insert(
    EXAMPLE_CATEGORY_RULES.map((r) => ({
      created_by: userId,
      name: r.name,
      category: r.category,
      subcategory: r.subcategory,
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
    })),
  );
  if (error) redirect(`/categories?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/categories");
  redirect("/categories?saved=1");
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
  if (typeof data?.claims?.sub !== "string") redirect("/categories?error=You+are+not+signed+in.");

  const jobRunId = await startJobRun(supabase, {
    kind: "categorise-run",
    label: "Sorting every business into its category",
  });

  // Checked before the SDK is called. A missing key otherwise surfaces as an SDK error nobody can
  // act on, and a *development* key on the live site is worse: it is accepted, the job is queued
  // into an environment whose only worker is a laptop, and nothing ever runs or complains. See
  // lib/enqueue.ts.
  const blocked = enqueueBlockedBecause();
  if (blocked.blocked) {
    await failJobRun(supabase, jobRunId, blocked.why);
    redirect(`/categories?error=${encodeURIComponent(blocked.why)}`);
  }

  try {
    await tasks.trigger<typeof categoriseRunTask>("categorise-run", { jobRunId });
  } catch (err) {
    await failJobRun(supabase, jobRunId, explainEnqueueFailure(err));
    redirect(
      `/categories?error=${encodeURIComponent(
        explainEnqueueFailure(err),
      )}`,
    );
  }

  redirect("/categories?applied=1");
}
