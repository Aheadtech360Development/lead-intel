import { getGooglePlacesApiKey } from "../config.js";
import {
  PageSpeedResponse,
  type PageSpeedOutcome,
  type PageSpeedResult,
} from "./types.js";

const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/**
 * Lighthouse genuinely takes this long. A real analysis of a slow small-business site on a
 * throttled mobile profile regularly runs past 60 seconds, and cutting it short would turn slow
 * sites — the ones W6 exists to find — into unmeasured ones.
 */
export const PAGESPEED_TIMEOUT_MS = 120_000;

export interface RunPageSpeedParams {
  /** The URL to analyse. Lighthouse follows redirects itself; pass the homepage. */
  url: string;
  strategy?: "mobile" | "desktop";
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Runs Google PageSpeed Insights against one URL and returns the two metrics §5.1's W6 and W7 are
 * written against.
 *
 * **Mobile by default, and that is not a preference.** §5.1's check is literally "Slow on mobile",
 * and for a local business the phone is where the customer is. A desktop score would be a
 * different, easier, and irrelevant number.
 *
 * The API is free and its quota is generous (tens of thousands of runs a day on a keyed project),
 * so unlike Places there is no per-call cost to weigh. What there *is* is a hard daily ceiling,
 * which is why `quota_exhausted` is kept apart from `rate_limited`: one means stop, the other
 * means wait.
 */
export async function runPageSpeed(params: RunPageSpeedParams): Promise<PageSpeedResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const strategy = params.strategy ?? "mobile";
  const startedAt = Date.now();

  const fail = (outcome: Exclude<PageSpeedOutcome, "ok">, extra: Partial<PageSpeedResult> = {}): PageSpeedResult =>
    ({
      outcome,
      status: null,
      providerMessage: null,
      detail: null,
      elapsedMs: Date.now() - startedAt,
      ...extra,
    }) as PageSpeedResult;

  let apiKey: string;
  try {
    apiKey = params.apiKey ?? getGooglePlacesApiKey();
  } catch (err) {
    return fail("auth_failed", { detail: err instanceof Error ? err.message : String(err) });
  }

  const endpoint = new URL(ENDPOINT);
  endpoint.searchParams.set("url", params.url);
  endpoint.searchParams.set("strategy", strategy);
  endpoint.searchParams.set("category", "performance");
  endpoint.searchParams.set("key", apiKey);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? PAGESPEED_TIMEOUT_MS);

  try {
    const response = await fetchImpl(endpoint.toString(), { method: "GET", signal: controller.signal });
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const error = (body as { error?: { message?: string; status?: string } } | null)?.error;
      return fail(classifyHttpError(response.status, error?.status, error?.message), {
        status: response.status,
        providerMessage: error?.message ?? null,
        detail: error?.status ?? null,
      });
    }

    const parsed = PageSpeedResponse.safeParse(body);
    if (!parsed.success) {
      return fail("invalid_response", { status: response.status, detail: parsed.error.message.slice(0, 300) });
    }

    const lighthouse = parsed.data.lighthouseResult;

    // Lighthouse answers 200 with a runtimeError when it could not load the page at all. That is
    // a real fact about the site, but it is emphatically not a score of zero — treating it as one
    // would put a 25-point W7 finding on a site Lighthouse simply never reached.
    if (lighthouse?.runtimeError?.code) {
      return fail("unreachable_url", {
        status: response.status,
        providerMessage: lighthouse.runtimeError.message ?? null,
        detail: lighthouse.runtimeError.code,
      });
    }

    const rawScore = lighthouse?.categories?.performance?.score;
    if (typeof rawScore !== "number") {
      // A well-formed report that scored nothing. Two real sites in the live run came back exactly
      // like this: HTTP 200, no runtimeError, `score: null`, no audits. Lighthouse ran and could
      // not measure the page — which is a fact about the page, not a parsing failure, and W6/W7
      // report it as unmeasured with that reason rather than as a bad score.
      return fail("no_score", {
        status: response.status,
        detail: "Lighthouse ran but produced no performance score for this page — usually a page that never finished rendering.",
      });
    }

    const audits = lighthouse?.audits;
    return {
      outcome: "ok",
      strategy,
      finalUrl: lighthouse?.finalUrl ?? lighthouse?.requestedUrl ?? params.url,
      // Lighthouse reports 0-1; §5.1's bands are written in the 0-100 the tool itself displays.
      performanceScore: Math.round(rawScore * 100),
      lcpMs: numeric(audits?.["largest-contentful-paint"]?.numericValue),
      fcpMs: numeric(audits?.["first-contentful-paint"]?.numericValue),
      speedIndexMs: numeric(audits?.["speed-index"]?.numericValue),
      interactiveMs: numeric(audits?.interactive?.numericValue),
      totalBlockingTimeMs: numeric(audits?.["total-blocking-time"]?.numericValue),
      cumulativeLayoutShift: numeric(audits?.["cumulative-layout-shift"]?.numericValue),
      fieldCategory: parsed.data.loadingExperience?.overall_category ?? null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return fail("timeout", { detail: `no response within ${params.timeoutMs ?? PAGESPEED_TIMEOUT_MS}ms` });
    }
    return fail("failed", { detail: err instanceof Error ? err.message : String(err) });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "Not enabled" is separated from every other 403 on purpose. It is the difference between a
 * setup step nobody has clicked yet and a key that has been revoked, and the live Phase 3 session
 * lost time to exactly that distinction being invisible on the Geocoding API.
 */
function classifyHttpError(
  httpStatus: number,
  errorStatus: string | undefined,
  message: string | undefined,
): Exclude<PageSpeedOutcome, "ok"> {
  const text = message ?? "";
  if (/has not been used in project|is disabled/i.test(text)) return "not_enabled";
  if (httpStatus === 429 || errorStatus === "RESOURCE_EXHAUSTED") return "quota_exhausted";
  if (httpStatus === 403) return errorStatus === "PERMISSION_DENIED" ? "auth_failed" : "auth_failed";
  if (httpStatus === 401) return "auth_failed";
  // Lighthouse reports a page it could not fetch as a 400 with a FAILED_DOCUMENT_REQUEST-style
  // message rather than a server error.
  if (httpStatus === 400 && /unable to process|failed_document_request|invalid url|did not load/i.test(text)) {
    return "unreachable_url";
  }
  if (httpStatus >= 500) return "rate_limited"; // transient on Google's side; retrying is right
  return "failed";
}

function numeric(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}
