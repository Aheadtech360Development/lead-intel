import type { NormalizedLocation } from "@lead-intel/shared";

/**
 * Coordinates are rounded to 2 decimal places — roughly a 1.1km grid at the equator, tighter
 * north-south than east-west at US latitudes. Good enough to group "the same block" without
 * being so coarse it merges two different strip malls a few miles apart.
 */
const ROUND_DECIMALS = 2;

function roundCoord(n: number): number {
  const factor = 10 ** ROUND_DECIMALS;
  return Math.round(n * factor) / factor;
}

export interface LocationInput {
  lat?: number | null;
  lng?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
}

/**
 * Normalises coordinates and place names into a comparable location, and produces the
 * deterministic hash used to build the rank-5 (name + location) identity key.
 *
 * Returns null only when there isn't enough information to place the business at all — no
 * coordinates AND no city. A city with no coordinates is still usable for the weakest key.
 */
export function normalizeLocation(input: LocationInput): NormalizedLocation | null {
  const hasCoords =
    typeof input.lat === "number" &&
    typeof input.lng === "number" &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng);

  const city = normalizePlaceName(input.city);
  const state = normalizePlaceName(input.state);
  const country = normalizePlaceName(input.country) ?? "us";

  if (!hasCoords && !city) return null;

  const latRounded = hasCoords ? roundCoord(input.lat as number) : null;
  const lngRounded = hasCoords ? roundCoord(input.lng as number) : null;

  const locationHash =
    latRounded !== null && lngRounded !== null
      ? `geo:${latRounded.toFixed(ROUND_DECIMALS)}:${lngRounded.toFixed(ROUND_DECIMALS)}`
      : `place:${country}:${state ?? "unknown"}:${city ?? "unknown"}`;

  return { latRounded, lngRounded, city, state, country, locationHash };
}

function normalizePlaceName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase().trim().replace(/\s+/g, " ");
  return s.length > 0 ? s : null;
}
