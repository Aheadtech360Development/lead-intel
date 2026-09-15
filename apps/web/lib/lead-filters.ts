import { createClient } from "@/lib/supabase/server";

/**
 * One definition of "the businesses currently on screen", shared by the list and the buy screen.
 *
 * These two had drifted, and the drift was pointed at money. The leads list filters a few hundred
 * rows in memory across eleven filters; the buy screen rebuilt the set from a query that applied
 * six of them. Category, the rule that assigned it, whether they advertise, the follower floor, the
 * search box and the claim filter were all silently dropped — so "Get paid data for all 47" could
 * hand the purchase a different, larger set than the 47 the operator had counted on screen.
 *
 * The fix is not to keep the two queries in step by hand. It is to have one function, called by
 * both, so they cannot disagree — the same discipline `runChecklist` follows between the web app
 * and the worker.
 */

export interface LeadFilters {
  view?: string;
  tier?: string;
  route?: string;
  website?: string;
  from?: string;
  batch?: string;
  icp?: string;
  rule?: string;
  ads?: string;
  minFollowers?: string;
  q?: string;
  claimed?: string;
  /**
   * Google reviews. "50" means at least fifty; "none" means a listing that has been looked up and
   * has none at all.
   *
   * A business whose listing nobody has bought has no answer here, and an unanswerable filter
   * refuses rather than passes — the same rule an ICP's conditions follow.
   */
  reviews?: string;
  /** A town or state, matched loosely against both, because that is how an operator says a place. */
  where?: string;
}

/** The columns every filter needs. Kept here so a new filter cannot forget to select its column. */
export const LEAD_COLUMNS =
  "id, display_name, city, state, website_status, tier, problem_score, intent_score, route, route_reason, claim_status, claimed_by, passed_gate, manual_review_status, origin, import_batch_id, icp_name, icp_id, scored_at";

export interface LeadRow {
  id: string;
  display_name: string;
  city: string | null;
  state: string | null;
  tier: number | null;
  route: string | null;
  website_status: string;
  claim_status: string | null;
  claimed_by: string | null;
  passed_gate: boolean | null;
  origin: string | null;
  import_batch_id: string | null;
  icp_name: string | null;
  icp_id: string | null;
  scored_at: string | null;
}

export interface SocialFacts {
  followers: number | null;
  handle: string | null;
  adsRunning: boolean | null;
  /** Whether Google or a crawl ever produced a web address for them at all. */
  hasWebsiteUrl: boolean;
  /**
   * How many Google reviews they have, or null when nobody has bought their listing.
   *
   * Null and zero are different answers and the row tinting depends on the difference: a business
   * with proven demand and no website is the strongest lead on the list, and one nobody has looked
   * up yet is not a claim about anything.
   */
  reviews: number | null;
}

/**
 * Whether one business survives the filters.
 *
 * Exported so the list can apply it to rows it has already loaded, rather than fetching twice.
 */
export function matchesFilters(
  business: Pick<
    LeadRow,
    | "id"
    | "display_name"
    | "city"
    | "state"
    | "tier"
    | "route"
    | "website_status"
    | "claim_status"
    | "claimed_by"
    | "passed_gate"
    | "origin"
    | "import_batch_id"
    | "icp_name"
    | "icp_id"
    | "scored_at"
  >,
  filters: LeadFilters,
  context: { social: Map<string, SocialFacts>; userId: string | null },
): boolean {
  const view = filters.view === "everything" ? "everything" : filters.view === "unanalysed" ? "unanalysed" : "ready";

  if (view === "ready" && !business.passed_gate) return false;
  if (view === "unanalysed" && business.scored_at !== null) return false;

  const needle = (filters.q ?? "").trim().toLowerCase();
  if (needle.length > 0) {
    const hay = [business.display_name, business.city, business.state, business.icp_name];
    if (!hay.some((f) => typeof f === "string" && f.toLowerCase().includes(needle))) return false;
  }

  if (filters.claimed === "me" && business.claimed_by !== context.userId) return false;
  if (filters.claimed === "anyone" && business.claim_status !== "claimed") return false;
  if (filters.claimed === "nobody" && business.claim_status === "claimed") return false;

  if (filters.tier && String(business.tier) !== filters.tier) return false;
  if (filters.route && business.route !== filters.route) return false;
  if (filters.website && business.website_status !== filters.website) return false;
  if (filters.from && business.origin !== filters.from) return false;
  if (filters.batch && business.import_batch_id !== filters.batch) return false;
  if (filters.icp && business.icp_name !== filters.icp) return false;
  if (filters.rule && business.icp_id !== filters.rule) return false;

  if (filters.ads) {
    const running = context.social.get(business.id)?.adsRunning ?? null;
    // Unknown is neither yes nor no. A business whose ads were never checked must not appear under
    // "not advertising", which would be a claim nobody made.
    if (running === null || running !== (filters.ads === "yes")) return false;
  }

  if (filters.minFollowers) {
    const followers = context.social.get(business.id)?.followers ?? null;
    if (followers === null || followers < Number(filters.minFollowers)) return false;
  }

  if (filters.reviews) {
    const reviews = context.social.get(business.id)?.reviews ?? null;
    if (reviews === null) return false;
    if (filters.reviews === "none") {
      if (reviews !== 0) return false;
    } else if (reviews < Number(filters.reviews)) return false;
  }

  if (filters.where) {
    const wanted = filters.where.trim().toLowerCase();
    const where = [business.city, business.state].filter(Boolean).join(", ").toLowerCase();
    if (wanted.length > 0 && !where.includes(wanted)) return false;
  }

  return true;
}

/** The Instagram and ads facts the last two filters need, keyed by business. */
export async function loadSocialFacts(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Map<string, SocialFacts>> {
  const { data } = await supabase
    .from("field_metadata")
    .select("business_id, field_name, value")
    .in("field_name", ["instagram_followers", "instagram_handle", "meta_ads_running", "review_count", "website_url"])
    // Explicit, because PostgREST caps an unbounded select at 1,000 rows and reports the truncation
    // as an ordinary success.
    .limit(20000);

  const social = new Map<string, SocialFacts>();
  for (const row of data ?? []) {
    const at = social.get(row.business_id) ?? {
      followers: null,
      handle: null,
      adsRunning: null,
      reviews: null,
      hasWebsiteUrl: false,
    };
    if (row.field_name === "instagram_followers") {
      const n = Number(row.value);
      // Left unknown rather than coerced to 0 — a private account has no published count, and a
      // "5,000+ followers" filter must not sweep it in as though it had none.
      at.followers = Number.isFinite(n) ? n : null;
    }
    if (row.field_name === "instagram_handle") at.handle = row.value;
    if (row.field_name === "meta_ads_running") at.adsRunning = row.value === "true";
    if (row.field_name === "website_url") at.hasWebsiteUrl = Boolean(row.value);
    if (row.field_name === "review_count") {
      const n = Number(row.value);
      at.reviews = Number.isFinite(n) ? n : null;
    }
    social.set(row.business_id, at);
  }
  return social;
}

/**
 * Every business the given filters select, by id.
 *
 * Used by the buy screen when the operator pressed "all N" rather than ticking rows. It loads the
 * whole active set and applies the same predicate the list does, which is a few hundred rows —
 * cheaper and far safer than a second query that has to be kept in step by hand.
 */
/**
 * How a row is tinted, or null when nothing about it is worth marking.
 *
 * Named for the tint rather than for a gap, because one of the four is the absence of a gap: a
 * business with both a working site and an Instagram account gets its own colour precisely because
 * there is nothing missing.
 *
 * The point is to make four situations legible at a glance without reading anything — they have
 * proven demand and nothing else, an audience with nowhere to send it, a site but no social, or
 * both.
 *
 * **"Couldn't check" is not "hasn't got".** A website we failed to reach produces no tint at all —
 * the same distinction this codebase keeps everywhere else, and colouring a row on a failed crawl
 * would be telling the operator something nobody established.
 */
export type LeadTint = "no-website" | "no-instagram" | "nothing-but-demand" | "has-both";

export function leadTint(
  business: Pick<LeadRow, "id" | "website_status">,
  social: Map<string, SocialFacts>,
): LeadTint | null {
  const facts = social.get(business.id);
  const hasInstagram = Boolean(facts?.handle);
  const reviews = facts?.reviews ?? null;

  const working = business.website_status === "live";

  /**
   * `unclear` is two different answers, and only one of them is "no website".
   *
   * Measured on the live list: 54 businesses are `unclear` with **no web address at all** — Google
   * has none for them and no crawl ever found one, which for an operator's purposes is exactly "no
   * website". Another 63 are `unclear` *with* an address we simply could not reach, which is a fact
   * about our crawl and not about them.
   *
   * Treating the two the same would either miss the 54 the whole product is aimed at, or accuse 63
   * live businesses of having no website. So the address decides it, and a business we merely
   * failed to reach stays untinted — the same third state kept everywhere else here.
   */
  const noAddressAnywhere = facts?.hasWebsiteUrl === false;
  const missing =
    business.website_status === "no_website" ||
    business.website_status === "social_only" ||
    business.website_status === "dead" ||
    (business.website_status === "unclear" && noAddressAnywhere);

  if (missing && !hasInstagram && reviews !== null && reviews > 0) return "nothing-but-demand";
  if (missing && hasInstagram) return "no-website";
  if (working && !hasInstagram) return "no-instagram";
  // Both in place. Not a lead to open with, which is exactly why it is worth being able to skip at
  // a glance rather than reading two columns to work it out.
  if (working && hasInstagram) return "has-both";
  return null;
}

export async function selectFilteredIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filters: LeadFilters,
  userId: string | null,
): Promise<string[]> {
  const [{ data: rows }, social] = await Promise.all([
    supabase.from("businesses").select(LEAD_COLUMNS).eq("status", "active").limit(20000),
    loadSocialFacts(supabase),
  ]);

  return (rows ?? [])
    .filter((b) => matchesFilters(b as unknown as LeadRow, filters, { social, userId }))
    .map((b) => b.id);
}
