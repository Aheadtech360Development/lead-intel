import { z } from "zod";

/**
 * How a PageSpeed run ended. The same discriminated-union discipline as the crawler, for the same
 * reason (spec §13): a run that could not be made must never be reachable as a run that produced
 * a good score. `score` does not exist on the type unless the run succeeded.
 */
export type PageSpeedOutcome =
  | "ok"
  /** The API is not enabled on the Cloud project. A setup problem, not a fact about the site. */
  | "not_enabled"
  /** Daily quota spent. A circuit-break signal: every subsequent call will fail the same way. */
  | "quota_exhausted"
  /** Short-term rate limit. Retryable, unlike the above. */
  | "rate_limited"
  | "auth_failed"
  /** Lighthouse could not load the page — this one IS about the site, but it is not a score. */
  | "unreachable_url"
  /**
   * Lighthouse ran, returned a perfectly well-formed report, and scored nothing: `score: null`
   * with no audits. Seen live on two real sites. Kept apart from `invalid_response` because that
   * name would blame our parser for what is a fact about the page, and an operator reading
   * "invalid response" would go looking for a bug that is not there.
   */
  | "no_score"
  | "timeout"
  /** A 200 whose body did not match the shape we expect. Never silently treated as a zero. */
  | "invalid_response"
  | "failed";

export interface PageSpeedSuccess {
  outcome: "ok";
  strategy: "mobile" | "desktop";
  finalUrl: string;
  /** Lighthouse performance score, 0-100. §5.1's W7 bands are Lighthouse's own. */
  performanceScore: number;
  /**
   * Largest Contentful Paint, in milliseconds. This is the metric §5.1's W6 is written against:
   * its thresholds — 2.5s and 4s — are Google's own LCP boundaries between "good", "needs
   * improvement" and "poor", not numbers chosen independently.
   */
  lcpMs: number | null;
  fcpMs: number | null;
  speedIndexMs: number | null;
  interactiveMs: number | null;
  totalBlockingTimeMs: number | null;
  cumulativeLayoutShift: number | null;
  /**
   * Real-user data from the Chrome UX Report, when Google has enough traffic for this origin to
   * report it. Almost never present for a small local business, which is exactly why the lab
   * metrics above are what the checks use.
   */
  fieldCategory: "FAST" | "AVERAGE" | "SLOW" | null;
  elapsedMs: number;
}

export interface PageSpeedFailure {
  outcome: Exclude<PageSpeedOutcome, "ok">;
  status: number | null;
  /**
   * Google's own `error.message`, verbatim. The Phase 3 lesson, kept: a category tells you the
   * kind of failure, the message tells you which one — and the second message Google sent about
   * the Geocoding API ("must enable Billing") was completely different from the first, and only
   * visible because the adapter preserved it.
   */
  providerMessage: string | null;
  detail: string | null;
  elapsedMs: number;
}

export type PageSpeedResult = PageSpeedSuccess | PageSpeedFailure;

export function isPageSpeedOk(result: PageSpeedResult): result is PageSpeedSuccess {
  return result.outcome === "ok";
}

/**
 * Only what the checks read. Lighthouse returns a document of several hundred kilobytes and
 * validating all of it would be a liability, not a safeguard — every field here is optional
 * because Lighthouse genuinely omits audits when it cannot run them, and a missing audit must
 * come through as null rather than as a parse failure that discards the score alongside it.
 */
const Audit = z.object({ numericValue: z.number().optional(), displayValue: z.string().optional() }).optional();

export const PageSpeedResponse = z.object({
  id: z.string().optional(),
  lighthouseResult: z
    .object({
      finalUrl: z.string().optional(),
      requestedUrl: z.string().optional(),
      categories: z
        .object({ performance: z.object({ score: z.number().nullable().optional() }).optional() })
        .optional(),
      audits: z
        .object({
          "largest-contentful-paint": Audit,
          "first-contentful-paint": Audit,
          "speed-index": Audit,
          interactive: Audit,
          "total-blocking-time": Audit,
          "cumulative-layout-shift": Audit,
        })
        .optional(),
      runtimeError: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
    })
    .optional(),
  loadingExperience: z
    .object({ overall_category: z.enum(["FAST", "AVERAGE", "SLOW"]).optional() })
    .optional(),
});
export type PageSpeedResponse = z.infer<typeof PageSpeedResponse>;
