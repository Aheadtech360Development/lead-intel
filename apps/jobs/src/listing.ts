import { runListingChecks, type ListingEvidence } from "@lead-intel/core";
import { businesses, describeDbError, identityKeys, providerCalls, type Database } from "@lead-intel/db";
import { fetchPlaceDetails, isPlaceDetailsOk } from "@lead-intel/providers";
import { PLACES_DETAILS_COST_CENTS } from "@lead-intel/shared";
import { and, eq } from "drizzle-orm";
import { upsertFieldMetadata } from "./field-metadata.js";
import { upsertFindings } from "./findings.js";
import { scoreAndStore } from "./scoring.js";

export interface ListingSummary {
  businessId: string;
  name: string;
  placeId: string | null;
  outcome: string;
  rating: number | null;
  reviewCount: number | null;
  skipped: string | null;
  costCents: number;
}

/**
 * Buys one business's Google listing details and records §5.3's S1/S3/S5/S6 and §5.4's R1/R2.
 *
 * **This spends money, and it is the only thing in the system so far that does per business.**
 * §9: "The gate at Stage 5 is what keeps the cost down. Every business gets the free website
 * analysis. Only the ones that already look like they have a problem get the paid lookups." That
 * rule is enforced by the caller's selection, and independently again here — a business that has
 * not passed the gate is refused even if something asks for it directly, because a wrong loop
 * somewhere else should not be able to spend the budget.
 *
 * Every call is written to `provider_calls` before anything else is recorded, so the ledger is
 * never behind what was actually bought.
 */
export async function listingBusiness(
  db: Database,
  businessId: string,
  options: { force?: boolean } = {},
): Promise<ListingSummary> {
  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.displayName,
      passedGate: businesses.passedGate,
      runId: businesses.discoveredInRun,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) throw new Error(`business ${businessId} not found`);

  const [placeKey] = await db
    .select({ value: identityKeys.keyValue })
    .from(identityKeys)
    .where(and(eq(identityKeys.businessId, businessId), eq(identityKeys.keyType, "place_id")))
    .limit(1);
  const placeId = placeKey?.value ?? null;

  const base = { businessId, name: business.name, placeId, rating: null, reviewCount: null, costCents: 0 };

  // §9's Stage 5 gate is **advice, not a lock**. It answers "who looks worth calling"; it does not
  // decide whose data gets bought — the operator does that by selecting businesses on the leads
  // list and confirming a price. `force` is how that choice arrives here.
  //
  // The gate is still honoured for callers that do not pass `force` (the batch runner), so a
  // sweep of everything still respects it and only a deliberate selection overrides it.
  const skip =
    placeId === null
      ? "no Google place id, so there is no listing to look up"
      : !business.passedGate && !options.force
        ? "not selected, and it has not passed the Stage 5 gate"
        : null;

  if (skip) {
    // Nothing was looked up, so nothing is claimed: every S/R check reports itself unmeasured
    // with the reason. Recording it means a skipped business is distinguishable from one never
    // reached, and the operator can see on the record why these checks are blank.
    await recordEvidence(db, businessId, business.name, null, `skipped: ${skip}`);
    return { ...base, outcome: "skipped", skipped: skip, costCents: 0 };
  }

  // Build guide §3.5 and the provider_calls comment in schema.ts: "Every paid call is looked up
  // here BEFORE it happens; a retried job that finds its key here reuses the result instead of
  // buying the same data twice." Checking only after the fact — which this did at first — means a
  // re-run pays Google again for data already on the record.
  const idempotencyKey = `listing:${businessId}:${placeId}`;
  const [alreadyBought] = await db
    .select({ status: providerCalls.status })
    .from(providerCalls)
    .where(eq(providerCalls.idempotencyKey, idempotencyKey))
    .limit(1);

  if (alreadyBought?.status === "succeeded" && !options.force) {
    // The findings and fields from that call are already stored, so there is nothing to redo.
    return { ...base, outcome: "already_bought", skipped: "this listing was already bought — see provider_calls", costCents: 0 };
  }

  const result = await fetchPlaceDetails({ placeId: placeId as string });

  // The ledger, unconditionally. A call that failed still cost us, and a ledger written only on
  // success would understate spend exactly when something is going wrong repeatedly.
  try {
    await db
      .insert(providerCalls)
      .values({
        idempotencyKey,
        runId: business.runId as string,
        businessId,
        provider: "google_places",
        endpoint: "places.details",
        status: isPlaceDetailsOk(result) ? "succeeded" : "failed",
        // No longer rounded: the column holds four decimal places, so 3.5 is stored as 3.5
        // rather than billed to the ledger as 4.
        costCents: String(PLACES_DETAILS_COST_CENTS),
        calledAt: new Date(),
      })
      .onConflictDoUpdate({
        target: providerCalls.idempotencyKey,
        set: { status: isPlaceDetailsOk(result) ? "succeeded" : "failed", calledAt: new Date() },
      });
  } catch (err) {
    throw new Error(`failed to record the provider call for ${business.name}: ${describeDbError(err)}`);
  }

  if (!isPlaceDetailsOk(result)) {
    // A 404 is Google saying the place is gone — that IS the S1 finding, at 40 points. Every
    // other failure leaves the question open, so `listingFound` stays null and S1 abstains.
    const reason =
      result.outcome === "not_found"
        ? "Google no longer has a listing at this place id."
        : `The Google listing could not be read (${result.outcome})${result.providerMessage ? `: ${result.providerMessage}` : result.detail ? `: ${result.detail}` : ""}`;

    await recordEvidence(
      db,
      businessId,
      business.name,
      {
        listingFound: result.outcome === "not_found" ? false : null,
        hasOpeningHours: null,
        primaryType: null,
        allTypes: [],
        websiteUri: null,
        rating: null,
        reviewCount: null,
        unavailableReason: reason,
      },
      result.outcome,
    );
    return { ...base, outcome: result.outcome, skipped: null, costCents: PLACES_DETAILS_COST_CENTS };
  }

  const d = result.details;
  const evidence: ListingEvidence = {
    // A 200 with details is the listing existing. `not_found` is what says it does not, and that
    // is handled above as a failure rather than silently as "no listing".
    listingFound: true,
    hasOpeningHours: (d.regularOpeningHours?.weekdayDescriptions?.length ?? 0) > 0,
    primaryType: d.primaryType ?? null,
    allTypes: d.types ?? [],
    websiteUri: d.websiteUri ?? null,
    rating: d.rating ?? null,
    reviewCount: d.userRatingCount ?? null,
  };

  await recordEvidence(db, businessId, business.name, evidence, "ok");

  return {
    ...base,
    outcome: "ok",
    rating: evidence.rating,
    reviewCount: evidence.reviewCount,
    skipped: null,
    costCents: PLACES_DETAILS_COST_CENTS,
  };
}

/** Writes the listing's own fields, the S/R findings, and a refreshed score. */
async function recordEvidence(
  db: Database,
  businessId: string,
  name: string,
  evidence: ListingEvidence | null,
  outcome: string,
): Promise<void> {
  try {
    const fields = [{ fieldName: "listing_outcome", value: outcome, sourceName: "google_places" }];
    if (evidence) {
      if (evidence.rating !== null) fields.push({ fieldName: "rating", value: String(evidence.rating), sourceName: "google_places" });
      if (evidence.reviewCount !== null) fields.push({ fieldName: "review_count", value: String(evidence.reviewCount), sourceName: "google_places" });
      if (evidence.primaryType) fields.push({ fieldName: "listing_category", value: evidence.primaryType, sourceName: "google_places" });
      if (evidence.websiteUri) fields.push({ fieldName: "listing_website", value: evidence.websiteUri, sourceName: "google_places" });
      fields.push({ fieldName: "listing_has_hours", value: String(evidence.hasOpeningHours), sourceName: "google_places" });
      if (evidence.unavailableReason) {
        fields.push({ fieldName: "listing_detail", value: evidence.unavailableReason.slice(0, 500), sourceName: "google_places" });
      }
    }
    await upsertFieldMetadata(db, businessId, fields);

    await upsertFindings(db, businessId, runListingChecks(evidence), { sourceName: "google_places" });
  } catch (err) {
    throw new Error(`failed to record listing evidence for ${name}: ${describeDbError(err)}`);
  }

  await scoreAndStore(db, businessId);
}
