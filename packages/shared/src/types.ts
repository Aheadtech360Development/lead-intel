import type { IdentityKeyType } from "./enums.js";

/** A single normalised identity key, ready to compare against the database's unique constraint. */
export interface IdentityKey {
  keyType: IdentityKeyType;
  keyValue: string;
  rank: 1 | 2 | 3 | 4 | 5;
}

/** Output of location normalisation (packages/core/normalize/location.ts). */
export interface NormalizedLocation {
  /** Rounded to ~1km so nearby coordinates hash the same way. Null when no coordinates exist —
   *  the business was placed by city/state name alone. */
  latRounded: number | null;
  lngRounded: number | null;
  city: string | null;
  state: string | null;
  country: string;
  /** Deterministic string used to build the rank-5 name_location identity key. */
  locationHash: string;
}

/** Minimal shape packages/core needs to build identity keys and normalise a discovered business.
 *  This is intentionally smaller than the full database row — core never touches the database. */
export interface DiscoveredBusinessInput {
  name: string;
  /** Raw, as returned by the source. Normalisation happens in packages/core. */
  domain?: string | null;
  phone?: string | null;
  placeId?: string | null;
  fbPageId?: string | null;
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}
