import type { ErrorCode } from "@lead-intel/shared";
import { getGooglePlacesApiKey } from "../config.js";
import { mapPlacesHttpError } from "../errors.js";
import { mapRawPlace, SearchTextResponse, type DiscoveredPlaceResult } from "./types.js";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

// Text Search Enterprise SKU ($35/1,000 requests, 1,000 free/month — verified against Google's
// current pricing pages when this adapter was built; see the Phase 3 plan for the source).
// Triggered by nationalPhoneNumber/websiteUri/rating/userRatingCount/businessStatus below.
// Never widen this field mask casually — every field added can move the SKU tier or the price.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.primaryType",
  "nextPageToken",
].join(",");

export interface SearchNicheAtPointParams {
  niche: string;
  center: { lat: number; lng: number };
  /** Grid cell radius in meters — a bias, not a hard filter (see types.ts doc comment on why
   *  that's fine for this use). */
  radiusMeters: number;
  pageToken?: string;
  /** Testability seam — defaults to reading GOOGLE_PLACES_API_KEY from the environment. */
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface SearchNicheAtPointResult {
  attempted: true;
  succeeded: boolean;
  /** Distinct from places.length only in that this survives even a schema-validation failure
   *  (0 in that case) — kept explicit per build guide's "never conflate attempted/succeeded/
   *  returned_count" rule, so a broken adapter is never indistinguishable from a genuine
   *  zero-result search. */
  returnedCount: number;
  places: DiscoveredPlaceResult[];
  nextPageToken: string | null;
  errorCode: ErrorCode | null;
  /** Google's own explanation of a failure, verbatim — see GeocodeLocationResult.providerMessage
   *  for why an ErrorCode alone is not enough to diagnose one. */
  providerMessage: string | null;
}

/**
 * One page (up to 20 results) of Places Text Search, biased to a grid cell center. The caller
 * (apps/jobs/src/discovery.ts) is responsible for pagination (following nextPageToken up to the
 * platform's 60-result cap) and for deciding whether a saturated cell needs subdividing —
 * this function only ever makes one HTTP call.
 */
export async function searchNicheAtPoint(
  params: SearchNicheAtPointParams,
): Promise<SearchNicheAtPointResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const apiKey = params.apiKey ?? getGooglePlacesApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 15000);

  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: params.niche,
        pageSize: 20,
        ...(params.pageToken ? { pageToken: params.pageToken } : {}),
        locationBias: {
          circle: {
            center: { latitude: params.center.lat, longitude: params.center.lng },
            radius: params.radiusMeters,
          },
        },
      }),
      signal: controller.signal,
    });

    const json: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        attempted: true,
        succeeded: false,
        returnedCount: 0,
        places: [],
        nextPageToken: null,
        errorCode: mapPlacesHttpError(response.status, json),
        // Places (New) nests its explanation under `error.message`, unlike Geocoding's top-level
        // `error_message` — same idea, different envelope.
        providerMessage:
          (json as { error?: { message?: string } } | null)?.error?.message ?? null,
      };
    }

    const parsed = SearchTextResponse.safeParse(json);
    if (!parsed.success) {
      return {
        attempted: true,
        succeeded: false,
        returnedCount: 0,
        places: [],
        nextPageToken: null,
        errorCode: "PROVIDER_SCHEMA_INVALID",
        providerMessage: parsed.error.issues[0]?.message ?? null,
      };
    }

    const places = parsed.data.places
      .map(mapRawPlace)
      .filter((p): p is DiscoveredPlaceResult => p !== null);

    return {
      attempted: true,
      succeeded: true,
      returnedCount: places.length,
      places,
      nextPageToken: parsed.data.nextPageToken ?? null,
      errorCode: null,
      providerMessage: null,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      attempted: true,
      succeeded: false,
      returnedCount: 0,
      places: [],
      providerMessage: err instanceof Error ? err.message : null,
      nextPageToken: null,
      errorCode: isAbort ? "PROVIDER_TIMEOUT" : "INTERNAL",
    };
  } finally {
    clearTimeout(timeout);
  }
}
