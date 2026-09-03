import { buildInitialGrid, subdivideCell, type GridCell } from "./grid.js";

/**
 * Places Text Search caps at 60 results across 3 pages of 20 — so a cell that saturates costs
 * 3 requests, not 1, before we even know it needs subdividing.
 */
const PAGES_PER_SATURATED_CELL = 3;

export interface DiscoveryRequestEstimate {
  /** How many search points the grid starts with. */
  initialCells: number;
  /** Sparse area: every cell returns 20 or fewer results, one request each. */
  minRequests: number;
  /** Every cell paginates to the full 60-result cap, but none subdivides. This is the number an
   *  operator should expect in an ordinary dense-ish city — NOT a guaranteed ceiling. */
  maxRequestsWithoutSubdivision: number;
  /**
   * The true ceiling: every cell saturates at every level, all the way down to
   * MAX_SUBDIVISION_DEPTH. Astronomically unlikely in practice — no real niche has 60+
   * businesses inside every single sub-cell — but it is the number a runaway search could
   * actually reach, so it is what the run's spend limit has to be set against. Showing only the
   * no-subdivision figure as if it were a maximum is exactly the kind of false confidence spec
   * §8 forbids.
   */
  ceilingRequests: number;
}

/**
 * Worst-case requests for one cell and all its possible descendants, computed by actually
 * walking subdivideCell() rather than assuming a fan-out number — the fan-out is a property of
 * SUBDIVISION_RADIUS_RATIO and the tiling, and hard-coding it here would silently go stale the
 * moment either changes.
 */
function ceilingRequestsForCell(cell: GridCell): number {
  const children = subdivideCell(cell);
  if (children.length === 0) return PAGES_PER_SATURATED_CELL; // at max depth: no further splitting
  return (
    PAGES_PER_SATURATED_CELL +
    children.reduce((sum, child) => sum + ceilingRequestsForCell(child), 0)
  );
}

/**
 * Estimates the Places search requests a run will make, before any of them happen (pipeline
 * Stage 0 — "estimate the number of searches and the cost, ask the operator to confirm").
 *
 * Depends on grid geometry only. Real business density — the thing that decides where in this
 * range a run actually lands — cannot be known without running the search, which
 * pre-build-risks-and-api-limits.md §4 is explicit about. That is why this returns a range with
 * a separate ceiling rather than a single number.
 */
export function estimateDiscoveryRequests(params: {
  radiusMiles: number;
  initialCellRadiusMeters?: number;
}): DiscoveryRequestEstimate {
  const cells = buildInitialGrid({
    // Cell COUNT depends on the radius, not on where on Earth the search is centred, so a fixed
    // reference point keeps this callable before the location has been geocoded.
    center: { lat: 0, lng: 0 },
    radiusMiles: params.radiusMiles,
    ...(params.initialCellRadiusMeters !== undefined
      ? { initialCellRadiusMeters: params.initialCellRadiusMeters }
      : {}),
  });

  const firstCell = cells[0];
  const ceilingPerCell = firstCell ? ceilingRequestsForCell(firstCell) : 0;

  return {
    initialCells: cells.length,
    minRequests: cells.length,
    maxRequestsWithoutSubdivision: cells.length * PAGES_PER_SATURATED_CELL,
    ceilingRequests: cells.length * ceilingPerCell,
  };
}
