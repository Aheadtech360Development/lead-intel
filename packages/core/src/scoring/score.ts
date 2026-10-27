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
import {
  DEFAULT_DEMAND_THRESHOLDS,
  demandRouteReason,
  provenDemand,
  type DemandSignals,
  type DemandThresholds,
} from "./demand.js";

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
  /**
   * Review count, rating and follower count, for the one case where they can carry a business on
   * their own: a listing with no website behind it. See demand.ts for why that case exists and why
   * these businesses were previously invisible.
   */
  demand?: DemandSignals;
  demandThresholds?: DemandThresholds;
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

  /**
   * **Google's own listing says there is no website.**
   *
   * S6 fires only when the listing was read and carried no website link — a fact reported by
   * Google, not an inference from a failed crawl. It is read straight off the findings rather than
   * passed in, so no caller can forget to supply it.
   *
   * This exists because of a gap that cost the operator their best leads. `classifyPresence`
   * refuses to return `no_website` on purpose: §4 wants three checks — the listing field, a
   * Facebook lookup and a name search — and only the first exists, so a business with no website
   * comes back as `unclear`. That refusal is right about certainty and was wrong about
   * consequence: 49 live businesses whose listing has no website sat at an average Problem score
   * of **53.4 and Priority 3**, when "no website at all" is the single biggest problem a local
   * business can have and the clearest thing this agency sells.
   *
   * So the certainty stays where it was — the status is still `unclear`, the record is still
   * flagged for a human — and the **score** stops pretending the question is open. The reason line
   * says exactly what is known and what is not.
   */
  const listingHasNoWebsite = params.findings.some((f) => f.checkId === "S6" && f.outcome === "fired");

  const NO_SITE_REASON =
    "Google's listing carries no website at all. Confirming it absolutely would also need a Facebook check and a name search, which this system cannot do yet — so treat it as very likely rather than certain. Nothing else can be sold until they have a site.";

  /**
   * Proven demand behind a website nobody could read.
   *
   * Worked out here rather than inside the "nothing measured" branch below, because that branch
   * stopped being the only way to arrive at this state. The moment the Google rating and review
   * count started being scored for every business (apps/jobs/src/listing-facts.ts), REP began to
   * carry a score on its own — so a business with 4,858 reviews, no readable website and nothing
   * else measured fell out of the rescue it was written for and came out at **Problem 0, Priority
   * 4**, which is the exact opposite of what it is. Kiwi Beauty Supply, One Hour Tees and 17 others
   * did precisely that on the live list.
   *
   * `unclear` is the condition because that is what it means: the site could not be read. A site
   * that *was* read lands on one of the other four presence states, so this can never override a
   * business we actually measured.
   */
  const demand =
    params.presence === "unclear" && !params.sharedDomainReason && params.demand
      ? provenDemand(params.demand, params.demandThresholds ?? DEFAULT_DEMAND_THRESHOLDS)
      : null;

  if (scored.length === 0) {
    // Nothing was measured well enough to score. This is a real and common state — a site that
    // could not be read produces exactly it — and it must not collapse into "no problems".
    if (params.presence === "unclear") manualReviewReasons.push("unclear_website_status");

    /**
     * One exception, and it rescues the best leads in the list.
     *
     * A business whose Google listing has no website and which has proven demand anyway needs no
     * area score to be worth calling — the absence *is* the finding, and the reviews or followers
     * are the evidence that somebody wants what they sell. 75 of 76 such businesses were falling
     * out here, including 4.9 stars from 336 reviews.
     *
     * Chains are excluded by the same `sharedDomainReason` test the gate uses below, and for the
     * same reason. Measuring this rule before building it turned up Hobby Lobby and Michaels among
     * the candidates — a naive version would have put a national retailer at the top of a local
     * agency's call list.
     */
    if (demand) {
      return {
        areas,
        problemScore: PRESENCE_OVERRIDE_PROBLEM_SCORE,
        intentScore,
        /**
         * Tier 1 outright, not through the grid.
         *
         * §6.4's grid needs a high Problem score **and** a high Intent score, and Intent is the sum
         * of the N-family findings — which need a website to fire on. These businesses have none,
         * so their Intent is zero and the grid puts them at Tier 3 however good their numbers are.
         * That is what happened on the first run of this rule: seventeen businesses rescued, all of
         * them Tier 3, one with 4.1 stars from 261 reviews.
         *
         * The grid is not wrong; it is being asked a question it was not built for. Intent asks
         * "are they already spending on their presence", and its usual evidence is a tracking pixel
         * or a live ad. Hundreds of good reviews answer the same question from a different
         * direction — this is a business people already want, which is the whole reason to call it.
         *
         * `intentScore` is left at its true value rather than inflated to force the grid. The number
         * on the record keeps meaning exactly what it means everywhere else, and the reason line
         * below says plainly why the priority is what it is.
         */
        tier: 1,
        route: "web_development",
        routeReason: demandRouteReason(demand),
        passedGate: true,
        // Still flagged. The website status is genuinely unconfirmed, and the operator should see
        // that before the call rather than discover it during one.
        needsManualReview: true,
        manualReviewReasons,
      };
    }

    /**
     * No website, and not enough reviews to be rescued by demand either.
     *
     * Still a Priority 3 lead rather than an unscorable one: "they have no website" is a complete
     * finding on its own, and the grid files it correctly — a lot wrong, no sign yet that they
     * spend money on their presence.
     */
    // Never for a site that loads. A listing that forgot to mention its website is an SEO
    // problem, not a missing website, and the test that caught this had the two confused.
    if (listingHasNoWebsite && params.presence !== "live" && !params.sharedDomainReason) {
      return {
        areas,
        problemScore: PRESENCE_OVERRIDE_PROBLEM_SCORE,
        intentScore,
        tier: toTier(PRESENCE_OVERRIDE_PROBLEM_SCORE, intentScore),
        route: "web_development",
        routeReason: NO_SITE_REASON,
        passedGate: true,
        needsManualReview: true,
        manualReviewReasons: [...manualReviewReasons, "unclear_website_status"],
      };
    }

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
  // The fourth case is a listing Google says has no website — see `listingHasNoWebsite` above.
  const presenceOverride =
    params.presence === "no_website" ||
    params.presence === "dead" ||
    params.presence === "social_only" ||
    (params.presence === "unclear" && listingHasNoWebsite);
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
          : params.presence === "social_only"
            ? "Only a social page, no website of their own."
            : NO_SITE_REASON;
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

  /**
   * The same rescue, applied after the areas have had their say.
   *
   * Reaching here means something was measured — but when the only thing that could be measured is
   * their Google listing, "measured" can amount to "they have 4,858 reviews and a 4.7 rating", and
   * every one of those checks **passes**. REP then scores 0, the Problem score follows it down, and
   * the strongest lead on the list is filed at Priority 4 with nothing to say about it.
   *
   * So demand wins here too. The Problem score takes whichever is higher — the measured one or the
   * override — so this can only ever raise a business, never quieten one the checks found fault
   * with. The route is Web development for the reason it always is: there is no website to work
   * with, and nothing else can be sold until there is one.
   */
  if (demand) {
    return {
      areas,
      problemScore: Math.max(problemScore, PRESENCE_OVERRIDE_PROBLEM_SCORE),
      intentScore,
      // Tier 1 outright rather than through §6.4's grid — see the note in the branch above for why
      // the grid cannot answer this question.
      tier: 1,
      route: "web_development",
      routeReason: demandRouteReason(demand),
      passedGate: true,
      // Still flagged: the website status is genuinely unconfirmed, and the operator should see
      // that before the call rather than discover it during one.
      needsManualReview: true,
      manualReviewReasons,
    };
  }

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
