import { absenceBlindSpot, pageContentBlindSpot } from "./coverage.js";
import type { PageFacts } from "./parse.js";
import { fired, notApplicable, notMeasured, passed } from "./result.js";
import {
  ANALYTICS_SIGNATURES,
  detect,
  GOOGLE_ADS_SIGNATURES,
  META_PIXEL_SIGNATURES,
  RETARGETING_SIGNATURES,
} from "./signatures.js";
import type { CheckResult, SiteEvidence } from "./types.js";

/**
 * §5.6 — the FREE half of the ADS area. D5 needs the Meta Ad Library and is not produced here.
 *
 * §5.6's own framing: "The most reliable advertising signal is not the ad library. It is the
 * tracking code sitting in the business's own website, which we read for free." A business with
 * no pixel at all has never run digital advertising — a large opportunity and, equally, a warning
 * that they have no budget history, which is exactly why Problem and Intent are scored apart.
 */
export interface TrackingSummary {
  analytics: string[];
  metaPixel: string[];
  googleAds: string[];
  retargeting: string[];
  /** Everything found, deduplicated — what N1 reads. */
  all: string[];
}

export function summariseTracking(pages: PageFacts[]): TrackingSummary {
  const haystack = pages.map((page) => page.haystack).join("\n");
  const analytics = detect(haystack, ANALYTICS_SIGNATURES);
  const metaPixel = detect(haystack, META_PIXEL_SIGNATURES);
  const googleAds = detect(haystack, GOOGLE_ADS_SIGNATURES);
  const retargeting = detect(haystack, RETARGETING_SIGNATURES);
  return {
    analytics,
    metaPixel,
    googleAds,
    retargeting,
    all: [...new Set([...analytics, ...metaPixel, ...googleAds, ...retargeting])],
  };
}

export function runAdsChecks(_evidence: SiteEvidence, pages: PageFacts[], tracking: TrackingSummary): CheckResult[] {
  // Tracking tags live in the page's own markup, so a redirect stub or an app shell has none of
  // them — and reporting "this business has never run digital advertising" at 35 points because
  // we were handed 114 bytes of JavaScript would be the most confident wrong claim in the model.
  const blindSpot = pageContentBlindSpot(pages);
  if (blindSpot !== null) {
    return ["D1", "D2", "D3", "D4", "D6"].map((id) => notMeasured(id, blindSpot));
  }

  const detail = { found: tracking.all };

  return [
    tracking.all.length === 0
      ? fired("D1", "The site carries no analytics, no pixel and no tag of any kind — this business has never run digital advertising.", { detail })
      : passed("D1", `The site carries tracking: ${tracking.all.join(", ")}.`, detail),

    tracking.metaPixel.length > 0
      ? passed("D2", "The Meta Pixel is installed.")
      : fired("D2", "There is no Meta Pixel, so Facebook and Instagram ads cannot be targeted or measured."),

    tracking.googleAds.length > 0
      ? passed("D3", "A Google Ads tag is installed.")
      : fired("D3", "There is no Google Ads tag, so Google ad spend cannot be tied to anything that happens on the site."),

    tracking.analytics.length > 0
      ? passed("D4", `Analytics is installed (${tracking.analytics.join(", ")}).`, { analytics: tracking.analytics })
      : fired("D4", "The site has no analytics — nobody can see how many people visit it or what they do."),

    // §5.6 words D6 as "Pixel present but no retargeting setup detected". With no pixel at all
    // there is nothing for it to be about; D1 has already scored that, and firing both would
    // charge the same absence twice.
    tracking.all.length === 0
      ? notApplicable("D6", "There is no tracking at all, so retargeting is not a separate finding — see D1.")
      : tracking.retargeting.length > 0
        ? passed("D6", `Retargeting is set up (${tracking.retargeting.join(", ")}).`, { retargeting: tracking.retargeting })
        : fired("D6", "Tracking is installed but nothing retargets visitors, so the audience it collects is never used."),
  ];
}

/** §5.4's one FREE check: R6, whether the business shows any reviews on its own site. */
export function runReputationChecks(evidence: SiteEvidence, pages: PageFacts[], reviewWidgets: string[]): CheckResult[] {
  if (pages.length === 0) {
    return [notMeasured("R6", "The site could not be read, so whether it shows reviews is unknown.")];
  }

  const schemaReviews = pages
    .flatMap((page) => page.schemaTypes)
    .map((type) => type.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase())
    .filter((type) => type === "review" || type === "aggregaterating");

  const textual = pages.some((page) =>
    /\b(testimonial|what our (customers|clients) say|customer reviews|client reviews|read our reviews|5[- ]star review)\b/i.test(page.text),
  );

  if (reviewWidgets.length > 0 || schemaReviews.length > 0 || textual) {
    const how = reviewWidgets.length > 0 ? reviewWidgets.join(", ") : schemaReviews.length > 0 ? "review markup" : "a testimonials section";
    return [passed("R6", `The site shows reviews (${how}).`, { reviewWidgets, schemaReviews })];
  }

  // R6 reads the page as prose, so it is subject to the same coverage rule: a site that served
  // no readable text did not tell us it has no testimonials.
  const coverageNote = absenceBlindSpot(evidence, pages);
  if (coverageNote) return [notMeasured("R6", coverageNote)];

  return [
    fired("R6", "The site shows no reviews or testimonials anywhere — the social proof this business has earned on Google is doing nothing for its website."),
  ];
}
