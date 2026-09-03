/**
 * A single Google Cloud API key covers both Places API (New) and the Geocoding API — both are
 * enabled on the same restricted key, per the Phase 3 setup guide in SETUP.md. Reading it here
 * (rather than at each call site) means a missing key fails fast and identically everywhere.
 */
export function getGooglePlacesApiKey(): string {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_PLACES_API_KEY is not set. See SETUP.md §8 for how to create and restrict it.",
    );
  }
  return key;
}

/**
 * Apify runs the Instagram and Meta Ad Library actors. One token covers both.
 *
 * Kept apart from the Google key deliberately: this one buys data that Meta's own APIs will not
 * sell. Instagram's official `business_discovery` endpoint returns the same follower count and
 * category for free, but only to an app that has passed Meta App Review — 60+ days, business
 * verification, and frequently refused. The operator chose to start here and apply for the
 * official route in parallel; when it is granted this key stops being needed.
 */
export function getApifyToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error(
      "APIFY_TOKEN is not set. Sign up free at apify.com, then Settings → Integrations → API token, " +
        "and put it in apps/jobs/.env as APIFY_TOKEN=...",
    );
  }
  return token;
}
