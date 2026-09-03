import { ENRICHMENT_DEFINITIONS } from "@lead-intel/shared";
import { businesses, describeDbError, fieldMetadata, type Database } from "@lead-intel/db";
import { fetchInstagramProfile, isInstagramOk, isApifyFatal } from "@lead-intel/providers";
import { and, eq } from "drizzle-orm";
import { upsertFieldMetadata } from "./field-metadata.js";
import { recordProviderCall } from "./provider-calls.js";

export interface InstagramSummary {
  businessId: string;
  name: string;
  handle: string | null;
  outcome: string;
  followers: number | null;
  category: string | null;
  costCents: number;
  /** True when the Apify account is out of credit — the caller must stop the whole pass. */
  fatal: boolean;
}

/**
 * Buys one business's Instagram profile and stores what it says about them.
 *
 * The handle is not searched for — it is the URL the crawler already found linked from their own
 * website. That matters for accuracy as much as for cost: searching Instagram for "Miami Printing"
 * returns somebody's account, and reporting a stranger's follower count against a business is a
 * mistake nobody would catch by reading the number.
 *
 * **The follower count is a number, never a list.** No source, free or paid, publishes who follows
 * an account, so nothing downstream can be built on that.
 */
export async function instagramBusiness(db: Database, businessId: string): Promise<InstagramSummary> {
  const [business] = await db
    .select({ id: businesses.id, name: businesses.displayName })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) throw new Error(`business ${businessId} not found`);

  const [link] = await db
    .select({ value: fieldMetadata.value })
    .from(fieldMetadata)
    .where(and(eq(fieldMetadata.businessId, businessId), eq(fieldMetadata.fieldName, "instagram_url")))
    .limit(1);

  const base = { businessId, name: business.name, handle: null, followers: null, category: null, fatal: false };

  if (!link?.value) {
    // No charge, and no stored outcome: there was nothing to look up, so writing one would mark
    // this business as done and skip it forever if a handle turns up later.
    return { ...base, outcome: "no_handle", costCents: 0 };
  }

  const cost = ENRICHMENT_DEFINITIONS.instagram_profile.costCents;

  // Written before the call, exactly as every other paid source does it — a ledger entry made
  // afterwards is one that a crash can lose, and a lost entry means paying twice.
  const ledger = await recordProviderCall(db, {
    businessId,
    provider: "apify",
    endpoint: "apify.instagram",
    costCents: cost,
  });
  if (ledger === "already_bought") {
    return { ...base, outcome: "already_bought", costCents: 0 };
  }

  const result = await fetchInstagramProfile({ url: link.value });

  if (!isInstagramOk(result)) {
    const fatal = isApifyFatal(result);
    await recordProviderCall(db, {
      businessId,
      provider: "apify",
      endpoint: "apify.instagram",
      costCents: fatal ? 0 : cost,
      status: "failed",
      detail: result.providerMessage ?? result.detail ?? result.outcome,
    });
    return { ...base, outcome: result.outcome, costCents: fatal ? 0 : cost, fatal };
  }

  const fields: { fieldName: string; value: string; sourceName: string }[] = [
    { fieldName: "instagram_handle", value: result.username, sourceName: "apify_instagram" },
    { fieldName: "instagram_checked_at", value: new Date().toISOString(), sourceName: "apify_instagram" },
  ];
  // Each guarded separately. A private account has a real username and no follower count, and
  // storing 0 for it would be a claim the source never made.
  if (result.followersCount !== null) {
    fields.push({ fieldName: "instagram_followers", value: String(result.followersCount), sourceName: "apify_instagram" });
  }
  if (result.postsCount !== null) {
    fields.push({ fieldName: "instagram_posts", value: String(result.postsCount), sourceName: "apify_instagram" });
  }
  if (result.categoryName) {
    fields.push({ fieldName: "instagram_category", value: result.categoryName, sourceName: "apify_instagram" });
  }
  if (result.biography) {
    fields.push({ fieldName: "instagram_bio", value: result.biography.slice(0, 1000), sourceName: "apify_instagram" });
  }
  if (result.externalUrl) {
    fields.push({ fieldName: "instagram_link", value: result.externalUrl, sourceName: "apify_instagram" });
  }
  if (result.isVerified !== null) {
    fields.push({ fieldName: "instagram_verified", value: String(result.isVerified), sourceName: "apify_instagram" });
  }
  if (result.isPrivate !== null) {
    fields.push({ fieldName: "instagram_private", value: String(result.isPrivate), sourceName: "apify_instagram" });
  }

  try {
    await upsertFieldMetadata(db, businessId, fields);
  } catch (err) {
    throw new Error(`failed to record Instagram for ${business.name}: ${describeDbError(err)}`);
  }

  return {
    businessId,
    name: business.name,
    handle: result.username,
    outcome: "ok",
    followers: result.followersCount,
    category: result.categoryName,
    costCents: cost,
    fatal: false,
  };
}
