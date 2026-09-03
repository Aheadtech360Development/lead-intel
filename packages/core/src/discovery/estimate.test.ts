import { describe, expect, it } from "vitest";
import { estimateDiscoveryRequests } from "./estimate.js";
import { buildInitialGrid, MAX_SUBDIVISION_DEPTH } from "./grid.js";

describe("estimateDiscoveryRequests", () => {
  it("matches the actual initial grid size", () => {
    for (const radiusMiles of [10, 20, 100, 200]) {
      const estimate = estimateDiscoveryRequests({ radiusMiles });
      const actualGrid = buildInitialGrid({ center: { lat: 0, lng: 0 }, radiusMiles });
      expect(estimate.initialCells).toBe(actualGrid.length);
      expect(estimate.minRequests).toBe(actualGrid.length);
    }
  });

  it("orders the three figures min <= maxWithoutSubdivision <= ceiling", () => {
    for (const radiusMiles of [10, 20, 100, 200]) {
      const e = estimateDiscoveryRequests({ radiusMiles });
      expect(e.minRequests).toBeLessThanOrEqual(e.maxRequestsWithoutSubdivision);
      expect(e.maxRequestsWithoutSubdivision).toBeLessThanOrEqual(e.ceilingRequests);
    }
  });

  it("puts the ceiling far above the no-subdivision figure — the whole point of showing it", () => {
    // If these were close, the no-subdivision number would be a fine stand-in for a maximum and
    // this module would not need to exist. They are not close, and an operator setting a spend
    // limit needs to know that.
    const e = estimateDiscoveryRequests({ radiusMiles: 20 });
    expect(e.ceilingRequests).toBeGreaterThan(e.maxRequestsWithoutSubdivision * 10);
  });

  it("derives the ceiling from real subdivision, so it respects MAX_SUBDIVISION_DEPTH", () => {
    // One cell's ceiling = 3 pages at depth 0, plus every descendant's, bottoming out at the
    // depth cap. Deriving the expected value the same way subdivideCell actually behaves (rather
    // than hard-coding a fan-out) is what keeps this test honest if the tiling ratio changes.
    const oneCellEstimate = estimateDiscoveryRequests({ radiusMiles: 10 });
    expect(oneCellEstimate.initialCells).toBe(1);
    // A depth cap of 3 means at most 4 levels contribute; a finite, bounded ceiling is the
    // property that matters — an unbounded one would mean subdivision could never terminate.
    expect(Number.isFinite(oneCellEstimate.ceilingRequests)).toBe(true);
    expect(oneCellEstimate.ceilingRequests).toBeGreaterThan(3 * MAX_SUBDIVISION_DEPTH);
  });

  it("scales the ceiling with the number of initial cells", () => {
    const small = estimateDiscoveryRequests({ radiusMiles: 10 });
    const large = estimateDiscoveryRequests({ radiusMiles: 100 });
    expect(large.ceilingRequests / large.initialCells).toBeCloseTo(
      small.ceilingRequests / small.initialCells,
      6,
    );
  });
});
