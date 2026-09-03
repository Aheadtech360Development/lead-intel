import { describe, expect, it } from "vitest";
import { runPageSpeed } from "./run-pagespeed.js";
import { isPageSpeedOk } from "./types.js";

function respond(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

const GOOD_BODY = {
  lighthouseResult: {
    finalUrl: "https://example.com/",
    categories: { performance: { score: 0.42 } },
    audits: {
      "largest-contentful-paint": { numericValue: 5231.4, displayValue: "5.2 s" },
      "first-contentful-paint": { numericValue: 1800 },
      "speed-index": { numericValue: 4100 },
      interactive: { numericValue: 6200 },
      "total-blocking-time": { numericValue: 430 },
      "cumulative-layout-shift": { numericValue: 0.14 },
    },
  },
  loadingExperience: { overall_category: "SLOW" },
};

describe("runPageSpeed — a successful run", () => {
  it("returns the score on Lighthouse's own 0-100 scale, not its 0-1 one", async () => {
    const result = await runPageSpeed({ url: "https://example.com/", apiKey: "k", fetchImpl: respond(200, GOOD_BODY) });
    expect(isPageSpeedOk(result)).toBe(true);
    if (!isPageSpeedOk(result)) return;
    expect(result.performanceScore).toBe(42);
    expect(result.lcpMs).toBe(5231.4);
    expect(result.fieldCategory).toBe("SLOW");
    expect(result.strategy).toBe("mobile");
  });

  /** §5.1's check is literally "Slow on mobile", and for a local business the phone is where the
   *  customer is. A desktop score would be a different, easier, irrelevant number. */
  it("asks for mobile by default", async () => {
    let requested = "";
    const spy = (async (url: string) => {
      requested = url.toString();
      return { ok: true, status: 200, json: async () => GOOD_BODY } as unknown as Response;
    }) as unknown as typeof fetch;

    await runPageSpeed({ url: "https://example.com/", apiKey: "k", fetchImpl: spy });
    expect(requested).toContain("strategy=mobile");
    expect(requested).toContain("category=performance");
  });
});

describe("runPageSpeed — failures are never a score", () => {
  /**
   * The Phase 3 lesson, kept. Google's own `error.message` is preserved verbatim, because the
   * second message it sent about the Geocoding API ("must enable Billing") was completely
   * different from the first and only visible because the adapter did not discard it.
   */
  it("preserves Google's own message, not just a category", async () => {
    const result = await runPageSpeed({
      url: "https://example.com/",
      apiKey: "k",
      fetchImpl: respond(403, {
        error: {
          status: "PERMISSION_DENIED",
          message: "PageSpeed Insights API has not been used in project 918911905442 before or it is disabled.",
        },
      }),
    });
    expect(isPageSpeedOk(result)).toBe(false);
    if (isPageSpeedOk(result)) return;
    expect(result.outcome).toBe("not_enabled");
    expect(result.providerMessage).toContain("918911905442");
  });

  /** One means stop, the other means wait — build guide §16 halts the provider on only one. */
  it("keeps a spent daily quota apart from a short-term rate limit", async () => {
    const quota = await runPageSpeed({
      url: "https://example.com/",
      apiKey: "k",
      fetchImpl: respond(429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded" } }),
    });
    expect(quota.outcome).toBe("quota_exhausted");

    const transient = await runPageSpeed({
      url: "https://example.com/",
      apiKey: "k",
      fetchImpl: respond(500, { error: { message: "backend error" } }),
    });
    expect(transient.outcome).toBe("rate_limited");
  });

  /**
   * Lighthouse answers 200 with a runtimeError when it could not load the page. That is a real
   * fact about the site, but it is emphatically not a score of zero — treating it as one would
   * put a 25-point W7 finding on a site Lighthouse never reached.
   */
  it("does not read a page Lighthouse could not load as a score of zero", async () => {
    const result = await runPageSpeed({
      url: "https://example.com/",
      apiKey: "k",
      fetchImpl: respond(200, {
        lighthouseResult: {
          runtimeError: { code: "FAILED_DOCUMENT_REQUEST", message: "Lighthouse was unable to reliably load the page." },
          categories: { performance: { score: 0 } },
        },
      }),
    });
    expect(result.outcome).toBe("unreachable_url");
    expect(isPageSpeedOk(result)).toBe(false);
  });

  /**
   * Taken from two real sites in the live run: HTTP 200, no runtimeError, `score: null`, no
   * audits. Lighthouse ran and could not measure the page. Kept apart from `invalid_response`
   * because that name blames our parser for a fact about the page, and would send someone
   * looking for a bug that is not there.
   */
  it("reports a well-formed report that scored nothing as such, not as a broken response", async () => {
    const result = await runPageSpeed({
      url: "https://example.com/",
      apiKey: "k",
      fetchImpl: respond(200, { lighthouseResult: { categories: { performance: { score: null } } } }),
    });
    expect(result.outcome).toBe("no_score");
    expect(isPageSpeedOk(result)).toBe(false);
    if (isPageSpeedOk(result)) return;
    expect(result.detail).toMatch(/no performance score/i);
  });

  it("refuses a 200 that carries no performance category at all", async () => {
    const result = await runPageSpeed({
      url: "https://example.com/",
      apiKey: "k",
      fetchImpl: respond(200, { lighthouseResult: { categories: {} } }),
    });
    expect(result.outcome).toBe("no_score");
  });

  it("survives a body that is not the shape we expect", async () => {
    const result = await runPageSpeed({
      url: "https://example.com/",
      apiKey: "k",
      fetchImpl: respond(200, { lighthouseResult: { categories: { performance: { score: "fast" } } } }),
    });
    expect(isPageSpeedOk(result)).toBe(false);
  });

  it("reports a thrown network error rather than letting it escape", async () => {
    const boom = (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const result = await runPageSpeed({ url: "https://example.com/", apiKey: "k", fetchImpl: boom });
    expect(result.outcome).toBe("failed");
    expect(isPageSpeedOk(result)).toBe(false);
  });

  /** The §13 invariant restated for this provider: no failure path may look like success. */
  it("NO failure path ever yields a score", async () => {
    const failures: [number, unknown][] = [
      [400, { error: { message: "Unable to process request" } }],
      [401, { error: { status: "UNAUTHENTICATED" } }],
      [403, { error: { status: "PERMISSION_DENIED", message: "denied" } }],
      [429, { error: { status: "RESOURCE_EXHAUSTED" } }],
      [500, {}],
      [503, {}],
    ];
    for (const [status, body] of failures) {
      const result = await runPageSpeed({ url: "https://example.com/", apiKey: "k", fetchImpl: respond(status, body) });
      expect(isPageSpeedOk(result), `HTTP ${status}`).toBe(false);
      expect(result).not.toHaveProperty("performanceScore");
    }
  });
});
