import { describe, expect, it } from "vitest";
import { DEFAULT_DEMAND_THRESHOLDS, demandRouteReason, provenDemand, type DemandSignals } from "./demand.js";
import { scoreBusiness } from "./score.js";

const NONE: DemandSignals = { reviewCount: null, rating: null, instagramFollowers: null };
const T = DEFAULT_DEMAND_THRESHOLDS;

describe("provenDemand", () => {
  it("accepts a business with enough reviews at a good enough rating", () => {
    const found = provenDemand({ ...NONE, reviewCount: 336, rating: 4.9 }, T);
    expect(found?.basis).toBe("reviews");
    expect(found?.evidence).toBe("4.9 stars from 336 reviews");
  });

  /** Volume alone promotes the busy but disliked. Both halves are required, and this proves it. */
  it("refuses plenty of reviews at a poor rating", () => {
    expect(provenDemand({ ...NONE, reviewCount: 206, rating: 3.6 }, T)).toBeNull();
  });

  /** A rating alone promotes a business with three happy friends. */
  it("refuses a perfect rating on too few reviews", () => {
    expect(provenDemand({ ...NONE, reviewCount: 4, rating: 5.0 }, T)).toBeNull();
  });

  it("accepts a large audience on its own, with no reviews at all", () => {
    const found = provenDemand({ ...NONE, instagramFollowers: 25_000 }, T);
    expect(found?.basis).toBe("followers");
    expect(found?.evidence).toBe("25,000 Instagram followers");
  });

  it("refuses an audience below the bar", () => {
    expect(provenDemand({ ...NONE, instagramFollowers: 900 }, T)).toBeNull();
  });

  /**
   * Unknown is not zero. A business nobody has looked up must not be judged as though it had been
   * looked up and found wanting — the same third state the rest of this codebase keeps.
   */
  it("refuses when nothing is known, rather than treating absence as failure", () => {
    expect(provenDemand(NONE, T)).toBeNull();
    expect(provenDemand({ ...NONE, rating: 4.9 }, T)).toBeNull();
    expect(provenDemand({ ...NONE, reviewCount: 336 }, T)).toBeNull();
  });

  it("honours thresholds the caller supplies instead of the defaults", () => {
    const strict = { minReviews: 500, minRating: 4.8, minFollowers: 100_000 };
    expect(provenDemand({ ...NONE, reviewCount: 336, rating: 4.9 }, strict)).toBeNull();
    expect(provenDemand({ ...NONE, reviewCount: 336, rating: 4.9 }, { ...strict, minReviews: 100 })).not.toBeNull();
  });

  it("sits exactly on the boundary rather than just past it", () => {
    expect(provenDemand({ ...NONE, reviewCount: 50, rating: 4.0 }, T)).not.toBeNull();
    expect(provenDemand({ ...NONE, reviewCount: 49, rating: 4.0 }, T)).toBeNull();
    expect(provenDemand({ ...NONE, instagramFollowers: 10_000 }, T)).not.toBeNull();
  });
});

describe("demandRouteReason", () => {
  /**
   * The reason must state both readings. An operator told "no website" who finds a website
   * mid-call has been misled by their own tool.
   */
  it("names the uncertainty instead of claiming there is no site", () => {
    const reason = demandRouteReason({ basis: "reviews", evidence: "4.9 stars from 336 reviews" });
    expect(reason).toContain("4.9 stars from 336 reviews");
    expect(reason).toContain("Either there is genuinely no site");
    expect(reason).toContain("listing is");
  });
});

/** The join: an unscorable business becoming a real lead, and the guards that keep it honest. */
describe("scoreBusiness with proven demand", () => {
  const unscorable = { findings: [], presence: "unclear" as const };

  it("rescues a business that would otherwise have no tier at all", () => {
    const without = scoreBusiness(unscorable);
    expect(without.tier).toBeNull();
    expect(without.passedGate).toBe(false);

    const with_ = scoreBusiness({
      ...unscorable,
      demand: { ...NONE, reviewCount: 336, rating: 4.9 },
    });
    expect(with_.tier).not.toBeNull();
    expect(with_.passedGate).toBe(true);
    expect(with_.route).toBe("web_development");
    expect(with_.problemScore).toBe(90);
  });

  /**
   * The grid cannot produce this on its own. Intent is the sum of the N-family findings, which need
   * a website to fire on; with none, Intent is zero and the grid returns Tier 3. The first run of
   * this rule did exactly that — seventeen businesses rescued, every one of them Tier 3.
   */
  it("reaches Tier 1, which the tier grid alone would never give it", () => {
    const rescued = scoreBusiness({ ...unscorable, demand: { ...NONE, reviewCount: 336, rating: 4.9 } });
    expect(rescued.tier).toBe(1);
    // And the Intent score keeps its real value rather than being inflated to force the grid.
    expect(rescued.intentScore).toBe(0);
  });

  /**
   * The guard that measurement forced. Running the rule against real data before building it
   * turned up Hobby Lobby (1,717 reviews) and Michaels (2,428) among the candidates — a national
   * retailer at the top of a local agency's call list.
   */
  it("refuses a chain, however good its numbers", () => {
    const chain = scoreBusiness({
      ...unscorable,
      sharedDomainReason: "The listed website belongs to the chain, not this branch.",
      demand: { ...NONE, reviewCount: 2428, rating: 4.4 },
    });
    expect(chain.tier).toBeNull();
    expect(chain.passedGate).toBe(false);
  });

  it("leaves a business with weak numbers exactly where it was", () => {
    const weak = scoreBusiness({ ...unscorable, demand: { ...NONE, reviewCount: 3, rating: 5.0 } });
    expect(weak.tier).toBeNull();
    expect(weak.passedGate).toBe(false);
    expect(weak.routeReason).toContain("Not enough was measured");
  });

  /** Only applies where the website is genuinely unconfirmed — never to a site we read and scored. */
  it("does not fire for a business whose site was read", () => {
    const live = scoreBusiness({
      findings: [],
      presence: "live",
      demand: { ...NONE, reviewCount: 336, rating: 4.9 },
    });
    expect(live.tier).toBeNull();
    expect(live.passedGate).toBe(false);
  });

  it("keeps the manual-review flag, because the status is still unconfirmed", () => {
    const rescued = scoreBusiness({
      ...unscorable,
      demand: { ...NONE, reviewCount: 336, rating: 4.9 },
    });
    expect(rescued.needsManualReview).toBe(true);
    expect(rescued.manualReviewReasons).toContain("unclear_website_status");
  });
});
