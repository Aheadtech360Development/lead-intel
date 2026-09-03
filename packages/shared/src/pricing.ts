/**
 * Verified Google Places pricing (fetched from Google's current pricing pages when Phase 3 was
 * built — see the Phase 3 plan for the source — not assumed from memory). Both are fractions of
 * a cent per request. Shared between apps/jobs (the cost ledger — provider_calls' cost_cents
 * integer column rounds these) and apps/web (the search screen's pre-run estimate, spec §9
 * Stage 0) so the two never quietly drift apart.
 *
 * The SKU tier is decided by the FIELD MASK, not the endpoint — both constants below are the
 * same Text Search call, priced differently because they ask for different fields. Widening
 * either field mask can silently move it to a dearer tier.
 */

/** Business discovery: mask includes phone/website/rating/reviewCount → Enterprise, $35/1,000. */
export const PLACES_TEXT_SEARCH_COST_CENTS = 3.5;

/** Centre resolution (resolve-center.ts): mask is location/addressComponents/types only → Pro,
 *  $32/1,000. One call per run. Replaces the Geocoding API, which needs billing enabled. */
export const PLACES_CENTER_LOOKUP_COST_CENTS = 3.2;

/**
 * Place Details for the §5.3/§5.4 listing checks: the mask includes rating, userRatingCount and
 * regularOpeningHours, which are Enterprise fields → $35/1,000.
 *
 * This is the call §9's Stage 5 gate exists to ration — "every business gets the free website
 * analysis; only the ones that already look like they have a problem get the paid lookups."
 */
export const PLACES_DETAILS_COST_CENTS = 3.5;
