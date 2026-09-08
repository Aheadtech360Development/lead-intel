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
  category?: string;
  subcategory?: string;
  rule?: string;
  ads?: string;
  minFollowers?: string;
  q?: string;
  claimed?: string;
}

/** The columns every filter needs. Kept here so a new filter cannot forget to select its column. */
export const LEAD_COLUMNS =
  "id, display_name, city, state, website_status, tier, problem_score, intent_score, route, route_reason, claim_status, claimed_by, passed_gate, manual_review_status, origin, import_batch_id, category, subcategory, category_rule_id, scored_at";

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
  category: string | null;
  subcategory: string | null;
  category_rule_id: string | null;
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
    | "category"
    | "subcategory"
    | "category_rule_id"
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
    const hay = [business.display_name, business.city, business.state, business.category, business.subcategory];
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
  if (filters.category && business.category !== filters.category) return false;
  if (filters.subcategory && business.subcategory !== filters.subcategory) return false;
  if (filters.rule && business.category_rule_id !== filters.rule) return false;

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
 * What is missing from a business, as a single word, or null when nothing worth marking is.
 *
 * Used to tint the row. The point is to make three situations visible at a glance without reading
 * anything: they have an audience but nowhere to send it, they have a website but no social, or
 * they have proven demand and neither.
 *
 * **"Couldn't check" is not "hasn't got".** A website we failed to reach produces no tint at all —
 * the same distinction this codebase keeps everywhere else, and colouring a row on a failed crawl
 * would be telling the operator something nobody established.
 */
export type LeadGap = "no-website" | "no-instagram" | "nothing-but-demand";

export function leadGap(
  business: Pick<LeadRow, "id" | "website_status">,
  social: Map<string, SocialFacts>,
): LeadGap | null {
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
