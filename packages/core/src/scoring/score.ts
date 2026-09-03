import {
  AREA_TO_ROUTE,
  AREA_WEIGHTS,
  INTENT_SCORE_CAP,
  GATE_PROBLEM_SCORE,
  PRESENCE_OVERRIDE_PROBLEM_SCORE,
  ROUTE_TIE_BREAK_POINTS,
  SERVICE_ROUTES,
  TIER_INTENT_THRESHOLD,
  TIER_PROBLEM_THRESHOLD,
  type ManualReviewReason,
  type ServiceArea,
  type ServiceRoute,
  type Tier,
  type WebsiteStatus,
} from "@lead-intel/shared";
import type { CheckResult } from "../checks/types.js";
import { scoreAreas, type AreaScore } from "./areas.js";

export interface BusinessScore {
  areas: Record<ServiceArea, AreaScore>;
  /** §6.2. Null when no area cleared the coverage floor — nothing was measured well enough. */
  problemScore: number | null;
  /** §6.3, capped at 100. Always a number: a missing signal is zero credit, not unknown. */
  intentScore: number;
  /** §6.4. Null whenever problemScore is null — a tier without a Problem score is meaningless. */
  tier: Tier | null;
  /** §6.5. Null when no area qualifies, or when the winning area has no evidence behind it. */
  route: ServiceRoute | null;
  /** Plain-language explanation of the route, or of why there is none. */
  routeReason: string;
  /** §9 Stage 5: is this business worth buying paid data for? */
  passedGate: boolean;
  /** True when a human should look before this is acted on. */
  needsManualReview: boolean;
  manualReviewReasons: ManualReviewReason[];
}

/**
 * Turns a business's findings into §6's Problem score, Intent score, tier and route, and decides
 * the §9 Stage 5 gate.
 *
 * Pure and deterministic — the same bar as the checks it consumes. It reads findings and a
 * presence state and returns numbers; nothing here fetches, writes, or knows what a database is.
 *
 * Three refusals are built in, and they are the interesting part:
 *
 * - **No area cleared the coverage floor → no Problem score, no tier, no route.** Not zero, and
 *   not a mid-range number. §6.1: "An area judged on one working check is noise."
 * - **A winning area with nothing fired → no route.** §6.5 states this outright: "A route must
 *   have evidence. If the winning area has no check that actually fired with a stored result, the
 *   business goes to manual review instead of getting a route. A recommendation with nothing to
 *   show is not a recommendation."
 * - **A business we could not settle a presence state for is flagged**, because the §6.2 override
 *   turns on that state and getting it wrong moves the Problem score by 90 points.
 */
export function scoreBusiness(params: {
  findings: CheckResult[];
  presence: WebsiteStatus;
  /**
   * Set when the listed website belongs to a booking platform or a national chain rather than to
   * this business (see normalize/shared-domain.ts). The score is still computed — the numbers
   * describe that site accurately — but the record is flagged, because presenting it as this
   * business's score would be the most confident kind of wrong. In the first scored run this was
   * one of only two Tier 1 leads.
   */
  sharedDomainReason?: string | null;
}): BusinessScore {
  const areas = scoreAreas(params.findings);
  const scored = Object.values(areas).filter(
    (area): area is AreaScore & { score: number } => area.score !== null,
  );

  const intentScore = Math.min(
    INTENT_SCORE_CAP,
    params.findings.filter((f) => f.family === "N").reduce((sum, f) => sum + f.points, 0),
  );

  const manualReviewReasons: ManualReviewReason[] = [];
  if (params.sharedDomainReason) manualReviewReasons.push("shared_domain");

  if (scored.length === 0) {
    // Nothing was measured well enough to score. This is a real and common state — a site that
    // could not be read produces exactly it — and it must not collapse into "no problems".
    if (params.presence === "unclear") manualReviewReasons.push("unclear_website_status");
    return {
      areas,
      problemScore: null,
      intentScore,
      tier: null,
      route: null,
      routeReason:
        params.sharedDomainReason ??
        "Not enough was measured to score this business. Nothing here is a judgement about them — see the checks marked not measured.",
      passedGate: false,
      needsManualReview: true,
      manualReviewReasons: manualReviewReasons.length > 0 ? manualReviewReasons : ["no_evidence_for_route"],
    };
  }

  // §6.2. The "worst area" is the highest-scoring one: an area score of 100 means every check
  // that ran found a problem. The term exists so a single catastrophic problem is not diluted by
  // areas that happen to look fine.
  const worst = Math.max(...scored.map((area) => area.score));
  const weightSum = scored.reduce((sum, area) => sum + AREA_WEIGHTS[area.area], 0);
  const weightedAverage =
    weightSum > 0 ? scored.reduce((sum, area) => sum + area.score * AREA_WEIGHTS[area.area], 0) / weightSum : 0;

  let problemScore = round1(0.6 * worst + 0.4 * weightedAverage);
  let forcedRoute: ServiceRoute | null = null;
  let routeReason: string;

  // §6.2's override. A business with no website, a dead one, or only a social page has a problem
  // no other area can outrank, and nothing else can be sold until there is a website (§6.5).
  const presenceOverride =
    params.presence === "no_website" || params.presence === "dead" || params.presence === "social_only";
  if (presenceOverride) {
    problemScore = Math.max(problemScore, PRESENCE_OVERRIDE_PROBLEM_SCORE);
    forcedRoute = "web_development";
  }

  const winner = pickArea(scored);
  let route: ServiceRoute | null;

  if (forcedRoute) {
    route = forcedRoute;
    routeReason =
      params.presence === "no_website"
        ? "No website at all — nothing else can be sold until there is one."
        : params.presence === "dead"
          ? "The website is dead or parked — rebuilding it comes before anything else."
          : "Only a social page, no website of their own.";
  } else if (winner.firedCount === 0) {
    // §6.5, verbatim: a recommendation with nothing to show is not a recommendation.
    route = null;
    routeReason = `The strongest area (${winner.area}) has no finding to show, so there is nothing to open a conversation with.`;
    manualReviewReasons.push("no_evidence_for_route");
  } else {
    route = AREA_TO_ROUTE[winner.area];
    routeReason = `${winner.area} scores highest (${winner.score}) with ${winner.firedCount} finding${winner.firedCount === 1 ? "" : "s"} to show.`;
  }

  if (params.presence === "unclear") manualReviewReasons.push("unclear_website_status");

  return {
    areas,
    problemScore,
    intentScore,
    tier: toTier(problemScore, intentScore),
    route,
    // The shared-domain warning leads, because it changes what every sentence after it means.
    routeReason: params.sharedDomainReason ? `${params.sharedDomainReason} ${routeReason}` : routeReason,
    // §9's gate decides where money gets spent. Buying Google listing details and rank lookups
    // because a national chain's store-locator page has no Meta Pixel is spending on a finding
    // that was never about this business.
    passedGate: problemScore >= GATE_PROBLEM_SCORE && !params.sharedDomainReason,
    needsManualReview: manualReviewReasons.length > 0,
    manualReviewReasons,
  };
}

/**
 * §6.5: "The area with the highest score wins. When the top two are within 5 points, this order
 * decides." The order is SERVICE_ROUTES, whose index order *is* the tie-break order.
 *
 * The tie-break is applied across every area within 5 points of the leader, not only the second
 * — otherwise three areas clustered together would be decided by which happened to sort first.
 */
function pickArea(scored: (AreaScore & { score: number })[]): AreaScore & { score: number } {
  const best = Math.max(...scored.map((area) => area.score));
  const contenders = scored.filter((area) => best - area.score <= ROUTE_TIE_BREAK_POINTS);
  if (contenders.length === 1) return contenders[0] as AreaScore & { score: number };

  return contenders.reduce((winner, area) =>
    SERVICE_ROUTES.indexOf(AREA_TO_ROUTE[area.area]) < SERVICE_ROUTES.indexOf(AREA_TO_ROUTE[winner.area])
      ? area
      : winner,
  );
}

/** §6.4's grid. Tier changes priority, never eligibility — every business stays visible. */
function toTier(problem: number, intent: number): Tier {
  const highProblem = problem >= TIER_PROBLEM_THRESHOLD;
  const highIntent = intent >= TIER_INTENT_THRESHOLD;
  if (highProblem && highIntent) return 1;
  if (!highProblem && highIntent) return 2;
  if (highProblem && !highIntent) return 3;
  return 4;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
