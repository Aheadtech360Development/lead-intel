import { fired, notMeasured, passed } from "./result.js";
import type { CheckResult, PerformanceEvidence } from "./types.js";

/**
 * W6 and W7 — the two checks PageSpeed answers.
 *
 * Deliberately outside the page-content blind spot that gates everything else here. PageSpeed
 * runs a real browser, so it measures a single-page app exactly as a visitor experiences it. A
 * site our own crawler could only see as an empty shell can still have a perfectly measurable,
 * and perfectly terrible, load time — and for W6 that is precisely the site most worth measuring.
 */
export function runPerformanceChecks(performance: PerformanceEvidence | null): CheckResult[] {
  if (!performance) {
    const reason = "PageSpeed has not been run for this business yet.";
    return [notMeasured("W6", reason), notMeasured("W7", reason)];
  }

  const unavailable = performance.unavailableReason;
  return [
    // §5.1 W6: "Load time >4s -> 30; 2.5-4s -> 15". Those are not arbitrary numbers — they are
    // Google's own Largest Contentful Paint boundaries between good, needs-improvement and poor,
    // which is why LCP rather than any other timing is what this reads.
    performance.lcpMs === null
      ? notMeasured("W6", unavailable ?? "PageSpeed returned no load-time measurement for this page.")
      : performance.lcpMs > 4000
        ? fired("W6", `The main content takes ${seconds(performance.lcpMs)} to appear on a phone — well past the 4-second mark where visitors start leaving.`, {
            points: 30,
            detail: { lcpMs: performance.lcpMs },
          })
        : performance.lcpMs >= 2500
          ? fired("W6", `The main content takes ${seconds(performance.lcpMs)} to appear on a phone, above the 2.5-second mark Google treats as good.`, {
              points: 15,
              detail: { lcpMs: performance.lcpMs },
            })
          : passed("W6", `The main content appears in ${seconds(performance.lcpMs)} on a phone.`, { lcpMs: performance.lcpMs }),

    // §5.1 W7: "Under 50 -> 25; 50-89 -> 10". Lighthouse's own bands.
    performance.performanceScore === null
      ? notMeasured("W7", unavailable ?? "PageSpeed returned no performance score for this page.")
      : performance.performanceScore < 50
        ? fired("W7", `The site scores ${performance.performanceScore} out of 100 for mobile performance — in Google's "poor" band.`, {
            points: 25,
            detail: { performanceScore: performance.performanceScore },
          })
        : performance.performanceScore < 90
          ? fired("W7", `The site scores ${performance.performanceScore} out of 100 for mobile performance, short of the 90 Google treats as good.`, {
              points: 10,
              detail: { performanceScore: performance.performanceScore },
            })
          : passed("W7", `The site scores ${performance.performanceScore} out of 100 for mobile performance.`, {
              performanceScore: performance.performanceScore,
            }),
  ];
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} seconds`;
}
