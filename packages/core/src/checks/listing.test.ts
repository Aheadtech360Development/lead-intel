import { describe, expect, it } from "vitest";
import { runListingChecks, type ListingEvidence } from "./listing.js";
import type { CheckResult } from "./types.js";

function byId(results: CheckResult[]): Map<string, CheckResult> {
  return new Map(results.map((r) => [r.checkId, r]));
}

function listing(overrides: Partial<ListingEvidence> = {}): ListingEvidence {
  return {
    listingFound: true,
    hasOpeningHours: true,
    primaryType: "screen_printer",
    allTypes: ["screen_printer", "store", "point_of_interest"],
    websiteUri: "https://example.com/",
    rating: 4.7,
    reviewCount: 120,
    ...overrides,
  };
}

describe("runListingChecks — what it cannot answer, it says so", () => {
  /**
   * Five of the eleven checks here are unanswerable, and that is what the API returns rather than
   * something to fix by trying harder. Asserting it explicitly means the day a source exists, this
   * test fails and someone notices — rather than the gap quietly persisting.
   */
  it.each(["S2", "S4", "R3", "R4", "R5"])("never claims to have measured %s", (id) => {
    for (const evidence of [null, listing(), listing({ listingFound: false }), listing({ listingFound: null })]) {
      const result = byId(runListingChecks(evidence)).get(id);
      expect(result?.outcome, id).toBe("not_measured");
      expect(result?.maxPoints).toBe(0);
      expect(result?.evidence.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("reports everything unmeasured when the listing has not been looked up", () => {
    for (const result of runListingChecks(null)) {
      expect(result.outcome, result.checkId).toBe("not_measured");
    }
  });

  /**
   * The third state of `listingFound`, and the reason it exists. Without it a rate-limited lookup
   * and a business with genuinely no Google presence produce the same finding — and S1 is the
   * heaviest check in the SEO area at 40 points.
   */
  it("does not fire 'no Google Business Profile' when the lookup merely failed", () => {
    const results = byId(runListingChecks(listing({ listingFound: null, unavailableReason: "rate limited" })));
    expect(results.get("S1")?.outcome).toBe("not_measured");
    expect(results.get("S1")?.outcome).not.toBe("fired");
  });

  it("does fire it when Google definitively has no listing", () => {
    const results = byId(runListingChecks(listing({ listingFound: false })));
    expect(results.get("S1")?.outcome).toBe("fired");
    expect(results.get("S1")?.points).toBe(40);
  });
});

describe("runListingChecks — §5.3 the listing itself", () => {
  it("fires when the listing shows no opening hours", () => {
    expect(byId(runListingChecks(listing({ hasOpeningHours: false }))).get("S3")?.outcome).toBe("fired");
    expect(byId(runListingChecks(listing({ hasOpeningHours: true }))).get("S3")?.outcome).toBe("passed");
  });

  it("fires when the listing has no website link", () => {
    expect(byId(runListingChecks(listing({ websiteUri: null }))).get("S6")?.outcome).toBe("fired");
    expect(byId(runListingChecks(listing())).get("S6")?.outcome).toBe("passed");
  });

  /** §5.3's S5 is "missing **or generic**" — a listing typed only `point_of_interest` tells a
   *  searcher nothing about what the business does. */
  it("treats a generic-only category as no category", () => {
    const generic = byId(runListingChecks(listing({ primaryType: "point_of_interest", allTypes: ["point_of_interest", "establishment"] })));
    expect(generic.get("S5")?.outcome).toBe("fired");

    const real = byId(runListingChecks(listing({ primaryType: "hair_salon", allTypes: ["hair_salon", "point_of_interest"] })));
    expect(real.get("S5")?.outcome).toBe("passed");
  });

  it("fires when there is no category at all", () => {
    expect(byId(runListingChecks(listing({ primaryType: null, allTypes: [] }))).get("S5")?.outcome).toBe("fired");
  });
});

describe("runListingChecks — §5.4 reputation", () => {
  /** §5.4 R1: "Under 10 -> 35; 10-24 -> 20; 25-49 -> 8". */
  it.each([
    [0, "fired", 35],
    [9, "fired", 35],
    [10, "fired", 20],
    [24, "fired", 20],
    [25, "fired", 8],
    [49, "fired", 8],
    [50, "passed", 0],
    [1200, "passed", 0],
  ])("a review count of %i is %s for %i points", (count, outcome, points) => {
    const result = byId(runListingChecks(listing({ reviewCount: count as number }))).get("R1");
    expect(result?.outcome).toBe(outcome);
    expect(result?.points).toBe(points);
  });

  /** §5.4 R2: "Below 4.0 -> 30; 4.0-4.3 -> 12". */
  it.each([
    [2.1, "fired", 30],
    [3.9, "fired", 30],
    [4.0, "fired", 12],
    [4.3, "fired", 12],
    [4.4, "passed", 0],
    [5.0, "passed", 0],
  ])("a rating of %s is %s for %i points", (rating, outcome, points) => {
    const result = byId(runListingChecks(listing({ rating: rating as number }))).get("R2");
    expect(result?.outcome).toBe(outcome);
    expect(result?.points).toBe(points);
  });

  /** No reviews and no rating is one fact, and R1 has already scored it at 35 points. */
  it("does not charge a brand-new business twice for having no reviews", () => {
    const results = byId(runListingChecks(listing({ reviewCount: 0, rating: null })));
    expect(results.get("R1")?.outcome).toBe("fired");
    expect(results.get("R2")?.outcome).toBe("not_measured");
  });
});

describe("runListingChecks — structural", () => {
  it("returns each check exactly once", () => {
    const ids = runListingChecks(listing()).map((r) => r.checkId);
    expect(new Set(ids).size).toBe(ids.length);
    // The four N-family ids are the paid intent checks that live on the same listing. They are
    // always unmeasured — Google answers none of them for this key — but they are returned rather
    // than omitted, so the record can say so instead of leaving the Intent score quietly shorter.
    expect(ids.sort()).toEqual([
      "N3",
      "N4",
      "N7",
      "N8",
      "R1",
      "R2",
      "R3",
      "R4",
      "R5",
      "S1",
      "S2",
      "S3",
      "S4",
      "S5",
      "S6",
    ]);
  });

  it("keeps points and maxPoints consistent with the outcome", () => {
    for (const evidence of [null, listing(), listing({ listingFound: false }), listing({ reviewCount: 3, rating: 2.2, websiteUri: null, hasOpeningHours: false })]) {
      for (const result of runListingChecks(evidence)) {
        if (result.outcome === "fired") {
          expect(result.points).toBeGreaterThan(0);
          expect(result.points).toBeLessThanOrEqual(result.maxPoints);
        } else {
          expect(result.points).toBe(0);
          if (result.outcome !== "passed") expect(result.maxPoints).toBe(0);
        }
      }
    }
  });
});
