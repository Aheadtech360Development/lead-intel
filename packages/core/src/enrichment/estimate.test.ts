import { DEFAULT_ENRICHMENT_SPEND_CAP_CENTS, ENRICHMENT_DEFINITIONS } from "@lead-intel/shared";
import { describe, expect, it } from "vitest";
import { estimateEnrichment, formatCents, type EnrichmentCandidate } from "./estimate.js";

function candidates(spec: Array<Partial<EnrichmentCandidate>>): EnrichmentCandidate[] {
  return spec.map((s, i) => ({
    businessId: `b${i}`,
    alreadyBought: false,
    eligible: true,
    ...s,
  }));
}

const ALL_KEYS = ["GOOGLE_PLACES_API_KEY", "LUSHA_API_KEY", "DATAFORSEO_LOGIN"];

describe("estimateEnrichment — the number on the confirm screen", () => {
  it("charges only for businesses that will actually be bought", () => {
    const estimate = estimateEnrichment({
      candidatesBySource: { places_details: candidates([{}, {}, {}]) },
      sources: ["places_details"],
      selectedBusinesses: 3,
      capCents: DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
      availableEnvVars: ALL_KEYS,
    });

    const source = estimate.perSource[0];
    expect(source?.willBuy).toBe(3);
    expect(source?.totalCents).toBe(10.5); // 3 × 3.5c
    expect(estimate.totalCents).toBe(10.5);
  });

  /**
   * The ledger check runs before every paid call, so re-selecting a business already bought costs
   * nothing. Showing that as its own count rather than silently dropping the row is what makes
   * the total explain itself instead of merely being lower than expected.
   */
  it("does not charge again for something already bought, and says how many", () => {
    const estimate = estimateEnrichment({
      candidatesBySource: {
        places_details: candidates([{ alreadyBought: true }, {}, { alreadyBought: true }]),
      },
      sources: ["places_details"],
      selectedBusinesses: 3,
      capCents: DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
      availableEnvVars: ALL_KEYS,
    });

    const source = estimate.perSource[0];
    expect(source?.alreadyHave).toBe(2);
    expect(source?.willBuy).toBe(1);
    expect(source?.totalCents).toBe(3.5);
  });

  it("costs nothing at all when every selected business is already bought", () => {
    const estimate = estimateEnrichment({
      candidatesBySource: {
        places_details: candidates([{ alreadyBought: true }, { alreadyBought: true }]),
      },
      sources: ["places_details"],
      selectedBusinesses: 2,
      capCents: DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
      availableEnvVars: ALL_KEYS,
    });
    expect(estimate.totalCents).toBe(0);
  });

  /**
   * "Cannot buy" is deliberately not folded into "already have". A business with no Google place
   * id will never have a listing, and reporting that as data we hold would be a claim about the
   * record that is simply untrue.
   */
  it("keeps 'nothing to buy it with' separate from 'already have it'", () => {
    const estimate = estimateEnrichment({
      candidatesBySource: {
        places_details: candidates([
          { alreadyBought: true },
          { eligible: false, ineligibleReason: "no Google place id" },
          {},
        ]),
      },
      sources: ["places_details"],
      selectedBusinesses: 3,
      capCents: DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
      availableEnvVars: ALL_KEYS,
    });

    const source = estimate.perSource[0];
    expect(source?.alreadyHave).toBe(1);
    expect(source?.cannotBuy).toBe(1);
    expect(source?.willBuy).toBe(1);
  });

  it("adds up across several sources at once", () => {
    const estimate = estimateEnrichment({
      candidatesBySource: {
        places_details: candidates([{}, {}]),
        owner_mobile: candidates([{}, {}]),
      },
      sources: ["places_details", "owner_mobile"],
      selectedBusinesses: 2,
      capCents: DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
      availableEnvVars: ALL_KEYS,
    });
    // 2 × 3.5c + 2 × 73c = 7 + 146 = 153c
    expect(estimate.totalCents).toBe(153);
    expect(formatCents(estimate.totalCents)).toBe("$1.53");
  });
});

describe("estimateEnrichment — a source with no key", () => {
  /**
   * Shown, priced, and refused. Hiding it would leave the operator unaware the option exists;
   * letting it run would fail halfway through a paid batch with some businesses charged and some
   * not.
   */
  it("prices a source at zero and marks it unavailable when its key is missing", () => {
    const estimate = estimateEnrichment({
      candidatesBySource: { owner_mobile: candidates([{}, {}, {}]) },
      sources: ["owner_mobile"],
      selectedBusinesses: 3,
      capCents: DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
      availableEnvVars: ["GOOGLE_PLACES_API_KEY"], // no LUSHA_API_KEY
    });

    const source = estimate.perSource[0];
    expect(source?.unavailable).toBe(true);
    expect(source?.totalCents).toBe(0);
    expect(source?.unavailableReason).toContain("LUSHA_API_KEY");
    expect(estimate.totalCents).toBe(0);
  });

  it("does not mark a source unavailable when it needs no key of its own", () => {
    expect(ENRICHMENT_DEFINITIONS.places_details.requiresEnvVar).toBeNull();
    const estimate = estimateEnrichment({
      candidatesBySource: { places_details: candidates([{}]) },
      sources: ["places_details"],
      selectedBusinesses: 1,
      capCents: DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
      availableEnvVars: [],
    });
    expect(estimate.perSource[0]?.unavailable).toBe(false);
  });
});

describe("estimateEnrichment — the spend cap", () => {
  it("flags a run that would go over the cap", () => {
    const estimate = estimateEnrichment({
      candidatesBySource: { owner_mobile: candidates(Array.from({ length: 20 }, () => ({}))) },
      sources: ["owner_mobile"],
      selectedBusinesses: 20,
      capCents: 500, // $5.00
      availableEnvVars: ALL_KEYS,
    });
    expect(estimate.totalCents).toBe(1460); // 20 × 73c = $14.60
    expect(estimate.overCap).toBe(true);
  });

  it("does not flag a run inside the cap", () => {
    const estimate = estimateEnrichment({
      candidatesBySource: { owner_mobile: candidates(Array.from({ length: 5 }, () => ({}))) },
      sources: ["owner_mobile"],
      selectedBusinesses: 5,
      capCents: 500,
      availableEnvVars: ALL_KEYS,
    });
    expect(estimate.totalCents).toBe(365); // $3.65
    expect(estimate.overCap).toBe(false);
  });
});

describe("formatCents", () => {
  it("reads as money", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(7)).toBe("$0.07");
    expect(formatCents(153)).toBe("$1.53");
    expect(formatCents(2044_00)).toBe("$2044.00");
  });

  /** Rounds up, never down — a confirm screen must not quote less than what will be spent. */
  it("never quotes less than the real cost", () => {
    expect(formatCents(10.5)).toBe("$0.11"); // 3 × 3.5c, not "$0.10"
    expect(formatCents(0.12)).toBe("$0.01");
  });
});

describe("estimateEnrichment — an unconnected source still shows its real price", () => {
  /**
   * Displaying "$0.00" next to something that costs $2.19 is the kind of small lie that makes an
   * operator stop trusting the screen. `totalCents` is what will be charged (nothing);
   * `wouldCostCents` is what it costs, and that is what the page shows.
   */
  it("charges nothing but quotes the real figure", () => {
    const estimate = estimateEnrichment({
      candidatesBySource: { owner_mobile: candidates([{}, {}, {}]) },
      sources: ["owner_mobile"],
      selectedBusinesses: 3,
      capCents: DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
      availableEnvVars: [],
    });

    const source = estimate.perSource[0];
    expect(source?.totalCents).toBe(0);
    expect(source?.wouldCostCents).toBe(219); // 3 × 73c
    expect(formatCents(source?.wouldCostCents ?? 0)).toBe("$2.19");
    expect(estimate.totalCents).toBe(0);
  });

  it("keeps the two figures equal when the source is connected", () => {
    const estimate = estimateEnrichment({
      candidatesBySource: { owner_mobile: candidates([{}, {}, {}]) },
      sources: ["owner_mobile"],
      selectedBusinesses: 3,
      capCents: DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
      availableEnvVars: ALL_KEYS,
    });
    const source = estimate.perSource[0];
    expect(source?.totalCents).toBe(source?.wouldCostCents);
  });
});
