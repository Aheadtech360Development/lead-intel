import { matchIcp, type Icp, type IcpEvidence } from "@lead-intel/core";
import { businesses, icps, fieldMetadata, identityKeys, type Database } from "@lead-intel/db";
import { and, eq, inArray } from "drizzle-orm";

export interface IcpMatchSummary {
  matched: number;
  cleared: number;
  unmatched: number;
}

/**
 * Works out which of the operator's ICPs each active business is.
 *
 * Free and re-runnable: it reads facts already stored and writes a name, so changing an ICP and
 * running this again is the whole edit-and-see loop. No crawl, no provider, no cost.
 *
 * A business that no longer matches any ICP has its ICP **cleared**, not left behind. A stale
 * answer is worse than none: it looks like a decision somebody made rather than the residue of an
 * ICP that has since been rewritten.
 */
export async function matchAllIcps(db: Database, onlyIds?: string[]): Promise<IcpMatchSummary> {
  const rules = await loadRules(db);
  // Scoped when an import asks for its own rows and whole-list otherwise. An import that
  // re-matched everything would be doing work the operator did not ask a file to do, and
  // would make the counts on the batch page describe the wrong set of businesses.
  const scope =
    onlyIds && onlyIds.length > 0
      ? and(eq(businesses.status, "active"), inArray(businesses.id, onlyIds))
      : eq(businesses.status, "active");

  const rows = await db
    .select({
      id: businesses.id,
      name: businesses.displayName,
      // Read here rather than in gatherEvidence: these three are columns on the business itself,
      // and an ICP's conditions ask about them directly.
      websiteStatus: businesses.websiteStatus,
      city: businesses.city,
      state: businesses.state,
    })
    .from(businesses)
    .where(scope);

  if (rows.length === 0) return { matched: 0, cleared: 0, unmatched: 0 };

  const ids = rows.map((r) => r.id);
  const evidence = await gatherEvidence(db, ids);

  let matched = 0;
  let cleared = 0;
  let unmatched = 0;

  for (const row of rows) {
    const facts: IcpEvidence = {
      businessName: row.name,
      // "live" is the only status that means a site was actually reached and read. "unclear" is
      // the third answer — nobody knows — so an ICP that requires a website declines it rather
      // than guessing, which is what `hasWebsite: null` says.
      hasWebsite:
        row.websiteStatus === "live"
          ? true
          : row.websiteStatus === "unclear"
            ? null
            : false,
      city: row.city,
      state: row.state,
      ...(evidence.get(row.id) ?? {}),
    };
    const match = matchIcp(rules, facts);

    if (match) {
      await db
        .update(businesses)
        .set({ icpName: match.name, icpId: match.icp.id, icpMatchedAt: new Date() })
        .where(eq(businesses.id, row.id));
      matched += 1;
    } else {
      const [existing] = await db
        .select({ icpName: businesses.icpName })
        .from(businesses)
        .where(eq(businesses.id, row.id))
        .limit(1);
      if (existing?.icpName) {
        await db
          .update(businesses)
          .set({ icpName: null, icpId: null, icpMatchedAt: new Date() })
          .where(eq(businesses.id, row.id));
        cleared += 1;
      }
      unmatched += 1;
    }
  }

  return { matched, cleared, unmatched };
}

export async function loadRules(db: Database): Promise<Icp[]> {
  const rows = await db.select().from(icps);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    industry: r.industry,
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
    searchTerms: r.searchTerms ?? [],
    requiresWebsite: r.requiresWebsite,
    minReviews: r.minReviews,
    places: r.places ?? [],
  }));
}

/**
 * Everything the rules may read, for a batch of businesses, in two queries.
 *
 * Batched rather than fetched per business because categorising a few hundred records is a loop
 * the operator will run every time they edit a rule — a round trip inside it would make the edit
 * loop slow enough that they stop using it.
 */
export async function gatherEvidence(db: Database, ids: string[]): Promise<Map<string, IcpEvidence>> {
  const WANTED = [
    "site_text",
    "instagram_bio",
    "instagram_category",
    "instagram_handle",
    "instagram_followers",
    "meta_ads_sample",
    "review_count",
  ];

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

  const out = new Map<string, IcpEvidence>();
  const at = (id: string): IcpEvidence => {
    const existing = out.get(id);
    if (existing) return existing;
    const fresh: IcpEvidence = {};
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
      case "review_count": {
        // Same rule as followers: unparseable stays unknown rather than becoming 0, which a
        // "20+ reviews" condition would otherwise read as a business with no reviews.
        const n = Number(row.value);
        target.reviewCount = Number.isFinite(n) ? n : null;
        break;
      }
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
