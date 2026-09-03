import { type EnrichmentCandidate } from "@lead-intel/core";
import { businesses, fieldMetadata, identityKeys, providerCalls, type Database } from "@lead-intel/db";
import {
  ENRICHMENT_DEFINITIONS,
  type EnrichmentSource,
  type IdentityKeyType,
} from "@lead-intel/shared";
import { and, eq, inArray } from "drizzle-orm";
import { instagramBusiness } from "./instagram.js";
import { listingBusiness } from "./listing.js";
import { metaAdsBusiness } from "./meta-ads.js";

/**
 * The one place paid data is bought.
 *
 * Everything about this file exists to make spending money a deliberate act. The operator picks
 * the businesses, sees the price, and confirms — nothing here runs on a schedule or decides on
 * their behalf who is worth paying for.
 *
 * The same `gatherCandidates` that prices the confirm screen is what the run itself iterates, so
 * the preview cannot quote one number and the run spend another. That is not a convenience: a
 * confirm screen that is merely *usually* right is worse than none, because the operator stops
 * reading it.
 */

export interface EnrichmentRunResult {
  source: EnrichmentSource;
  bought: number;
  skippedAlreadyBought: number;
  skippedIneligible: number;
  failed: number;
  spentCents: number;
  stoppedAtCap: boolean;
  errors: string[];
}

/**
 * Works out, for one source, what each selected business needs — and does it by asking the ledger
 * and the identity keys, never by assuming.
 *
 * `alreadyBought` reads `provider_calls`, which is written **before** every paid call (schema.ts's
 * own comment on that table asks for exactly this, and it was corrected to do so). So a business
 * bought in an earlier run is recognised here and costs nothing.
 */
/**
 * What each source needs in hand before it is worth spending anything on.
 *
 * `missing` is the sentence the operator reads on the confirm screen next to a business that
 * cannot be bought, so it says what is absent rather than naming a column.
 */
type Prerequisite =
  | { kind: "identity_key"; value: IdentityKeyType; missing: string }
  | { kind: "field"; value: string; missing: string };

const PREREQUISITE: Record<EnrichmentSource, Prerequisite> = {
  places_details: { kind: "identity_key", value: "place_id", missing: "no Google listing to look up" },
  traffic_estimate: { kind: "identity_key", value: "domain", missing: "no website, so there is nothing to measure" },
  owner_mobile: { kind: "identity_key", value: "domain", missing: "no website, so there is nothing to look up" },
  instagram_profile: {
    kind: "field",
    value: "instagram_url",
    missing: "no Instagram link found on their website",
  },
  meta_ads: { kind: "field", value: "facebook_url", missing: "no Facebook page found on their website" },
};

export async function gatherCandidates(
  db: Database,
  source: EnrichmentSource,
  businessIds: string[],
): Promise<EnrichmentCandidate[]> {
  if (businessIds.length === 0) return [];

  const rows = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.status, "active"), inArray(businesses.id, businessIds)));
  const live = new Set(rows.map((r) => r.id));

  // What this source needs before it can look anything up.
  //
  // Two different kinds of prerequisite, which is why this is not one query. Places Details needs
  // a Google place id and the traffic estimate needs a domain — both identity keys. Instagram and
  // the Meta Ad Library need the *profile URL the crawler found on their website*, which lives in
  // `field_metadata`. Checking the wrong one would mark a business with a website but no Instagram
  // as eligible, charge for it, and store a result that reads as "we looked and they have no
  // Instagram" when nobody ever had a handle to look up.
  const prerequisite = PREREQUISITE[source];

  const hasPrerequisite = new Set<string>(
    prerequisite.kind === "identity_key"
      ? (
          await db
            .select({ businessId: identityKeys.businessId })
            .from(identityKeys)
            .where(and(eq(identityKeys.keyType, prerequisite.value), inArray(identityKeys.businessId, businessIds)))
        ).map((r) => r.businessId)
      : (
          await db
            .select({ businessId: fieldMetadata.businessId })
            .from(fieldMetadata)
            .where(and(eq(fieldMetadata.fieldName, prerequisite.value), inArray(fieldMetadata.businessId, businessIds)))
        ).map((r) => r.businessId),
  );

  const ledgerRows = await db
    .select({ businessId: providerCalls.businessId, status: providerCalls.status, endpoint: providerCalls.endpoint })
    .from(providerCalls)
    .where(inArray(providerCalls.businessId, businessIds));
  const bought = new Set(
    ledgerRows
      .filter((r) => r.endpoint === endpointFor(source) && r.status === "succeeded" && r.businessId !== null)
      .map((r) => r.businessId as string),
  );

  return businessIds.map((businessId) => {
    if (!live.has(businessId)) {
      return { businessId, alreadyBought: false, eligible: false, ineligibleReason: "not an active record" };
    }
    if (bought.has(businessId)) {
      return { businessId, alreadyBought: true, eligible: true };
    }
    if (!hasPrerequisite.has(businessId)) {
      return { businessId, alreadyBought: false, eligible: false, ineligibleReason: prerequisite.missing };
    }
    return { businessId, alreadyBought: false, eligible: true };
  });
}

/** Matches what each source writes into `provider_calls.endpoint`. */
function endpointFor(source: EnrichmentSource): string {
  switch (source) {
    case "places_details":
      return "places.details";
    case "instagram_profile":
      return "apify.instagram";
    case "meta_ads":
      return "apify.metaads";
    case "owner_mobile":
      return "lusha.contact";
    case "traffic_estimate":
      return "dataforseo.traffic";
  }
}

/**
 * Buys one source for a list of businesses, stopping cleanly at the spend cap.
 *
 * "Cleanly" is the operative word — spec §10.3: "A run that reaches its limit stops cleanly and
 * keeps everything it has already done." Everything bought before the cap is recorded and
 * useful; nothing is rolled back and nothing is half-written.
 */
export async function runEnrichmentSource(
  db: Database,
  params: { source: EnrichmentSource; businessIds: string[]; capCents: number },
): Promise<EnrichmentRunResult> {
  const definition = ENRICHMENT_DEFINITIONS[params.source];
  const result: EnrichmentRunResult = {
    source: params.source,
    bought: 0,
    skippedAlreadyBought: 0,
    skippedIneligible: 0,
    failed: 0,
    spentCents: 0,
    stoppedAtCap: false,
    errors: [],
  };

  if (definition.requiresEnvVar && !process.env[definition.requiresEnvVar]) {
    result.errors.push(
      `${definition.label} is not connected — ${definition.requiresEnvVar} is not set, so nothing was bought.`,
    );
    return result;
  }

  const candidates = await gatherCandidates(db, params.source, params.businessIds);

  for (const candidate of candidates) {
    if (candidate.alreadyBought) {
      result.skippedAlreadyBought += 1;
      continue;
    }
    if (!candidate.eligible) {
      result.skippedIneligible += 1;
      continue;
    }
    // Checked before each purchase, not after: the cap is a ceiling on what gets spent, not a
    // report on what already was.
    if (result.spentCents + definition.costCents > params.capCents) {
      result.stoppedAtCap = true;
      break;
    }

    try {
      const summary = await buyOne(db, params.source, candidate.businessId);
      result.spentCents += summary.costCents;
      if (summary.costCents > 0) result.bought += 1;
      else result.skippedAlreadyBought += 1;
    } catch (err) {
      result.failed += 1;
      result.errors.push(`${candidate.businessId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  result.spentCents = Math.round(result.spentCents * 100) / 100;
  return result;
}

async function buyOne(
  db: Database,
  source: EnrichmentSource,
  businessId: string,
): Promise<{ costCents: number }> {
  switch (source) {
    case "places_details": {
      // `force` because the operator has explicitly chosen this business — §9's gate is advice
      // about who looks worth calling, not a lock on what may be bought.
      const summary = await listingBusiness(db, businessId, { force: true });
      return { costCents: summary.costCents };
    }
    case "instagram_profile": {
      const summary = await instagramBusiness(db, businessId);
      return { costCents: summary.costCents };
    }
    case "meta_ads": {
      const summary = await metaAdsBusiness(db, businessId);
      return { costCents: summary.costCents };
    }
    case "owner_mobile":
    case "traffic_estimate":
      // Priced and listed in the UI so the operator knows the option exists, but refused here
      // rather than silently doing nothing — a source with no adapter must not look like one
      // that ran and found nothing.
      throw new Error(
        `${ENRICHMENT_DEFINITIONS[source].label} has no adapter built yet — nothing was bought and nothing was charged.`,
      );
  }
}
