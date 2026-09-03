import { fired, notMeasured, passed } from "./result.js";
import type { CheckResult } from "./types.js";

/**
 * What a Google listing told us, reduced to what §5.3 and §5.4's checks read. Mirrors the
 * provider's own result without importing it — packages/core stays independent of any one source.
 */
export interface ListingEvidence {
  /**
   * `true` — Google returned a listing. `false` — Google definitively has none (HTTP 404), which
   * is S1 firing at 40 points. `null` — the lookup failed for some other reason, so whether a
   * listing exists is simply unknown.
   *
   * The third state is the one worth having: without it, a rate-limited lookup and a business
   * that genuinely has no Google presence would produce the same finding, and S1 is the heaviest
   * check in the SEO area.
   */
  listingFound: boolean | null;
  hasOpeningHours: boolean | null;
  /** The listing's primary category, if it declares one. */
  primaryType: string | null;
  allTypes: string[];
  /** The website the listing points at, if any. */
  websiteUri: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** Why nothing could be read, when nothing could. Shown to the operator verbatim. */
  unavailableReason?: string | null;
}

/**
 * Categories Google assigns when it has nothing better — §5.3's S5 fires on "missing **or
 * generic**", and a listing typed only `point_of_interest` is telling a searcher nothing about
 * what the business actually does.
 */
const GENERIC_TYPES = new Set([
  "point_of_interest",
  "establishment",
  "place_of_interest",
  "premise",
  "subpremise",
  "geocode",
  "food",
  "store",
  "general_contractor",
]);

/**
 * §5.3's S1-S6 and §5.4's R1-R5, from a Google listing.
 *
 * **Four of these eleven are not answerable and say so.** That is not an omission to be fixed
 * later by trying harder — it is what the API returns:
 *
 * - **S2 (listing unclaimed)** — Places API has no claimed/unclaimed field at all. Google Maps
 *   shows "Claim this business" in its own UI and exposes nothing equivalent to a caller.
 * - **S4 (few or no photos)** — `photos` returns HTTP 200 with an empty body on this project's
 *   key. Verified against three of our own businesses and then a Starbucks with 2,243 ratings.
 * - **R3 (reviews dried up)** and **R4 (owner never replies)** — both need the `reviews` array,
 *   which behaves the same way, and R4 additionally needs an owner-response field Places does not
 *   return even when reviews do arrive.
 * - **R5 (slow review growth)** — needs review dates over time, so it falls with R3.
 *
 * Reporting them unmeasured keeps them out of both sides of §6.1's sum, which is exactly right:
 * the areas are scored on what was actually established, and the day a source for these exists
 * the coverage number moves visibly rather than silently.
 */
export function runListingChecks(evidence: ListingEvidence | null): CheckResult[] {
  const unanswerable: CheckResult[] = [
    notMeasured("S2", "Google's API does not report whether a listing is claimed — it is visible only in the Maps interface."),
    notMeasured("S4", "Google returns no photo data for this project's key, so the listing's photo count is unknown."),
    notMeasured("R3", "Google returns no individual reviews for this project's key, so review recency is unknown."),
    notMeasured("R4", "Google returns no individual reviews, and no owner-response field, so replies cannot be checked."),
    notMeasured("R5", "Google returns no review dates, so the rate of new reviews cannot be worked out."),
  ];

  if (!evidence) {
    const reason = "The Google listing has not been looked up for this business yet.";
    return [
      notMeasured("S1", reason),
      notMeasured("S3", reason),
      notMeasured("S5", reason),
      notMeasured("S6", reason),
      notMeasured("R1", reason),
      notMeasured("R2", reason),
      ...unanswerable,
    ];
  }

  const reason = evidence.unavailableReason ?? "The Google listing could not be read.";

  if (evidence.listingFound === null) {
    return [
      notMeasured("S1", reason),
      notMeasured("S3", reason),
      notMeasured("S5", reason),
      notMeasured("S6", reason),
      notMeasured("R1", reason),
      notMeasured("R2", reason),
      ...unanswerable,
    ];
  }

  if (!evidence.listingFound) {
    // A genuine finding, and the heaviest in the SEO area: for a local business, no Google
    // listing means not existing to the people searching for them.
    return [
      fired("S1", "This business has no Google Business Profile — for a local business that is the single biggest reason customers never find them."),
      notMeasured("S3", "There is no listing to carry opening hours."),
      notMeasured("S5", "There is no listing to carry a category."),
      notMeasured("S6", "There is no listing to carry a website link."),
      notMeasured("R1", "There is no listing, so there are no Google reviews to count."),
      notMeasured("R2", "There is no listing, so there is no Google rating."),
      ...unanswerable,
    ];
  }

  return [
    passed("S1", "The business has a Google Business Profile."),

    evidence.hasOpeningHours === null
      ? notMeasured("S3", reason)
      : evidence.hasOpeningHours
        ? passed("S3", "The Google listing shows opening hours.")
        : fired("S3", "The Google listing shows no opening hours, so searchers cannot tell when the business is open."),

    categoryCheck(evidence),

    evidence.websiteUri === null
      ? fired("S6", "The Google listing has no website link, so everyone who finds the listing stops there.")
      : passed("S6", `The Google listing links to ${evidence.websiteUri}.`, { websiteUri: evidence.websiteUri }),

    reviewCountCheck(evidence),
    ratingCheck(evidence),

    ...unanswerable,
  ];
}

/** S5: "Missing or generic". A listing typed only `point_of_interest` tells a searcher nothing. */
function categoryCheck(evidence: ListingEvidence): CheckResult {
  const primary = evidence.primaryType;
  if (primary === null && evidence.allTypes.length === 0) {
    return fired("S5", "The Google listing has no category set, so it will not appear in searches for what this business does.");
  }
  const meaningful = [primary, ...evidence.allTypes].filter(
    (type): type is string => typeof type === "string" && type.length > 0 && !GENERIC_TYPES.has(type),
  );
  if (meaningful.length === 0) {
    return fired("S5", `The Google listing's only category is generic (${primary ?? evidence.allTypes.join(", ")}), which tells a searcher nothing about what they do.`, {
      detail: { primaryType: primary, types: evidence.allTypes },
    });
  }
  return passed("S5", `The Google listing is categorised as ${primary ?? meaningful[0]}.`, {
    primaryType: primary,
    types: evidence.allTypes,
  });
}

/** §5.4 R1: "Under 10 -> 35; 10-24 -> 20; 25-49 -> 8". */
function reviewCountCheck(evidence: ListingEvidence): CheckResult {
  const count = evidence.reviewCount;
  if (count === null) return notMeasured("R1", evidence.unavailableReason ?? "Google returned no review count.");

  if (count < 10) {
    return fired("R1", `Only ${count} Google review${count === 1 ? "" : "s"} — far too few to reassure anyone choosing between local options.`, {
      points: 35,
      detail: { reviewCount: count },
    });
  }
  if (count < 25) {
    return fired("R1", `${count} Google reviews — thin for a local business, and below what competitors typically show.`, {
      points: 20,
      detail: { reviewCount: count },
    });
  }
  if (count < 50) {
    return fired("R1", `${count} Google reviews — respectable, but short of the 50 that reads as established.`, {
      points: 8,
      detail: { reviewCount: count },
    });
  }
  return passed("R1", `${count} Google reviews.`, { reviewCount: count });
}

/** §5.4 R2: "Below 4.0 -> 30; 4.0-4.3 -> 12". */
function ratingCheck(evidence: ListingEvidence): CheckResult {
  const rating = evidence.rating;
  if (rating === null) {
    // No rating and no reviews is the same fact twice; R1 has already scored it.
    return notMeasured("R2", evidence.reviewCount === 0 ? "There are no reviews yet, so there is no rating to judge." : evidence.unavailableReason ?? "Google returned no rating.");
  }

  if (rating < 4.0) {
    return fired("R2", `A ${rating.toFixed(1)} star rating — below the 4.0 most people treat as the cut-off when choosing.`, {
      points: 30,
      detail: { rating },
    });
  }
  if (rating <= 4.3) {
    return fired("R2", `A ${rating.toFixed(1)} star rating — acceptable, but visibly behind competitors at 4.5 and above.`, {
      points: 12,
      detail: { rating },
    });
  }
  return passed("R2", `A ${rating.toFixed(1)} star rating.`, { rating });
}
