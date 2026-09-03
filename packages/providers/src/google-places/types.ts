import type { DiscoveredBusinessInput } from "@lead-intel/shared";
import { z } from "zod";

/**
 * Raw shape returned by Places API (New) — Text Search, for the field mask this adapter
 * requests (see search-text.ts). `addressComponents` is Pro-tier (same tier as
 * formattedAddress/location, already required) — included so city/state come from Google's own
 * structured data instead of being regex-parsed out of a free-text address, which the spec's
 * "never guessed" principle would otherwise be violated by.
 */
const AddressComponent = z.object({
  longText: z.string().optional(),
  shortText: z.string().optional(),
  types: z.array(z.string()).default([]),
});

export const RawPlace = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string(), languageCode: z.string().optional() }).optional(),
  formattedAddress: z.string().optional(),
  addressComponents: z.array(AddressComponent).optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  nationalPhoneNumber: z.string().optional(),
  websiteUri: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  businessStatus: z.enum(["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"]).optional(),
  primaryType: z.string().optional(),
});
export type RawPlace = z.infer<typeof RawPlace>;

export const SearchTextResponse = z.object({
  places: z.array(RawPlace).default([]),
  nextPageToken: z.string().optional(),
});
export type SearchTextResponse = z.infer<typeof SearchTextResponse>;

/** The Places-specific signal this adapter contributes on top of the shared identity fields —
 *  kept separate from DiscoveredBusinessInput because it's provider-specific, not part of the
 *  cross-source contract packages/core works with. */
export interface DiscoveredPlaceResult {
  business: DiscoveredBusinessInput;
  rating: number | null;
  userRatingCount: number | null;
  businessStatus: "operational" | "closed_temporarily" | "closed_permanently" | null;
  /** The one raw presence signal Phase 3 is scoped to record — see the plan's scope note.
   *  Never promoted to a website_status classification here; that needs the other two checks
   *  spec §4 requires, which is Phase 4 work. */
  hasWebsiteField: boolean;
}

function addressComponent(
  place: RawPlace,
  type: string,
  variant: "longText" | "shortText",
): string | null {
  const match = place.addressComponents?.find((c) => c.types.includes(type));
  return match?.[variant] ?? null;
}

/**
 * Maps one raw Places result to the shape packages/core needs to build identity keys, plus the
 * Places-specific signal fields resolve.ts writes as field_metadata. Returns null only when the
 * result has no name at all — without a name there is nothing to identify the business by, and
 * fabricating a placeholder would be exactly the kind of guess this project avoids.
 */
export function mapRawPlace(place: RawPlace): DiscoveredPlaceResult | null {
  const name = place.displayName?.text?.trim();
  if (!name) return null;

  const business: DiscoveredBusinessInput = {
    name,
    domain: place.websiteUri ?? null,
    phone: place.nationalPhoneNumber ?? null,
    placeId: place.id,
    fbPageId: null,
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    city: addressComponent(place, "locality", "longText"),
    state: addressComponent(place, "administrative_area_level_1", "shortText"),
    country: addressComponent(place, "country", "shortText"),
  };

  return {
    business,
    rating: place.rating ?? null,
    userRatingCount: place.userRatingCount ?? null,
    businessStatus: place.businessStatus ? (place.businessStatus.toLowerCase() as DiscoveredPlaceResult["businessStatus"]) : null,
    hasWebsiteField: Boolean(place.websiteUri && place.websiteUri.trim().length > 0),
  };
}

// The Geocoding API response schema used to live here. It was removed when the project moved
// centre-resolution onto Places Text Search (see resolve-center.ts) — the Geocoding API requires
// billing to be enabled on the Google Cloud project, and this one deliberately runs without it.
