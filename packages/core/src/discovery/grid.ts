/**
 * Grid-search math for Places discovery (spec §3.2). Pure and deterministic — no network calls,
 * same bar as normalize/. The orchestration that actually calls Places, checks for saturation,
 * and decides to subdivide lives in apps/jobs/src/discovery.ts; this module only computes where
 * to look.
 */

const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_MILE = 1609.344;
const SQRT2 = Math.sqrt(2);

/** Places API (New) Circle.radius hard limit — verified against Google's current API reference.
 *  A cell radius must never exceed this or every search in that cell fails outright. */
export const MAX_CELL_RADIUS_METERS = 50_000;

/** Starting cell size for a fresh grid. Chosen to keep the initial request count reasonable for
 *  a first search without over-subdividing sparse areas; pre-build-risks-and-api-limits.md §4
 *  is explicit that the real density has to be measured, not guessed — tune this after the first
 *  real small test run, not before. */
export const DEFAULT_INITIAL_CELL_RADIUS_METERS = 24_000; // ~15 miles

/** Cap on how many times a saturated cell may split into 4 children — spec §14 item 2 and
 *  pre-build-risks-and-api-limits.md §2.1 both name 3 as the mitigation for the first build. */
export const MAX_SUBDIVISION_DEPTH = 3;

export interface Point {
  lat: number;
  lng: number;
}

export interface GridCell {
  /** Deterministic from depth + rounded center — stable across re-runs of the same math, not a
   *  random id, so a resumed run can recognise "this is the same cell" without a database round
   *  trip. */
  id: string;
  parentId: string | null;
  depth: number;
  center: Point;
  radiusMeters: number;
}

export function milesToMeters(miles: number): number {
  return miles * METERS_PER_MILE;
}

/** Great-circle distance between two points, in meters. */
export function haversineDistanceMeters(a: Point, b: Point): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Destination point `distanceMeters` from `origin` along `bearingDegrees` (0 = north, 90 =
 *  east), using the standard spherical-earth direct geodesic formula. */
export function destinationPoint(origin: Point, distanceMeters: number, bearingDegrees: number): Point {
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  const bearing = toRadians(bearingDegrees);
  const lat1 = toRadians(origin.lat);
  const lng1 = toRadians(origin.lng);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return { lat: toDegrees(lat2), lng: normalizeLng(toDegrees(lng2)) };
}

/** Offsets `origin` by a north/east displacement in meters — the building block grid generation
 *  and subdivision both use, expressed as a single bearing + distance for destinationPoint(). */
function offsetNorthEast(origin: Point, dNorthMeters: number, dEastMeters: number): Point {
  const distance = Math.sqrt(dNorthMeters * dNorthMeters + dEastMeters * dEastMeters);
  if (distance === 0) return origin;
  const bearing = toDegrees(Math.atan2(dEastMeters, dNorthMeters));
  return destinationPoint(origin, distance, bearing);
}

function cellId(depth: number, center: Point): string {
  return `${depth}:${center.lat.toFixed(6)}:${center.lng.toFixed(6)}`;
}

/**
 * Builds the initial set of grid cells covering a circle of `radiusMiles` around `center`.
 *
 * Cells are placed on a square grid with spacing = cellRadius * sqrt(2) — the spacing at which
 * adjacent circles fully tile the plane with no gaps at the corners between them (a circle of
 * radius r centered on a square of side r*sqrt(2) reaches every corner of its square). A cell is
 * kept if its circle intersects the target circle at all (center-to-center distance <= target
 * radius + cell radius) — cells whose circle would fall entirely outside the requested area are
 * dropped, since searching there buys nothing.
 */
/**
 * The actual tiling work, shared by buildInitialGrid and subdivideCell so both get the exact
 * same proven coverage guarantee instead of two hand-derived geometries that could each be
 * subtly wrong in different ways. If cellRadius already reaches all the way to targetRadius, one
 * cell suffices — the general grid loop below assumes cellRadius < targetRadius and would
 * otherwise emit a ring of redundant neighbours around that single sufficient cell.
 */
function tileCircle(params: {
  center: Point;
  targetRadiusMeters: number;
  cellRadiusMeters: number;
  depth: number;
  parentId: string | null;
}): GridCell[] {
  const { center, targetRadiusMeters, cellRadiusMeters, depth, parentId } = params;

  if (cellRadiusMeters >= targetRadiusMeters) {
    return [{ id: cellId(depth, center), parentId, depth, center, radiusMeters: cellRadiusMeters }];
  }

  const spacing = cellRadiusMeters * SQRT2;
  const span = targetRadiusMeters + cellRadiusMeters;
  const steps = Math.ceil(span / spacing);

  const cells: GridCell[] = [];
  for (let row = -steps; row <= steps; row++) {
    for (let col = -steps; col <= steps; col++) {
      const candidateCenter = offsetNorthEast(center, row * spacing, col * spacing);
      const distanceFromTarget = haversineDistanceMeters(center, candidateCenter);
      if (distanceFromTarget <= targetRadiusMeters + cellRadiusMeters) {
        cells.push({
          id: cellId(depth, candidateCenter),
          parentId,
          depth,
          center: candidateCenter,
          radiusMeters: cellRadiusMeters,
        });
      }
    }
  }
  return cells;
}

export function buildInitialGrid(params: {
  center: Point;
  radiusMiles: number;
  initialCellRadiusMeters?: number;
}): GridCell[] {
  const targetRadiusMeters = milesToMeters(params.radiusMiles);
  const cellRadiusMeters = Math.min(
    params.initialCellRadiusMeters ?? DEFAULT_INITIAL_CELL_RADIUS_METERS,
    MAX_CELL_RADIUS_METERS,
    // A small requested radius doesn't need a full grid — one cell sized to just cover it.
    Math.max(targetRadiusMeters, 1),
  );
  return tileCircle({ center: params.center, targetRadiusMeters, cellRadiusMeters, depth: 0, parentId: null });
}

/**
 * Radius ratio (child cell / parent cell) for splitting a saturated cell. Spec §3.2's pseudocode
 * says "split the cell into 4 smaller cells" — that turns out not to be geometrically achievable
 * as a literal half-radius, 4-fixed-diagonal-children split: a circle of radius R cannot be
 * covered by 4 circles of radius R/2 (there's a real gap at the cardinal edges — this module's
 * coverage test caught it during development). sqrt(pi/8) was chosen as an area-based estimate
 * aiming for ~4 children; empirically, reusing tileCircle's discrete step grid at this ratio
 * consistently produces **9** children (verified — stable across ratios from ~0.55 to ~0.99
 * because `steps = ceil(span/spacing)` plateaus across that range, not a tuning mistake).
 *
 * **Cost consequence, not just a cosmetic difference from the spec's "4":** worst case, one
 * saturated top-level cell subdividing 3 levels deep (MAX_SUBDIVISION_DEPTH) issues up to
 * 9^3 = 729 sub-searches, not 4^3 = 64. The run's maxSpendCents ceiling (spec §10.3) is what
 * actually bounds this in practice — the depth cap alone is not enough headroom protection to
 * rely on for a dense area. Flag prominently in the search UI's cost estimate, not just here.
 */
export const SUBDIVISION_RADIUS_RATIO = Math.sqrt(Math.PI / 8);

/**
 * Splits a saturated cell (spec §3.2 — a search that returned the 60-result cap is "blind to the
 * overflow") into smaller cells covering the same area, reusing tileCircle's proven coverage
 * guarantee rather than a fixed 4-child geometry (see SUBDIVISION_RADIUS_RATIO's comment for
 * why that would silently under-cover). Returns an empty array once MAX_SUBDIVISION_DEPTH is
 * reached — the caller must record that the cell hit the cap rather than silently under-counting
 * (pre-build-risks-and-api-limits.md §2.1).
 */
export function subdivideCell(cell: GridCell): GridCell[] {
  if (cell.depth >= MAX_SUBDIVISION_DEPTH) return [];

  const childRadius = cell.radiusMeters * SUBDIVISION_RADIUS_RATIO;
  return tileCircle({
    center: cell.center,
    targetRadiusMeters: cell.radiusMeters,
    cellRadiusMeters: childRadius,
    depth: cell.depth + 1,
    parentId: cell.id,
  });
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

function normalizeLng(lng: number): number {
  let n = lng;
  while (n > 180) n -= 360;
  while (n < -180) n += 360;
  return n;
}
