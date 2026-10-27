import { runListingChecks, type ListingEvidence } from "@lead-intel/core";
import { fieldMetadata, type Database } from "@lead-intel/db";
import { and, eq, inArray } from "drizzle-orm";
import { upsertFindings } from "./findings.js";

/**
 * Scores the Google facts the product **already has** and was throwing away.
 *
 * Every business found through Maps arrives with a rating and a review count attached to the
 * search result — free, already paid for inside the search itself. 414 businesses carried both.
 * But R1 ("very few reviews", 35 points) and R2 ("weak rating", 30 points) were only ever produced
 * by `listing.ts`, which runs behind the **paid** Place Details purchase, and that had been bought
 * for 79. So 335 businesses had the two heaviest reputation checks sitting unanswered on their
 * own record, with the answers stored one table away.
 *
 * The effect was larger than two checks. REP is 135 of the points a Problem score is made of, and
 * an area with nothing measured in it drops out of §6.1's average entirely — so for most of the
 * list the Problem score was being decided by the website alone, and the operator's "score change
 * q nhi hota" had a third cause nobody had looked for.
 *
 * Free, idempotent, and reads only what is stored: no provider is called and nothing is crawled.
 * Businesses whose full listing **was** bought are skipped — that path answers strictly more, and
 * overwriting its findings with this thinner set would be a step backwards.
 */
export async function applyStoredListingFacts(
  db: Database,
  businessIds: string[],
): Promise<{ answered: number; skippedBought: number; nothingStored: number }> {
  let answered = 0;
  let skippedBought = 0;
  let nothingStored = 0;

  for (let i = 0; i < businessIds.length; i += CHUNK) {
    const chunk = businessIds.slice(i, i + CHUNK);

    const [fields, bought] = await Promise.all([
      db
        .select({ businessId: fieldMetadata.businessId, fieldName: fieldMetadata.fieldName, value: fieldMetadata.value })
        .from(fieldMetadata)
        .where(and(inArray(fieldMetadata.businessId, chunk), inArray(fieldMetadata.fieldName, WANTED))),
      // `listing_outcome` is written only by the paid Place Details lookup, so its presence is the
      // record of "the better source has already answered for this business".
      db
        .select({ businessId: fieldMetadata.businessId })
        .from(fieldMetadata)
        .where(and(inArray(fieldMetadata.businessId, chunk), eq(fieldMetadata.fieldName, "listing_outcome"))),
    ]);

    const alreadyBought = new Set(bought.map((row) => row.businessId));
    const byBusiness = new Map<string, Map<string, string | null>>();
    for (const row of fields) {
      const map = byBusiness.get(row.businessId) ?? new Map<string, string | null>();
      map.set(row.fieldName, row.value);
      byBusiness.set(row.businessId, map);
    }

    for (const id of chunk) {
      if (alreadyBought.has(id)) {
        skippedBought += 1;
        continue;
      }
      const stored = byBusiness.get(id);
      const evidence = stored ? buildEvidence(stored) : null;
      if (!evidence) {
        nothingStored += 1;
        continue;
      }

      await upsertFindings(db, id, runListingChecks(evidence), { sourceName: "google_places_search" });
      answered += 1;
    }
  }

  return { answered, skippedBought, nothingStored };
}

const CHUNK = 200;

const WANTED = ["rating", "review_count", "website_url", "has_website_field", "business_status"];

/**
 * What a Maps search result can honestly claim, and nothing more.
 *
 * Categories and opening hours are not in a search result, so both are declared unknown rather
 * than absent — S5 and S3 then report "not measured" with a reason instead of firing a problem at
 * a business nobody asked the question about.
 */
function buildEvidence(stored: Map<string, string | null>): ListingEvidence | null {
  const number = (name: string): number | null => {
    const raw = stored.get(name);
    if (raw === undefined || raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  const rating = number("rating");
  const reviewCount = number("review_count");
  const websiteUrl = stored.get("website_url") ?? null;
  const hasWebsiteField = stored.get("has_website_field");

  // Nothing from Google at all: not a listing with no reviews, just a business nobody looked up.
  // Imported rows are the usual case, and inventing S1 for them would be a claim about a listing
  // this product has never seen.
  if (rating === null && reviewCount === null && hasWebsiteField === undefined && !websiteUrl) return null;

  return {
    // They were found on Google Maps, so a listing exists. That is the one thing a search result
    // proves beyond doubt.
    listingFound: true,
    hasOpeningHours: null,
    primaryType: null,
    allTypes: [],
    categoriesKnown: false,
    websiteUri: websiteUrl && websiteUrl.length > 0 ? websiteUrl : null,
    // Google's own result said there was no website field — a real answer, and S6's whole point.
    // Anything less certain than that leaves S6 unmeasured rather than firing 30 points on a guess.
    websiteKnown: Boolean(websiteUrl) || hasWebsiteField === "false",
    rating,
    reviewCount,
    unavailableReason:
      "From the Maps search result rather than the full listing — it carries the rating, the review count and the website link, and nothing else.",
  };
}
