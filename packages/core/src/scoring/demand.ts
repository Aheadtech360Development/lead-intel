/**
 * Proven demand at a business whose Google listing shows no website.
 *
 * This closes a gap the operator found by asking a simple question: *if a business has no website
 * but strong social or good numbers, shouldn't it be Priority 1?* Measuring the answer showed 75 of
 * 76 such businesses were **not scored at all** — no tier, gate not passed, absent from the call
 * list. Among them: 4.9 stars from 336 reviews, 4.9 from 237, 4.7 from 224. For an agency that sells
 * websites, those are the easiest calls in the book, and none of them had ever appeared.
 *
 * **Why they fall out.** Scoring needs at least one area to clear its coverage floor. With no site
 * to read, the website checks never run; without a Google listing purchase, the local-search and
 * reputation checks have nothing either. Nothing clears the floor, so `scoreBusiness` returns null
 * and the business disappears. The existing "no website" override that would have rescued them sits
 * *after* that early return and is never reached.
 *
 * **Why the status is `unclear` rather than `no_website`, and why that is right.** Google saying it
 * has no website URI is not proof that none exists — they might have a Facebook page, or a site
 * Google has never indexed. An earlier pass recorded that honestly and refused to claim otherwise.
 * This module does not overturn that judgement. It makes a different one:
 *
 *   **Either reading is worth a call.** If they truly have no website, that is the whole pitch. If
 *   they have one Google does not know about, their listing is incomplete — which is also a real
 *   problem, also worth selling, and also worth the phone call. The uncertainty does not need
 *   resolving before dialling, so it is carried into the reason rather than guessed away.
 *
 * Pure: numbers in, verdict out. No database, no network.
 */

/** What counts as proven demand. Settings rather than constants — see `DEFAULT_DEMAND_THRESHOLDS`. */
export interface DemandThresholds {
  minReviews: number;
  minRating: number;
  minFollowers: number;
}

/**
 * Starting values, chosen with the operator for a printing and beauty list.
 *
 * They are the wrong numbers for some trades — fifty reviews is a lot for a dentist and very few
 * for a restaurant — which is exactly why they are passed in rather than hard-coded here.
 */
export const DEFAULT_DEMAND_THRESHOLDS: DemandThresholds = {
  minReviews: 50,
  minRating: 4.0,
  minFollowers: 10_000,
};

export interface DemandSignals {
  reviewCount: number | null;
  rating: number | null;
  instagramFollowers: number | null;
}

export interface ProvenDemand {
  /** Which signal carried it, for the reason shown on the record. */
  basis: "reviews" | "followers";
  evidence: string;
}

/**
 * Whether a business with no listed website has demonstrated demand anyway.
 *
 * Returns null — not false — when it has not. The distinction matters to the caller: a business
 * that fails this test is left exactly as it was, not marked as anything.
 */
export function provenDemand(signals: DemandSignals, thresholds: DemandThresholds): ProvenDemand | null {
  // Followers first: an audience of that size is the stronger claim, and it is the one the operator
  // asked for by name. It stands alone — a business with 25,000 followers and no reviews at all has
  // still proven people want what it sells.
  const followers = signals.instagramFollowers;
  if (followers !== null && followers >= thresholds.minFollowers) {
    return {
      basis: "followers",
      evidence: `${followers.toLocaleString("en-GB")} Instagram followers`,
    };
  }

  // Reviews need both halves. Volume without a rating floor promotes the busy but disliked; a
  // rating without a volume floor promotes a business with three happy friends. Either alone would
  // put businesses on the call list that have not earned it.
  const reviews = signals.reviewCount;
  const rating = signals.rating;
  if (
    reviews !== null &&
    rating !== null &&
    reviews >= thresholds.minReviews &&
    rating >= thresholds.minRating
  ) {
    return {
      basis: "reviews",
      evidence: `${rating} stars from ${reviews.toLocaleString("en-GB")} reviews`,
    };
  }

  return null;
}

/**
 * The sentence shown on the record, which states the uncertainty rather than hiding it.
 *
 * An operator reading "No website — sell them one" and then finding a website mid-call has been
 * misled by their own tool. Naming both readings costs one clause and makes the call safe either
 * way: whichever is true, there is something real to talk about.
 */
export function demandRouteReason(demand: ProvenDemand): string {
  return (
    `Google has no website for them, and they have ${demand.evidence}. ` +
    `Either there is genuinely no site — which is the whole pitch — or their Google listing is ` +
    `missing it, which is worth the call on its own.`
  );
}
