import type { ErrorCode } from "@lead-intel/shared";
import { z } from "zod";
import { getGooglePlacesApiKey } from "../config.js";
import { mapPlacesHttpError } from "../errors.js";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

/**
 * Pro-tier fields only (displayName / addressComponents / location / types) — the Enterprise
 * fields the business search needs (phone, website, rating) are irrelevant for resolving a
 * centre point, and asking for them would move this call to the dearer SKU for nothing.
 */
const FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.addressComponents",
  "places.location",
  "places.types",
].join(",");

/**
 * Google place types that describe an AREA rather than a single business. A run's centre must
 * resolve to one of these: "Miami, FL" is a locality, "33101" a postal_code, "Downtown Miami" a
 * neighborhood. A school, shop, or office is never a valid centre for an area search — see
 * resolveSearchCenter's doc comment for the real failure this prevents.
 */
const PLACE_LIKE_TYPES = new Set([
  "locality",
  "sublocality",
  "sublocality_level_1",
  "neighborhood",
  "postal_code",
  "administrative_area_level_1",
  "administrative_area_level_2",
  "administrative_area_level_3",
  "political",
  "country",
]);

/** Google's marker for "this is a business/POI, not an area." */
const ESTABLISHMENT_TYPE = "establishment";

const AddressComponent = z.object({
  longText: z.string().optional(),
  shortText: z.string().optional(),
  types: z.array(z.string()).default([]),
});

const CenterCandidate = z.object({
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  addressComponents: z.array(AddressComponent).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  types: z.array(z.string()).default([]),
});

const CenterResponse = z.object({
  places: z.array(CenterCandidate).default([]),
});

export interface ResolveSearchCenterParams {
  locationText: string;
  /** ISO-3166 alpha-2 code the resolved centre MUST be in. A location that resolves elsewhere is
   *  rejected outright rather than searched. Defaults to US — the market this system targets. */
  expectedCountry?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ResolveSearchCenterResult {
  attempted: true;
  succeeded: boolean;
  center: { lat: number; lng: number } | null;
  formattedAddress: string | null;
  resolvedCountry: string | null;
  errorCode: ErrorCode | null;
  providerMessage: string | null;
  /** Set when the lookup itself worked but the answer failed a guard. Distinct from errorCode:
   *  nothing went wrong with the provider, we simply refuse to act on what it returned. */
  rejectedReason: string | null;
}

/**
 * Resolves the operator's free-text location ("Miami, FL") to a centre point for the grid, using
 * Places Text Search rather than the Geocoding API — Geocoding requires billing to be enabled on
 * the Google Cloud project, Places (currently) does not, and this project deliberately runs
 * without billing for now (operator's decision, Phase 3 setup).
 *
 * That substitution has a real failure mode, found by testing rather than assumed: Places is a
 * PLACE search, not a geocoder, so an ambiguous one-word location resolves toward whatever is
 * near the CALLER. From Pakistan, "Springfield" returns "Springfield School, Karachi" — plausible
 * coordinates, wrong continent, and a whole run silently searching the wrong place. `regionCode:
 * "US"` alone does NOT fix this (verified against the live API).
 *
 * Two guards, both on structured fields rather than string matching:
 *   1. The resolved country must equal expectedCountry.
 *   2. The result must look like an AREA (locality, postal code, neighbourhood...) and must not
 *      be an establishment.
 * "Springfield" fails both. A rejected location returns succeeded:false with a rejectedReason the
 * operator can act on — never a centre we are not confident in.
 */
export async function resolveSearchCenter(
  params: ResolveSearchCenterParams,
): Promise<ResolveSearchCenterResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const apiKey = params.apiKey ?? getGooglePlacesApiKey();
  const expectedCountry = (params.expectedCountry ?? "US").toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 15000);

  const base = {
    attempted: true as const,
    succeeded: false,
    center: null,
    formattedAddress: null,
    resolvedCountry: null,
    errorCode: null,
    providerMessage: null,
    rejectedReason: null,
  };

  try {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery: params.locationText,
        pageSize: 1,
        regionCode: expectedCountry,
      }),
      signal: controller.signal,
    });

    const json: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      return {
        ...base,
        errorCode: mapPlacesHttpError(response.status, json),
        providerMessage: (json as { error?: { message?: string } } | null)?.error?.message ?? null,
      };
    }

    const parsed = CenterResponse.safeParse(json);
    if (!parsed.success) return { ...base, errorCode: "PROVIDER_SCHEMA_INVALID" };

    const candidate = parsed.data.places[0];
    if (!candidate?.location) {
      return { ...base, rejectedReason: `No place matched "${params.locationText}".` };
    }

    const country =
      candidate.addressComponents?.find((c) => c.types.includes("country"))?.shortText?.toUpperCase() ??
      null;
    const formattedAddress = candidate.formattedAddress ?? null;
    const name = candidate.displayName?.text ?? params.locationText;

    if (country !== expectedCountry) {
      return {
        ...base,
        resolvedCountry: country,
        formattedAddress,
        rejectedReason: `"${params.locationText}" resolved to ${name}${
          country ? ` in ${country}` : ""
        }, not ${expectedCountry}. Add a state or country — e.g. "Springfield, IL".`,
      };
    }

    const isEstablishment = candidate.types.includes(ESTABLISHMENT_TYPE);
    const isPlaceLike = candidate.types.some((t) => PLACE_LIKE_TYPES.has(t));
    if (isEstablishment || !isPlaceLike) {
      return {
        ...base,
        resolvedCountry: country,
        formattedAddress,
        rejectedReason: `"${params.locationText}" resolved to a specific business (${name}), not a city or area. Try a city, state, or postcode.`,
      };
    }

    return {
      attempted: true,
      succeeded: true,
      center: { lat: candidate.location.latitude, lng: candidate.location.longitude },
      formattedAddress,
      resolvedCountry: country,
      errorCode: null,
      providerMessage: null,
      rejectedReason: null,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ...base,
      errorCode: isAbort ? "PROVIDER_TIMEOUT" : "INTERNAL",
      providerMessage: err instanceof Error ? err.message : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
