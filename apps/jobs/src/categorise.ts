import { matchCategory, type CategoryEvidence, type CategoryRule } from "@lead-intel/core";
import { businesses, categoryRules, fieldMetadata, identityKeys, type Database } from "@lead-intel/db";
import { and, eq, inArray } from "drizzle-orm";

export interface CategoriseSummary {
  categorised: number;
  cleared: number;
  unmatched: number;
}

/**
 * Applies the operator's category rules to every active business.
 *
 * Free and re-runnable: it reads text already stored and writes a category, so changing a rule and
 * running this again is the whole edit-and-see loop. No crawl, no provider, no cost.
 *
 * A business that no longer matches any rule has its category **cleared**, not left behind. A
 * stale category is worse than none: it looks like a decision somebody made rather than the
 * residue of a rule that has since been rewritten.
 */
export async function categoriseAll(db: Database, onlyIds?: string[]): Promise<CategoriseSummary> {
  const rules = await loadRules(db);
  // Scoped when an import asks for its own rows and whole-list otherwise. An import that
  // re-categorised everything would be doing work the operator did not ask a file to do, and
  // would make the counts on the batch page describe the wrong set of businesses.
  const scope =
    onlyIds && onlyIds.length > 0
      ? and(eq(businesses.status, "active"), inArray(businesses.id, onlyIds))
      : eq(businesses.status, "active");

  const rows = await db.select({ id: businesses.id, name: businesses.displayName }).from(businesses).where(scope);

  if (rows.length === 0) return { categorised: 0, cleared: 0, unmatched: 0 };

  const ids = rows.map((r) => r.id);
  const evidence = await gatherEvidence(db, ids);

  let categorised = 0;
  let cleared = 0;
  let unmatched = 0;

  for (const row of rows) {
    const facts: CategoryEvidence = { businessName: row.name, ...(evidence.get(row.id) ?? {}) };
    const match = matchCategory(rules, facts);

    if (match) {
      await db
        .update(businesses)
        .set({
          category: match.category,
          subcategory: match.subcategory,
          categoryRuleId: match.rule.id,
          categorisedAt: new Date(),
        })
        .where(eq(businesses.id, row.id));
      categorised += 1;
    } else {
      const [existing] = await db
        .select({ category: businesses.category })
        .from(businesses)
        .where(eq(businesses.id, row.id))
        .limit(1);
      if (existing?.category) {
        await db
          .update(businesses)
          .set({ category: null, subcategory: null, categoryRuleId: null, categorisedAt: new Date() })
          .where(eq(businesses.id, row.id));
        cleared += 1;
      }
      unmatched += 1;
    }
  }

  return { categorised, cleared, unmatched };
}

export async function loadRules(db: Database): Promise<CategoryRule[]> {
  const rows = await db.select().from(categoryRules);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    subcategory: r.subcategory,
    priority: r.priority,
    enabled: r.enabled,
    sources: r.sources ?? [],
    anyOf: r.anyOf ?? [],
    noneOf: r.noneOf ?? [],
    websiteAnyOf: r.websiteAnyOf ?? [],
    instagramAnyOf: r.instagramAnyOf ?? [],
    requireAll: r.requireAll,
    minFollowers: r.minFollowers,
    maxFollowers: r.maxFollowers,
  }));
}

/**
 * Everything the rules may read, for a batch of businesses, in two queries.
 *
 * Batched rather than fetched per business because categorising a few hundred records is a loop
 * the operator will run every time they edit a rule — a round trip inside it would make the edit
 * loop slow enough that they stop using it.
 */
async function gatherEvidence(db: Database, ids: string[]): Promise<Map<string, CategoryEvidence>> {
  const WANTED = ["site_text", "instagram_bio", "instagram_category", "instagram_handle", "instagram_followers", "meta_ads_sample"];

  const [fields, domains] = await Promise.all([
    db
      .select({ businessId: fieldMetadata.businessId, fieldName: fieldMetadata.fieldName, value: fieldMetadata.value })
      .from(fieldMetadata)
      .where(and(inArray(fieldMetadata.businessId, ids), inArray(fieldMetadata.fieldName, WANTED))),
    db
      .select({ businessId: identityKeys.businessId, value: identityKeys.keyValue })
      .from(identityKeys)
      .where(and(inArray(identityKeys.businessId, ids), eq(identityKeys.keyType, "domain"))),
  ]);

  const out = new Map<string, CategoryEvidence>();
  const at = (id: string): CategoryEvidence => {
    const existing = out.get(id);
    if (existing) return existing;
    const fresh: CategoryEvidence = {};
    out.set(id, fresh);
    return fresh;
  };

  for (const row of domains) at(row.businessId).websiteDomain = row.value;

  for (const row of fields) {
    if (row.businessId === null) continue;
    const target = at(row.businessId);
    switch (row.fieldName) {
      case "site_text":
        target.websiteText = row.value;
        break;
      case "instagram_bio":
        target.instagramBio = row.value;
        break;
      case "instagram_category":
        target.instagramCategory = row.value;
        break;
      case "instagram_handle":
        target.instagramHandle = row.value;
        break;
      case "meta_ads_sample":
        target.metaAdsText = row.value;
        break;
      case "instagram_followers": {
        // Stored as text like every other field. A value that will not parse is left as unknown
        // rather than coerced to 0, which a follower gate would then read as "has no followers".
        const n = Number(row.value);
        target.instagramFollowers = Number.isFinite(n) ? n : null;
        break;
      }
    }
  }

  return out;
}
