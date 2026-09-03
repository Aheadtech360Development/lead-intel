import { describe, expect, it } from "vitest";
import {
  buildInitialGrid,
  destinationPoint,
  haversineDistanceMeters,
  MAX_CELL_RADIUS_METERS,
  MAX_SUBDIVISION_DEPTH,
  milesToMeters,
  SUBDIVISION_RADIUS_RATIO,
  subdivideCell,
  type GridCell,
  type Point,
} from "./grid.js";

const MIAMI: Point = { lat: 25.7617, lng: -80.1918 };

function isCovered(point: Point, cells: GridCell[]): boolean {
  return cells.some((cell) => haversineDistanceMeters(point, cell.center) <= cell.radiusMeters + 1);
}

/** Deterministic sample points scattered across a circle — bearings around the compass at
 *  several fractional distances — rather than truly random, so a failure is reproducible. */
function sampleCircleMeters(center: Point, radiusMeters: number): Point[] {
  const points: Point[] = [center];
  for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.95, 0.999]) {
    for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
      points.push(destinationPoint(center, radiusMeters * fraction, bearing));
    }
  }
  return points;
}

function sampleTargetCircle(center: Point, radiusMiles: number): Point[] {
  return sampleCircleMeters(center, milesToMeters(radiusMiles));
}

describe("buildInitialGrid", () => {
  it("covers every sampled point within the requested radius (no gaps)", () => {
    const radiusMiles = 200;
    const cells = buildInitialGrid({ center: MIAMI, radiusMiles });
    const samples = sampleTargetCircle(MIAMI, radiusMiles);
    const uncovered = samples.filter((p) => !isCovered(p, cells));
    expect(uncovered).toEqual([]);
  });

  it("covers a small radius with a single cell rather than an oversized grid", () => {
    const cells = buildInitialGrid({ center: MIAMI, radiusMiles: 10 });
    expect(cells.length).toBe(1);
    expect(cells[0]?.radiusMeters).toBeLessThanOrEqual(milesToMeters(10) + 1);
  });

  it("never emits a cell radius above the Places API Circle hard limit", () => {
    const cells = buildInitialGrid({
      center: MIAMI,
      radiusMiles: 200,
      initialCellRadiusMeters: 90_000, // deliberately over the 50,000m API limit
    });
    for (const cell of cells) {
      expect(cell.radiusMeters).toBeLessThanOrEqual(MAX_CELL_RADIUS_METERS);
    }
  });

  it("produces roughly the search-point count the spec's worked example expects for 200 miles", () => {
    // Spec §10.2: "150 points" for a 200-mile radius, at the default ~15-mile cell radius.
    // Not exact (the spec's own number is a rough example) — just checking the order of
    // magnitude is sane, since a bug here (e.g. spacing off by 10x) would be a silent cost blowup.
    const cells = buildInitialGrid({ center: MIAMI, radiusMiles: 200 });
    expect(cells.length).toBeGreaterThan(50);
    expect(cells.length).toBeLessThan(400);
  });

  it("every cell has depth 0 and no parent", () => {
    const cells = buildInitialGrid({ center: MIAMI, radiusMiles: 50 });
    for (const cell of cells) {
      expect(cell.depth).toBe(0);
      expect(cell.parentId).toBeNull();
    }
  });
});

describe("subdivideCell", () => {
  const parent: GridCell = {
    id: "0:25.761700:-80.191800",
    parentId: null,
    depth: 0,
    center: MIAMI,
    radiusMeters: 24_000,
  };

  it("produces a small number of smaller children that together cover the parent circle", () => {
    const children = subdivideCell(parent);
    // Empirically 9 for this ratio (see SUBDIVISION_RADIUS_RATIO's comment for why — not the
    // spec's illustrative "4"). Asserting a range, not the exact count: coverage is the actual
    // guarantee this test cares about, not a specific fan-out number.
    expect(children.length).toBeGreaterThanOrEqual(3);
    expect(children.length).toBeLessThanOrEqual(12);
    for (const child of children) {
      expect(child.radiusMeters).toBeCloseTo(parent.radiusMeters * SUBDIVISION_RADIUS_RATIO, 6);
      expect(child.depth).toBe(1);
      expect(child.parentId).toBe(parent.id);
    }

    const samples = sampleCircleMeters(parent.center, parent.radiusMeters);
    const uncovered = samples.filter((p) => !isCovered(p, children));
    expect(uncovered).toEqual([]);
  });

  it("stops subdividing at MAX_SUBDIVISION_DEPTH, so a dense area can't split forever", () => {
    let cell = parent;
    for (let d = 0; d < MAX_SUBDIVISION_DEPTH; d++) {
      const children = subdivideCell(cell);
      expect(children.length).toBeGreaterThan(0);
      cell = children[0] as GridCell;
    }
    // cell is now at MAX_SUBDIVISION_DEPTH
    expect(subdivideCell(cell)).toEqual([]);
  });

  it("gives every child a distinct, deterministic id", () => {
    const children = subdivideCell(parent);
    const ids = new Set(children.map((c) => c.id));
    expect(ids.size).toBe(children.length);
  });
});
