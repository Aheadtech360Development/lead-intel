/**
 * Every paid data source, in one table.
 *
 * This exists so that buying data is always a **deliberate, priced, per-business choice** rather
 * than something a background job does on everyone's behalf. Until now the Places listing lookup
 * ran automatically for every business past the Stage 5 gate — 75 businesses at $0.035 each, so
 * cheap that nobody noticed the shape of it. The next source is not cheap: an owner's mobile is
 * about $0.73, which is $60 for the same 75 businesses and $2,044 for the 2,800 in spec §10.2's
 * worked example. Buying those for businesses nobody intends to call is money set on fire.
 *
 * The operator now selects the businesses, sees the exact cost, and confirms. This registry is
 * what makes that screen generic: adding a source here gives it a row in the UI, a price in the
 * estimate, and a line in the ledger, with no page to change.
 *
 * §9's Stage 5 gate does not disappear — it becomes what it always should have been: **advice
 * about who looks worth calling, not an instruction to spend money on them.**
 */

/** The identifier stored in `provider_calls.endpoint` and used in URLs. */
export const ENRICHMENT_SOURCES = [
  "places_details",
  "instagram_profile",
  "meta_ads",
  "owner_mobile",
  "traffic_estimate",
] as const;
export type EnrichmentSource = (typeof ENRICHMENT_SOURCES)[number];

export interface EnrichmentDefinition {
  id: EnrichmentSource;
  /** What the operator sees. Plain words, never the provider's product name alone. */
  label: string;
  /** One sentence: what this actually adds to a record. */
  describes: string;
  /** Cost in cents for ONE business. Fractional — provider_calls rounds when it stores. */
  costCents: number;
  /** Who we buy it from, shown so the operator knows where the money goes. */
  provider: string;
  /**
   * Which checks or fields this fills in. Shown on the confirm screen so the operator can see
   * what they are actually paying to learn.
   */
  fills: string[];
  /**
   * The environment variable this source needs. Null when it uses a key the project already has.
   * A source whose key is missing is shown, priced, and **disabled** — visible so the operator
   * knows the option exists, unbuyable so nothing fails halfway through a paid run.
   */
  requiresEnvVar: string | null;
  /** Shown in red on the confirm screen. Null when there is nothing to warn about. */
  warning: string | null;
}

export const ENRICHMENT_DEFINITIONS: Record<EnrichmentSource, EnrichmentDefinition> = {
  places_details: {
    id: "places_details",
    label: "Google listing details",
    describes: "Their star rating, how many reviews, opening hours, and the category Google files them under.",
    // Enterprise field mask (rating, userRatingCount, regularOpeningHours) → $35 per 1,000.
    costCents: 3.5,
    provider: "Google Places API",
    fills: ["S1", "S3", "S5", "S6", "R1", "R2"],
    requiresEnvVar: null, // the existing GOOGLE_PLACES_API_KEY covers it
    warning: null,
  },

  instagram_profile: {
    id: "instagram_profile",
    label: "Their Instagram: followers and category",
    describes:
      "How many people follow them, the category Instagram publishes for the account, their bio, and the link they put in it.",
    // Apify's first-party profile actor: $2.60 per 1,000 profiles on the free plan, $2.30 on
    // Starter. Priced at the free-plan rate so the confirm screen never quotes less than the
    // amount that will actually be charged.
    costCents: 0.26,
    provider: "Apify (Instagram)",
    fills: ["instagram_followers", "instagram_category", "instagram_bio", "category_rules"],
    requiresEnvVar: "APIFY_TOKEN",
    warning:
      "Instagram publishes a follower count, never a list of followers — who follows an account cannot be obtained at any price. Reading profiles this way is also against Instagram's terms of service; the official Meta route needs App Review, which takes 60+ days and is often refused.",
  },

  meta_ads: {
    id: "meta_ads",
    label: "Are they running Facebook or Instagram ads?",
    describes:
      "Whether they have ads live right now, how many, how long they have been running, and what the ads say.",
    // Apify's Facebook Ads Library actor bills per ad, not per business, at $5.80 per 1,000 on the
    // free plan. Capped at 20 ads per business by the adapter, so this is the worst case for one
    // business; most return far fewer.
    costCents: 11.6,
    provider: "Apify (Meta Ad Library)",
    fills: ["meta_ads_running", "meta_ads_since", "N2"],
    requiresEnvVar: "APIFY_TOKEN",
    warning:
      "Meta publishes ad spend only for political and social-issue ads. For an ordinary business the spend figure is empty in Meta's own Ad Library, so it cannot be bought from anyone — you get whether they advertise and since when, not how much it costs them.",
  },

  owner_mobile: {
    id: "owner_mobile",
    label: "Owner's mobile number",
    describes: "A direct mobile for the person who owns the business, rather than the shop's main line.",
    // Lusha Pro: $69.90/month for 480 credits, a phone reveal costs 5 credits → $0.728 each.
    costCents: 73,
    provider: "Lusha",
    fills: ["contact_mobile", "contact_name"],
    requiresEnvVar: "LUSHA_API_KEY",
    warning:
      "Calling a personal mobile is not covered by the B2B exemption — US law treats every mobile as residential, at $500–$1,500 per violation. Their business landline is the safe number to ring.",
  },

  traffic_estimate: {
    id: "traffic_estimate",
    label: "How much traffic their site gets",
    describes: "An estimate of monthly visitors from search, worked out from the keywords they rank for.",
    // DataForSEO Labs bulk traffic estimation: $0.12 per task of up to 1,000 domains, plus
    // $0.0012 per domain. The per-task part is negligible spread across a real batch.
    costCents: 0.12,
    provider: "DataForSEO",
    fills: ["monthly_visits_estimate"],
    requiresEnvVar: "DATAFORSEO_LOGIN",
    warning:
      "An estimate, not real analytics — it counts search traffic only, so anyone typing the address directly or arriving from social is not in it.",
  },
};

/** The order the confirm screen lists them in: cheapest and least fraught first. */
export const ENRICHMENT_ORDER: EnrichmentSource[] = [
  "instagram_profile",
  "places_details",
  "meta_ads",
  "traffic_estimate",
  "owner_mobile",
];

export function isEnrichmentSource(value: string): value is EnrichmentSource {
  return (ENRICHMENT_SOURCES as readonly string[]).includes(value);
}

/**
 * The default ceiling on a single enrichment run, in cents.
 *
 * Present as a default rather than a blank field for the same reason the discovery screen defaults
 * its spend limit: a cap the operator has to remember to type is one they will eventually forget,
 * and the run that forgets it is the expensive one.
 */
export const DEFAULT_ENRICHMENT_SPEND_CAP_CENTS = 500;
