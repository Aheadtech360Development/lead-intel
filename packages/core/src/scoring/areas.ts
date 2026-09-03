import { AREA_COVERAGE_FLOOR, SERVICE_AREAS, type ServiceArea } from "@lead-intel/shared";
import { CHECK_DEFINITIONS } from "../checks/registry.js";
import type { CheckResult } from "../checks/types.js";

export interface AreaScore {
  area: ServiceArea;
  /**
   * 0-100, where 100 means every check that ran found a problem. Null when the area did not
   * clear the coverage floor — a number here would be a claim we cannot support.
   */
  score: number | null;
  /** Points from checks that fired. */
  firedPoints: number;
  /** Points available from checks that actually ran — §6.1's denominator. */
  measuredPoints: number;
  /** Points this area could carry if every check in the catalogue had run. */
  possiblePoints: number;
  /** measuredPoints / possiblePoints. What the §6.1 floor is applied to. */
  coverage: number;
  /** False when coverage is below the floor: "an area judged on one working check is noise." */
  enoughData: boolean;
  /** How many checks fired. §6.5 needs this: a route must have evidence behind it. */
  firedCount: number;
  measuredCount: number;
}

/**
 * W1, W2 and W3 restate the §4 presence verdict — no website, dead website, social page only —
 * and they are **excluded from the WEB area's score**, though they still exist as findings and an
 * operator still sees them.
 *
 * The reason is that they already do their work elsewhere. §6.2 gives them an override of their
 * own: a business with no website, a dead one, or only a social page gets Problem ≥ 90 and is
 * routed to Web development regardless of any area score. Leaving them in the area sum as well
 * counts the same fact twice — and counts it in the direction that suppresses the area, because
 * all three *pass* for any site that loads, contributing 290 of WEB's 468 points to the
 * denominator and nothing to the numerator.
 *
 * The effect, measured on the live dataset before this changed: WEB averaged **9.4** and could
 * not exceed **19.9** for any working site, however slow or broken. A site scoring 3/100 on
 * PageSpeed with a 27-second load could never be routed to Web development. Excluding them scores
 * W4–W12 out of their own 178 points, which is what those checks actually measure — the quality
 * of a site that exists.
 *
 * Honest note on the size of this: it moves the recommended pitch for about five businesses in
 * 141. The dominant reason WEB rarely wins is not this — it is that 69 of 141 live sites carry no
 * tracking at all, which scores ADS a full 100.
 */
const PRESENCE_CHECK_IDS = new Set(["W1", "W2", "W3"]);

/** True when a check belongs to §6.2's presence override rather than to its area's score. */
export function isPresenceCheck(checkId: string): boolean {
  return PRESENCE_CHECK_IDS.has(checkId);
}

/**
 * Total points each area could ever carry, from the registry — **including the PAID and BEST
 * EFFORT checks nothing runs yet.** That inclusion is the whole point of the coverage floor: an
 * area is only scored when enough of what *could* be known actually is. Counting only the checks
 * this system happens to have built would make every area look fully covered on the day it was
 * built, which is the opposite of what §6.1 asks for.
 */
const POSSIBLE_POINTS: Record<ServiceArea, number> = SERVICE_AREAS.reduce(
  (acc, area) => {
    acc[area] = CHECK_DEFINITIONS.filter((check) => check.area === area && !isPresenceCheck(check.id)).reduce(
      (sum, check) => sum + check.points,
      0,
    );
    return acc;
  },
  {} as Record<ServiceArea, number>,
);

/**
 * Scores each of §6.1's six areas from a business's findings.
 *
 *     area score = 100 × (points from checks that fired) ÷ (points available from checks that ran)
 *
 * A check that could not run is absent from both sides — it never counts as a pass and never
 * counts against the business. That rule is already carried by the findings themselves: a
 * `not_measured` result has zero points on both sides, so it simply contributes nothing to either
 * sum here. There is no filtering to remember and therefore none to forget.
 */
export function scoreAreas(findings: CheckResult[]): Record<ServiceArea, AreaScore> {
  const scores = {} as Record<ServiceArea, AreaScore>;

  for (const area of SERVICE_AREAS) {
    const inArea = findings.filter((finding) => finding.area === area && !isPresenceCheck(finding.checkId));
    const firedPoints = inArea.reduce((sum, f) => sum + f.points, 0);
    const measuredPoints = inArea.reduce((sum, f) => sum + f.maxPoints, 0);
    const possiblePoints = POSSIBLE_POINTS[area];
    const coverage = possiblePoints > 0 ? measuredPoints / possiblePoints : 0;
    const enoughData = coverage >= AREA_COVERAGE_FLOOR && measuredPoints > 0;

    scores[area] = {
      area,
      score: enoughData ? round1((100 * firedPoints) / measuredPoints) : null,
      firedPoints,
      measuredPoints,
      possiblePoints,
      coverage: round3(coverage),
      enoughData,
      firedCount: inArea.filter((f) => f.outcome === "fired").length,
      measuredCount: inArea.filter((f) => f.outcome === "fired" || f.outcome === "passed").length,
    };
  }

  return scores;
}

/** Exported so a test can assert the registry totals rather than trust a comment about them. */
export function possiblePointsFor(area: ServiceArea): number {
  return POSSIBLE_POINTS[area];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
