import type { TrackingSummary } from "./ads.js";
import { pageContentBlindSpot } from "./coverage.js";
import type { PageFacts } from "./parse.js";
import { fired, notMeasured, passed } from "./result.js";
import { BOOKING_WIDGET_SIGNATURES, CHAT_WIDGET_SIGNATURES, CRM_WIDGET_SIGNATURES, detect } from "./signatures.js";
import type { CheckResult, SiteEvidence } from "./types.js";

/**
 * §6.3 — the FREE Intent signals: N1, N6, N9, N10.
 *
 * Intent is scored differently from every other family and the difference matters here. These are
 * **credits**: "a missing signal adds nothing and never subtracts". So `fired` means the credit
 * was earned, `passed` means we looked and there was nothing to credit, and neither one can hurt
 * the business — the Intent score is a capped sum of what fired, not a ratio. The `maxPoints`
 * bookkeeping is kept anyway so a future coverage report can say how much of Intent was actually
 * measurable for a given business.
 */
export function runIntentChecks(evidence: SiteEvidence, pages: PageFacts[], tracking: TrackingSummary): CheckResult[] {
  // Every one of these reads the page's own markup, so a stub or an app shell has none of them.
  // A missing credit costs the business nothing, but recording it as *measured* would tell a
  // future coverage report that we looked when we did not.
  const blindSpot = pageContentBlindSpot(pages);
  if (blindSpot !== null) {
    return ["N1", "N6", "N9", "N10"].map((id) => notMeasured(id, blindSpot));
  }

  return [
    trackingInstalled(tracking),
    recentlyUpdated(evidence, pages),
    hiring(pages),
    paysForATool(pages),
  ];
}

function trackingInstalled(tracking: TrackingSummary): CheckResult {
  if (tracking.all.length > 0) {
    return fired("N1", `Tracking is installed (${tracking.all.join(", ")}) — this business measures something, which means it has spent money on marketing before.`, {
      detail: { found: tracking.all },
    });
  }
  return passed("N1", "No tracking of any kind is installed.");
}

/**
 * N6. Two signals, either of which is enough: a machine-readable modification date within twelve
 * months, or a copyright year that is the current one. Neither existing is reported as *not
 * measured* rather than as a no — the site may well be maintained without ever saying so, and
 * Intent credits are supposed to be evidence of life, not punishment for its absence.
 */
function recentlyUpdated(evidence: SiteEvidence, pages: PageFacts[]): CheckResult {
  const cutoff = new Date(evidence.now.getTime());
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);

  const dates = pages
    .flatMap((page) => page.modifiedDates)
    .map((raw) => new Date(raw))
    .filter((date) => !Number.isNaN(date.getTime()) && date.getTime() <= evidence.now.getTime() + 86_400_000);

  const mostRecent = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  if (mostRecent && mostRecent >= cutoff) {
    return fired("N6", `The site was updated on ${mostRecent.toISOString().slice(0, 10)}, within the last year.`, {
      detail: { lastModified: mostRecent.toISOString() },
    });
  }

  const years = pages.flatMap((page) => page.copyrightYears);
  const latestYear = years.length > 0 ? Math.max(...years) : null;
  if (latestYear !== null && latestYear >= evidence.now.getUTCFullYear()) {
    return fired("N6", `The copyright notice reads ${latestYear}, so somebody is still maintaining the site.`, {
      detail: { latestCopyrightYear: latestYear },
    });
  }

  if (mostRecent === null && latestYear === null) {
    return notMeasured("N6", "The site carries no date of any kind, so when it was last updated is unknown.");
  }
  return passed("N6", "Nothing on the site suggests it has been updated in the last year.", {
    ...(mostRecent ? { lastModified: mostRecent.toISOString() } : {}),
    ...(latestYear !== null ? { latestCopyrightYear: latestYear } : {}),
  });
}

/** N9. Hiring is spending: a business taking on staff is a business with money moving. */
function hiring(pages: PageFacts[]): CheckResult {
  const jobSchema = pages
    .flatMap((page) => page.schemaTypes)
    .some((type) => /jobposting/i.test(type));

  const careerLink = pages.some((page) =>
    page.linkHrefs.some((href) => /\/(careers?|jobs|join-?us|work-?with-?us|employment|hiring)\b/i.test(href)),
  );
  const careerText = pages.some((page) =>
    page.ctaTexts.some((text) => /\b(careers?|we'?re hiring|now hiring|join our team|open positions|job openings)\b/i.test(text)),
  );

  if (jobSchema || careerLink || careerText) {
    return fired("N9", "The site advertises jobs, which means the business is growing and spending.", {
      detail: { jobSchema, careerLink, careerText },
    });
  }
  return passed("N9", "No job or careers listing was found on the site.");
}

/**
 * N10. The point of this signal is not the widget — it is the monthly invoice behind it. Every
 * product matched here costs real money at any usable volume, so its presence says the business
 * already buys software, which is the single best predictor that it will buy a service too.
 */
function paysForATool(pages: PageFacts[]): CheckResult {
  const haystack = pages.map((page) => page.haystack).join("\n");
  const chat = detect(haystack, CHAT_WIDGET_SIGNATURES);
  const booking = detect(haystack, BOOKING_WIDGET_SIGNATURES);
  const crm = detect(haystack, CRM_WIDGET_SIGNATURES);
  const all = [...new Set([...chat, ...booking, ...crm])];

  if (all.length > 0) {
    return fired("N10", `The business pays for ${all.join(", ")} — it already buys software, which is the clearest sign it will buy a service.`, {
      detail: { chat, booking, crm },
    });
  }
  return passed("N10", "No paid booking, chat or CRM widget was found on the site.");
}
