import { AREA_WEIGHTS, SERVICE_AREAS, type ServiceArea, type WebsiteStatus } from "@lead-intel/shared";
import { describe, expect, it } from "vitest";
import { checkDefinition } from "../checks/registry.js";
import { fired, notMeasured, passed } from "../checks/result.js";
import type { CheckResult } from "../checks/types.js";
import { isPresenceCheck, possiblePointsFor, scoreAreas } from "./areas.js";
import { scoreBusiness } from "./score.js";

/** Builds a findings list from a compact spec: "W4:fired K1:passed S9:not_measured". */
function findings(spec: string): CheckResult[] {
  return spec
    .split(/\s+/)
    .filter(Boolean)
    .map((entry) => {
      const [id, outcome] = entry.split(":");
      if (!id) throw new Error(`bad spec entry: ${entry}`);
      if (outcome === "fired") return fired(id, `${id} fired`);
      if (outcome === "passed") return passed(id, `${id} passed`);
      return notMeasured(id, `${id} not measured`);
    });
}

/** Every check in an area, all passed — the shape that gives full coverage and a zero score. */
function wholeArea(area: ServiceArea, outcome: "fired" | "passed"): CheckResult[] {
  const ids = ALL_IDS.filter((id) => checkDefinition(id).area === area && !isPresenceCheck(id));
  return findings(ids.map((id) => `${id}:${outcome}`).join(" "));
}

const ALL_IDS = [
  "W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12",
  "K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8",
  "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12", "S13", "S14",
  "R1", "R2", "R3", "R4", "R5", "R6",
  "O1", "O2", "O3", "O4", "O5", "O6", "O7", "O8",
  "D1", "D2", "D3", "D4", "D5", "D6",
];

// ---------------------------------------------------------------------------
// §6.1 area scores and the coverage floor
// ---------------------------------------------------------------------------

describe("the spec's own numbers", () => {
  it("area weights sum to 1.00", () => {
    const total = SERVICE_AREAS.reduce((sum, area) => sum + AREA_WEIGHTS[area], 0);
    expect(Math.round(total * 100) / 100).toBe(1);
  });

  /**
   * Asserted against the registry rather than stated in a comment, because these totals are what
   * the coverage floor divides by — an ID transcribed with the wrong point value would silently
   * change which areas are scoreable at all.
   */
  it("possible points per area match the spec's tables", () => {
    // W4-W12 only: W1/W2/W3 drive §6.2's presence override instead of the area score.
    expect(possiblePointsFor("WEB")).toBe(178);
    expect(possiblePointsFor("CON")).toBe(132); // K1-K8
    expect(possiblePointsFor("SEO")).toBe(283); // S1-S14
    expect(possiblePointsFor("REP")).toBe(135); // R1-R6
    expect(possiblePointsFor("SOC")).toBe(178); // O1-O8
    expect(possiblePointsFor("ADS")).toBe(120); // D1-D6
  });
});

describe("scoreAreas — the presence checks are scored by the override, not by the area", () => {
  /**
   * W1/W2/W3 restate the §4 presence verdict and drive §6.2's override. Leaving them in the WEB
   * sum as well counted the same fact twice, in the direction that suppressed the area: all three
   * pass for any site that loads, adding 290 points to the denominator and none to the numerator.
   * Measured on the live dataset before this changed, WEB averaged 9.4 and could not exceed 19.9
   * for any working site, however slow or broken.
   */
  it("gives the same WEB score whether or not the presence checks are present", () => {
    const quality = findings("W4:fired W5:fired W6:fired W7:fired W8:passed W9:passed W10:passed W11:passed W12:passed");
    const withPresence = scoreAreas([...quality, ...findings("W1:passed W2:passed W3:passed")]);
    const without = scoreAreas(quality);

    expect(withPresence.WEB.score).toBe(without.WEB.score);
    expect(withPresence.WEB.measuredPoints).toBe(without.WEB.measuredPoints);
  });

  it("lets a bad but working site actually score on WEB", () => {
    // W4 30 + W5 35 + W6 30 + W7 25 fired, the rest of W8-W12 passed: 120 of 178.
    const areas = scoreAreas(
      findings("W4:fired W5:fired W6:fired W7:fired W8:passed W9:passed W10:passed W11:passed W12:passed W1:passed W2:passed W3:passed"),
    );
    expect(areas.WEB.score).toBeGreaterThan(60);
  });

  /** The override still does its job — that is where these three are supposed to act. */
  it("still forces web development for a dead site even though W2 is out of the area sum", () => {
    const result = scoreBusiness({
      findings: [...findings("W2:fired"), ...wholeArea("CON", "passed")],
      presence: "dead",
    });
    expect(result.route).toBe("web_development");
    expect(result.problemScore).toBeGreaterThanOrEqual(90);
  });
});

describe("scoreAreas — §6.1", () => {
  it("scores fired over measured, not over possible", () => {
    // K1 (30) fired, K3 (20) passed. Nothing else ran.
    const areas = scoreAreas(findings("K1:fired K3:passed"));
    expect(areas.CON.firedPoints).toBe(30);
    expect(areas.CON.measuredPoints).toBe(50);
    expect(areas.CON.possiblePoints).toBe(132);
    // 50/132 = 38% coverage, under the 40% floor.
    expect(areas.CON.enoughData).toBe(false);
    expect(areas.CON.score).toBeNull();
  });

  it("scores an area once it clears the floor", () => {
    const areas = scoreAreas(findings("K1:fired K3:passed K4:passed"));
    expect(areas.CON.measuredPoints).toBe(65); // 30 + 20 + 15
    expect(areas.CON.enoughData).toBe(true);
    expect(areas.CON.score).toBe(46.2); // 100 × 30/65
  });

  /** §6.1: a check that could not run is left out of both sides. */
  it("leaves unmeasured checks out of both the numerator and the denominator", () => {
    const withGaps = scoreAreas(findings("K1:fired K3:passed K4:passed K5:not_measured K7:not_measured"));
    const without = scoreAreas(findings("K1:fired K3:passed K4:passed"));
    expect(withGaps.CON.score).toBe(without.CON.score);
    expect(withGaps.CON.measuredPoints).toBe(without.CON.measuredPoints);
  });

  it("gives an all-passed area a score of zero, not null", () => {
    const areas = scoreAreas(wholeArea("CON", "passed"));
    expect(areas.CON.enoughData).toBe(true);
    expect(areas.CON.score).toBe(0);
  });

  it("gives an all-fired area a score of 100", () => {
    expect(scoreAreas(wholeArea("CON", "fired")).CON.score).toBe(100);
  });

  it("reports an area with nothing measured as not enough data", () => {
    const areas = scoreAreas(findings("K1:not_measured K3:not_measured"));
    expect(areas.CON.enoughData).toBe(false);
    expect(areas.CON.score).toBeNull();
    expect(areas.CON.measuredPoints).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §6.2 Problem, §6.3 Intent, §6.4 tiers
// ---------------------------------------------------------------------------

describe("scoreBusiness — §6.2 Problem", () => {
  it("weights the worst area at 0.6 and the weighted average at 0.4", () => {
    // CON all fired (100), ADS all passed (0). Weights: CON 0.14, ADS 0.12.
    const result = scoreBusiness({
      findings: [...wholeArea("CON", "fired"), ...wholeArea("ADS", "passed")],
      presence: "live",
    });
    // worst = 100; weighted average = (100×0.14 + 0×0.12) / 0.26 = 53.85
    // Problem = 0.6×100 + 0.4×53.85 = 81.5
    expect(result.problemScore).toBe(81.5);
  });

  /**
   * §6.2's stated purpose for the worst-area term: "A business with no website at all should not
   * score mid-range simply because its other areas could not be measured."
   */
  it("does not dilute one catastrophic area with several clean ones", () => {
    const result = scoreBusiness({
      findings: [...wholeArea("CON", "fired"), ...wholeArea("ADS", "passed"), ...wholeArea("SOC", "passed")],
      presence: "live",
    });
    expect(result.problemScore).toBeGreaterThan(60);
  });

  it.each<WebsiteStatus>(["no_website", "dead", "social_only"])(
    "forces Problem to at least 90 and the route to web development when presence is %s",
    (presence) => {
      const result = scoreBusiness({ findings: wholeArea("CON", "passed"), presence });
      expect(result.problemScore).toBeGreaterThanOrEqual(90);
      expect(result.route).toBe("web_development");
    },
  );

  it("does not apply the override to a working website", () => {
    const result = scoreBusiness({ findings: wholeArea("CON", "passed"), presence: "live" });
    expect(result.problemScore).toBe(0);
    expect(result.route).not.toBe("web_development");
  });
});

describe("scoreBusiness — §6.3 Intent", () => {
  it("sums the credits that fired", () => {
    const result = scoreBusiness({
      findings: [...wholeArea("CON", "passed"), ...findings("N1:fired N9:fired")],
      presence: "live",
    });
    expect(result.intentScore).toBe(30); // 20 + 10
  });

  /** §6.3: "a missing signal adds nothing and never subtracts". */
  it("never goes below zero when nothing fired", () => {
    const result = scoreBusiness({
      findings: [...wholeArea("CON", "passed"), ...findings("N1:passed N6:passed N9:passed N10:passed")],
      presence: "live",
    });
    expect(result.intentScore).toBe(0);
  });

  it("caps at 100", () => {
    const everyCredit = findings("N1:fired N2:fired N3:fired N4:fired N5:fired N6:fired N7:fired N8:fired N9:fired N10:fired");
    const result = scoreBusiness({ findings: [...wholeArea("CON", "passed"), ...everyCredit], presence: "live" });
    expect(result.intentScore).toBe(100); // raw total is 135
  });
});

describe("scoreBusiness — §6.4 tiers", () => {
  const cases: { problem: "high" | "low"; intent: "high" | "low"; tier: number }[] = [
    { problem: "high", intent: "high", tier: 1 },
    { problem: "low", intent: "high", tier: 2 },
    { problem: "high", intent: "low", tier: 3 },
    { problem: "low", intent: "low", tier: 4 },
  ];

  it.each(cases)("problem $problem + intent $intent = tier $tier", ({ problem, intent, tier }) => {
    const result = scoreBusiness({
      findings: [
        ...wholeArea("CON", problem === "high" ? "fired" : "passed"),
        ...findings(intent === "high" ? "N1:fired N6:fired N9:fired" : "N1:passed"),
      ],
      presence: "live",
    });
    expect(result.tier).toBe(tier);
  });

  /** §6.4: "Tier changes priority, never eligibility." Nothing here may exclude a business. */
  it("always produces a tier when a Problem score exists", () => {
    for (const outcome of ["fired", "passed"] as const) {
      const result = scoreBusiness({ findings: wholeArea("CON", outcome), presence: "live" });
      expect(result.tier).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// §6.5 routing — including the two refusals
// ---------------------------------------------------------------------------

describe("scoreBusiness — §6.5 routing", () => {
  it("routes to the highest-scoring area", () => {
    const result = scoreBusiness({
      findings: [...wholeArea("ADS", "fired"), ...wholeArea("CON", "passed")],
      presence: "live",
    });
    expect(result.route).toBe("advertising");
  });

  /** §6.5's tie-break order, applied when the top two are within 5 points. */
  it("breaks a near-tie by the spec's precedence order, not by score", () => {
    // CON: K1 (30) fired of K1+K3+K4+K5 (80 measured) = 37.5
    // ADS: D1 (35) fired of D1+D2+D3+D4 (95 measured) = 36.8 — within 5 points, and CON wins.
    const result = scoreBusiness({
      findings: findings("K1:fired K3:passed K4:passed K5:passed D1:fired D2:passed D3:passed D4:passed"),
      presence: "live",
    });
    expect(result.areas.CON.score).toBe(37.5);
    expect(result.areas.ADS.score).toBe(36.8);
    expect(result.route).toBe("contactability"); // ahead of advertising in SERVICE_ROUTES
  });

  /**
   * §6.5, verbatim: "A route must have evidence. If the winning area has no check that actually
   * fired with a stored result, the business goes to manual review instead of getting a route. A
   * recommendation with nothing to show is not a recommendation."
   */
  it("refuses to route a business whose best area has nothing to show", () => {
    const result = scoreBusiness({ findings: wholeArea("CON", "passed"), presence: "live" });
    expect(result.route).toBeNull();
    expect(result.needsManualReview).toBe(true);
    expect(result.manualReviewReasons).toContain("no_evidence_for_route");
  });
});

// ---------------------------------------------------------------------------
// The refusal that matters most: nothing measured means nothing claimed
// ---------------------------------------------------------------------------

describe("scoreBusiness — what it refuses to claim", () => {
  const unmeasured = scoreBusiness({
    findings: findings(ALL_IDS.map((id) => `${id}:not_measured`).join(" ")),
    presence: "unclear",
  });

  it("produces no Problem score rather than a zero", () => {
    expect(unmeasured.problemScore).toBeNull();
    expect(unmeasured.problemScore).not.toBe(0);
  });

  it("produces no tier and no route", () => {
    expect(unmeasured.tier).toBeNull();
    expect(unmeasured.route).toBeNull();
  });

  it("does not pass the gate, so nothing is bought for it", () => {
    expect(unmeasured.passedGate).toBe(false);
  });

  it("sends it to a human with the reason attached", () => {
    expect(unmeasured.needsManualReview).toBe(true);
    expect(unmeasured.manualReviewReasons).toContain("unclear_website_status");
    expect(unmeasured.routeReason).toMatch(/not measured|Not enough/i);
  });

  it("still reports Intent, because a credit that fired was genuinely observed", () => {
    const withCredit = scoreBusiness({
      findings: [...findings(ALL_IDS.map((id) => `${id}:not_measured`).join(" ")), ...findings("N1:fired")],
      presence: "unclear",
    });
    expect(withCredit.intentScore).toBe(20);
    expect(withCredit.problemScore).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A website that is not theirs
// ---------------------------------------------------------------------------

describe("scoreBusiness — a listed website that belongs to a platform or a chain", () => {
  const reason = "The listed website is the national walmart.com site, not this location's own.";
  const scored = scoreBusiness({
    findings: wholeArea("CON", "fired"),
    presence: "live",
    sharedDomainReason: reason,
  });

  it("still computes the score — the numbers describe the site that was crawled", () => {
    expect(scored.problemScore).not.toBeNull();
    expect(scored.areas.CON.score).toBe(100);
  });

  /**
   * §9's gate decides where money gets spent. Buying Google listing details and rank lookups
   * because a chain's store-locator page has no Meta Pixel is spending on a finding that was
   * never about this business. In the first scored run, six such records passed the gate and one
   * of only two Tier 1 leads was `local.targetoptical.com`.
   */
  it("holds it back from the gate however high it scores", () => {
    expect(scored.passedGate).toBe(false);
  });

  it("flags it, and leads the explanation with the warning", () => {
    expect(scored.needsManualReview).toBe(true);
    expect(scored.manualReviewReasons).toContain("shared_domain");
    expect(scored.routeReason.startsWith(reason)).toBe(true);
  });

  it("leaves an ordinary business untouched", () => {
    const ordinary = scoreBusiness({ findings: wholeArea("CON", "fired"), presence: "live" });
    expect(ordinary.manualReviewReasons).not.toContain("shared_domain");
    expect(ordinary.passedGate).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// What the FREE checks alone can and cannot score — an honest limitation
// ---------------------------------------------------------------------------

describe("coverage with only the FREE checks built", () => {
  /**
   * SEO and REP cannot clear the §6.1 floor from FREE checks alone, and that is the correct
   * answer rather than a defect: you cannot judge a business's local search without looking at
   * its Google listing and its rankings, and you cannot judge its reputation without reading its
   * reviews. Both are PAID. This test exists so the day those are built, the number moves
   * visibly rather than silently.
   */
  it("cannot score SEO or REP, and says so", () => {
    const freeOnly = findings(
      ALL_IDS.filter((id) => checkDefinition(id).costClass === "FREE" && checkDefinition(id).area !== null)
        .map((id) => `${id}:passed`)
        .join(" "),
    );
    const areas = scoreAreas(freeOnly);

    expect(areas.SEO.enoughData).toBe(false);
    expect(areas.REP.enoughData).toBe(false);
    expect(areas.WEB.enoughData).toBe(true);
    expect(areas.CON.enoughData).toBe(true);
    expect(areas.SOC.enoughData).toBe(true);
    expect(areas.ADS.enoughData).toBe(true);
  });
});

/**
 * The regression that this suite did not catch, and now does.
 *
 * Scoring the Google rating and review count for every business — right in itself — gave REP a
 * score for businesses whose website nobody could read. That took them out of the "nothing was
 * measured" branch the demand rescue lived in, and 19 of the best leads on the live list came out
 * at Problem 0, Priority 4: Kiwi Beauty Supply with 4,858 reviews among them.
 */
describe("proven demand behind an unreadable website", () => {
  const listingOnly = (reviews: number, rating: number) =>
    scoreBusiness({
      findings: [
        { checkId: "R1", family: "R", area: "REP", costClass: "PAID", outcome: "passed", points: 0, maxPoints: 35, evidence: `${reviews} reviews` },
        { checkId: "R2", family: "R", area: "REP", costClass: "PAID", outcome: "passed", points: 0, maxPoints: 30, evidence: `${rating} stars` },
        { checkId: "S1", family: "S", area: "SEO", costClass: "PAID", outcome: "passed", points: 0, maxPoints: 40, evidence: "has a listing" },
      ],
      presence: "unclear",
      demand: { reviewCount: reviews, rating, instagramFollowers: null },
    });

  it("keeps a business with hundreds of reviews and no readable site at Priority 1", () => {
    const score = listingOnly(4858, 4.7);
    expect(score.tier).toBe(1);
    expect(score.problemScore).toBe(90);
    expect(score.route).toBe("web_development");
    expect(score.passedGate).toBe(true);
  });

  it("still refuses a chain, whose listed site belongs to head office", () => {
    const score = scoreBusiness({
      findings: [
        { checkId: "R1", family: "R", area: "REP", costClass: "PAID", outcome: "passed", points: 0, maxPoints: 35, evidence: "2428 reviews" },
      ],
      presence: "unclear",
      sharedDomainReason: "The listed website is the national michaels.com site, not this location's own.",
      demand: { reviewCount: 2428, rating: 4.4, instagramFollowers: null },
    });
    expect(score.tier).not.toBe(1);
    expect(score.passedGate).toBe(false);
  });

  it("never quietens a business the checks did find fault with", () => {
    const score = scoreBusiness({
      findings: [
        { checkId: "R1", family: "R", area: "REP", costClass: "PAID", outcome: "fired", points: 35, maxPoints: 35, evidence: "3 reviews" },
        { checkId: "R2", family: "R", area: "REP", costClass: "PAID", outcome: "fired", points: 30, maxPoints: 30, evidence: "2.1 stars" },
      ],
      presence: "unclear",
      demand: { reviewCount: 3, rating: 2.1, instagramFollowers: null },
    });
    // No proven demand here, so the ordinary path runs and the real problem score stands.
    expect(score.problemScore).toBe(100);
  });
});

/**
 * The 49 live businesses whose Google listing carries no website at all.
 *
 * `classifyPresence` will not call them `no_website` — §4 wants three checks and only one exists —
 * and that refusal was leaving them at an average Problem of 53.4 and Priority 3. The certainty is
 * still withheld; the score is not.
 */
describe("a listing Google says has no website", () => {
  const s6Fired = {
    checkId: "S6",
    family: "S" as const,
    area: "SEO" as const,
    costClass: "PAID" as const,
    outcome: "fired" as const,
    points: 30,
    maxPoints: 30,
    evidence: "The Google listing has no website link.",
  };

  it("is the biggest problem there is, even though the status stays unclear", () => {
    const score = scoreBusiness({
      findings: [
        s6Fired,
        { checkId: "R1", family: "R", area: "REP", costClass: "PAID", outcome: "passed", points: 0, maxPoints: 35, evidence: "40 reviews" },
      ],
      presence: "unclear",
      demand: { reviewCount: 40, rating: 4.1, instagramFollowers: null },
    });

    expect(score.problemScore).toBe(90);
    expect(score.route).toBe("web_development");
    // Still unconfirmed, and the line says so rather than claiming certainty.
    expect(score.routeReason).toContain("very likely rather than certain");
    expect(score.needsManualReview).toBe(true);
  });

  it("scores one with nothing else measured at all, rather than refusing", () => {
    const score = scoreBusiness({ findings: [s6Fired], presence: "unclear" });

    expect(score.problemScore).toBe(90);
    expect(score.tier).toBe(3); // a lot wrong, no sign yet that they spend
    expect(score.passedGate).toBe(true);
  });

  /** A site that loads is not short of a website, whatever its listing forgot to mention. */
  it("does not fire for a business whose website works", () => {
    const score = scoreBusiness({
      findings: [
        s6Fired,
        { checkId: "K1", family: "K", area: "CON", costClass: "FREE", outcome: "passed", points: 0, maxPoints: 25, evidence: "phone on the page" },
      ],
      presence: "live",
    });
    // Null, not 90: their site loads, and two checks is not enough coverage to score anything.
    // "We have not measured enough" is the right answer; "they have no website" would be a lie.
    expect(score.problemScore).toBeNull();
    expect(score.route).not.toBe("web_development");
  });

  it("still refuses a chain", () => {
    const score = scoreBusiness({
      findings: [s6Fired],
      presence: "unclear",
      sharedDomainReason: "The listed website is a national chain's.",
    });
    expect(score.passedGate).toBe(false);
  });
});
