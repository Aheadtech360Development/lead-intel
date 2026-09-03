import { matchCategory, type CategoryEvidence, type CategoryRule } from "@lead-intel/core";
import type { createClient } from "@/lib/supabase/server";

/**
 * What a rule would catch, before it is saved.
 *
 * The operator's own worry, in their words: *"agar mujhe kuch nahi chahiye ho aur wo mene daal diya
 * ghalti se to wo bekaar ho jayega"* — if a word goes in that should not have, the rule is quietly
 * useless. That is a real risk and it gets worse the moment anything writes the words for them.
 *
 * The answer is not to trust whoever wrote the words. It is to **show the result before saving**.
 * A rule containing "shop" will catch 187 of 330 businesses, and no amount of reasoning about the
 * word conveys that as well as the number does. This runs the exact matcher the real pass uses —
 * `matchCategory` from packages/core, the same function, not a similar one — over the evidence
 * already stored, so what the preview says and what Apply does cannot drift apart.
 *
 * Free. Reads stored text and matches strings; no crawl, no provider, no model.
 */

export interface RulePreview {
  /** Businesses this rule would take, best-known name first. */
  matched: Array<{ id: string; name: string; term: string; where: string; group: string }>;
  /** How many it would take in total, before the sample was cut. */
  total: number;
  /** How many active businesses it was measured against. */
  outOf: number;
  /**
   * Businesses this rule would take **away from a rule that currently owns them**.
   *
   * First-match-wins means a new high-priority rule silently re-files whatever it catches. Showing
   * that as its own number is the difference between "this catches 40" and "this catches 40, and 31
   * of them are currently your DTF leads".
   */
  stolenFrom: Array<{ ruleName: string; count: number }>;
  /** Set when the rule cannot match anything as written, with the reason. */
  impossible: string | null;
}

const SAMPLE = 25;

export async function previewRule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  draft: CategoryRule,
): Promise<RulePreview> {
  const groups = [draft.anyOf, draft.websiteAnyOf, draft.instagramAnyOf].filter((g) => g.length > 0);
  const gated = draft.minFollowers !== null || draft.maxFollowers !== null;

  if (groups.length === 0 && !gated) {
    return {
      matched: [],
      total: 0,
      outOf: 0,
      stolenFrom: [],
      impossible: "This rule has no words and no follower range, so it would never match anything.",
    };
  }

  const [{ data: businessRows }, { data: fieldRows }, { data: keyRows }, { data: ruleRows }] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, display_name, category, subcategory, category_rule_id")
      .eq("status", "active")
      .limit(20000),
    supabase
      .from("field_metadata")
      .select("business_id, field_name, value")
      .in("field_name", [
        "site_text",
        "instagram_bio",
        "instagram_category",
        "instagram_handle",
        "instagram_followers",
        "meta_ads_sample",
      ])
      .limit(100000),
    supabase.from("identity_keys").select("business_id, key_value").eq("key_type", "domain").limit(50000),
    supabase.from("category_rules").select("id, name").limit(500),
  ]);

  const ruleNames = new Map((ruleRows ?? []).map((r) => [r.id as string, r.name as string]));

  // Same shape as apps/jobs' gatherEvidence: fields arrive as rows and are folded into one bag per
  // business. Kept here rather than imported because that one speaks Drizzle to the database
  // directly and this runs through the operator's own session, where RLS applies.
  const evidence = new Map<string, CategoryEvidence>();
  const bag = (id: string): CategoryEvidence => {
    const found = evidence.get(id);
    if (found) return found;
    const fresh: CategoryEvidence = {};
    evidence.set(id, fresh);
    return fresh;
  };

  for (const k of keyRows ?? []) bag(k.business_id as string).websiteDomain = k.key_value;

  for (const f of fieldRows ?? []) {
    if (!f.business_id) continue;
    const target = bag(f.business_id);
    switch (f.field_name) {
      case "site_text":
        target.websiteText = f.value;
        break;
      case "instagram_bio":
        target.instagramBio = f.value;
        break;
      case "instagram_category":
        target.instagramCategory = f.value;
        break;
      case "instagram_handle":
        target.instagramHandle = f.value;
        break;
      case "meta_ads_sample":
        target.metaAdsText = f.value;
        break;
      case "instagram_followers": {
        const n = Number(f.value);
        target.instagramFollowers = Number.isFinite(n) ? n : null;
        break;
      }
    }
  }

  const matched: RulePreview["matched"] = [];
  const stolen = new Map<string, number>();
  let total = 0;

  for (const b of businessRows ?? []) {
    const facts: CategoryEvidence = { businessName: b.display_name, ...(evidence.get(b.id) ?? {}) };
    // The draft alone, not the whole ordered set. The question this answers is "what does *this*
    // rule reach", which is what the operator is editing; where it lands once the others are in
    // play is the `stolenFrom` number below.
    const hit = matchCategory([draft], facts);
    if (!hit) continue;

    total += 1;
    if (matched.length < SAMPLE) {
      matched.push({
        id: b.id,
        name: b.display_name,
        term: hit.matchedTerm,
        where: hit.matchedIn,
        group: hit.hits[0]?.group ?? "anywhere",
      });
    }

    const owner = b.category_rule_id as string | null;
    if (owner && owner !== draft.id) {
      const name = ruleNames.get(owner) ?? "another rule";
      stolen.set(name, (stolen.get(name) ?? 0) + 1);
    }
  }

  return {
    matched,
    total,
    outOf: (businessRows ?? []).length,
    stolenFrom: [...stolen.entries()]
      .map(([ruleName, count]) => ({ ruleName, count }))
      .sort((a, b) => b.count - a.count),
    impossible: null,
  };
}
