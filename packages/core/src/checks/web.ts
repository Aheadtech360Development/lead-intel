import { pageContentBlindSpot } from "./coverage.js";
import { runPerformanceChecks } from "./performance.js";
import type { PageFacts } from "./parse.js";
import { fired, notApplicable, notMeasured, passed } from "./result.js";
import { PLATFORM_SIGNATURES } from "./signatures.js";
import type { CheckResult, SiteEvidence } from "./types.js";

/**
 * §5.1 — the WEB area, all twelve checks.
 *
 * W1–W3 restate the §4 presence verdict, W4 reads the connection, and W6/W7 come from PageSpeed,
 * so all of those stay valid whatever the page turned out to contain. Everything else here reads
 * the page, and is therefore gated on having actually received one — see coverage.ts.
 */
export function runWebChecks(evidence: SiteEvidence, pages: PageFacts[]): CheckResult[] {
  const home = pages[0] ?? null;
  const blindSpot = pageContentBlindSpot(pages);

  const pageDerived: CheckResult[] =
    blindSpot !== null || home === null
      ? ["W5", "W8", "W9", "W10", "W11", "W12"].map((id) => notMeasured(id, blindSpot ?? "The site could not be read."))
      : [
          mobileFriendly(home),
          datedPlatform(home),
          abandonedLook(home, evidence.now),
          pageCount(evidence),
          favicon(evidence, home),
          altText(home),
        ];

  return [
    ...presenceChecks(evidence),
    httpsCheck(evidence),
    ...pageDerived,
    ...runPerformanceChecks(evidence.performance ?? null),
  ];
}

/**
 * W1, W2 and W3 are not measurements of their own — they restate the §4 presence verdict as
 * scored findings. They are read from `presence` rather than recomputed so there is exactly one
 * place in the system that decides what a business's web presence is.
 *
 * `unclear` produces *not measured* for all three, which is the point: classifyPresence returns
 * `unclear` precisely when it could not settle the question, and W1 at 100 points is the single
 * heaviest finding in the model — the one an operator acts on by phoning a business and offering
 * to build them a website. Guessing it from an unread site is the most expensive mistake
 * available here.
 */
function presenceChecks(evidence: SiteEvidence): CheckResult[] {
  switch (evidence.presence) {
    case "no_website":
      return [
        fired("W1", "This business has no website at all."),
        notApplicable("W2", "There is no website to be dead or parked."),
        notApplicable("W3", "There is no website; social presence is judged separately."),
      ];
    case "dead":
      return [
        passed("W1", "There is a website address, so this is not a 'no website' case."),
        fired("W2", "The website is dead or parked."),
        passed("W3", "There is a website address rather than a social page only."),
      ];
    case "social_only":
      return [
        passed("W1", "A social page exists, so this is not a 'no website' case."),
        passed("W2", "There is no website to be dead or parked."),
        fired("W3", "The business has a social page but no website of its own."),
      ];
    case "live":
      return [
        passed("W1", "The business has a working website."),
        passed("W2", "The website loads."),
        passed("W3", "The business has a website of its own, not just a social page."),
      ];
    case "unclear":
    default:
      return [
        notMeasured("W1", "Whether this business has a website is still unconfirmed — see the presence reason."),
        notMeasured("W2", "The site could not be read, so whether it is dead is unknown."),
        notMeasured("W3", "Whether the business has only a social page is unconfirmed."),
      ];
  }
}

function httpsCheck(evidence: SiteEvidence): CheckResult {
  if (evidence.httpsOk === true) return passed("W4", "The site is served over HTTPS with a valid certificate.");
  if (evidence.httpsOk === false) {
    return fired("W4", "The site answers over plain HTTP but not over HTTPS — visitors get a browser security warning.");
  }
  return notMeasured("W4", "The site did not answer on either HTTPS or HTTP, so its certificate could not be checked.");
}

/**
 * W5. The viewport meta tag is the decisive signal: a page without one is rendered by every
 * mobile browser at desktop width regardless of how good its CSS is, so its absence is the
 * problem itself rather than a proxy for one. Responsive CSS is checked too — but only what is
 * visible in the HTML, because reading external stylesheets would mean more requests against the
 * §13 budget for a check the viewport tag has already all but decided.
 */
function mobileFriendly(home: PageFacts): CheckResult {
  if (home.hasViewportMeta) {
    return passed("W5", "The page declares a mobile viewport, so it adapts to phone screens.");
  }
  if (home.hasResponsiveCss) {
    return passed("W5", "No viewport tag, but the page carries responsive CSS rules.", { note: "viewport tag absent" });
  }
  return fired("W5", "The page has no mobile viewport tag and no responsive styling — on a phone it renders at desktop width.");
}

function datedPlatform(home: PageFacts): CheckResult {
  const haystack = home.haystack;
  const generator = home.metaGenerator ?? "";
  const detected = PLATFORM_SIGNATURES.filter(
    (platform) =>
      platform.patterns.some((p) => p.test(haystack)) ||
      (generator.length > 0 && platform.generator?.test(generator) === true),
  );
  const dated = detected.find((platform) => platform.dated);

  if (dated) {
    return fired("W8", `The site is built on ${dated.name} — ${dated.why}.`, {
      detail: { platform: dated.name, allDetected: detected.map((d) => d.name) },
    });
  }
  if (detected.length > 0) {
    return passed("W8", `The site is built on ${detected[0]?.name}, which is current.`, {
      allDetected: detected.map((d) => d.name),
    });
  }
  // No builder fingerprint at all usually means a hand-built or custom site. That is not evidence
  // of a dated platform, and W9 covers abandonment separately.
  return passed("W8", "No dated site-builder platform was detected.");
}

/**
 * W9. "Copyright year two or more years old" — so in 2026, a footer reading © 2024 fires and
 * © 2025 does not. A site with no copyright year at all is *not measured* rather than passed:
 * plenty of perfectly maintained sites simply do not print one, and treating a missing year as a
 * current one would be inventing a date.
 */
function abandonedLook(home: PageFacts, now: Date): CheckResult {
  const years = home.copyrightYears;
  if (years.length === 0) {
    return notMeasured("W9", "The site shows no copyright year, so its age could not be judged from one.");
  }
  const latest = Math.max(...years);
  const currentYear = now.getUTCFullYear();
  const age = currentYear - latest;
  if (age >= 2) {
    return fired("W9", `The copyright notice still reads ${latest} — ${age} years out of date, which usually means nobody has touched the site since.`, {
      detail: { latestCopyrightYear: latest, currentYear },
    });
  }
  return passed("W9", `The copyright notice reads ${latest}, which is current.`, { latestCopyrightYear: latest });
}

/**
 * W10. Counted from the homepage's own navigation rather than by crawling every page, which
 * would cost ten requests to answer an eight-point question. A site that links to fewer than
 * three other pages from its homepage is the "one-pager" this check is about.
 */
function pageCount(evidence: SiteEvidence): CheckResult {
  if (evidence.internalLinks === null) {
    return notMeasured("W10", "The homepage could not be read, so its pages could not be counted.");
  }
  const total = evidence.internalLinks.length + 1; // the homepage itself
  if (total < 4) {
    return fired("W10", `The site has ${total} page${total === 1 ? "" : "s"} — barely a website, which leaves nothing for a customer to read or for Google to rank.`, {
      detail: { pageCount: total, links: evidence.internalLinks.slice(0, 20) },
    });
  }
  return passed("W10", `The site has at least ${total} pages.`, { pageCount: total });
}

/**
 * W11. Two independent signals, because either alone gives a wrong answer on real sites: a
 * declared `<link rel="icon">` settles it, and where there is none, a great many sites still
 * serve `/favicon.ico` by convention with no tag at all. Only when both say no does this fire.
 */
function favicon(evidence: SiteEvidence, home: PageFacts): CheckResult {
  if (home.hasIconLink) return passed("W11", "The site declares a favicon.");
  if (evidence.faviconFound === true) return passed("W11", "The site serves a favicon at /favicon.ico.");
  if (evidence.faviconFound === false) {
    return fired("W11", "The site has no favicon — browser tabs and bookmarks show a blank page icon.");
  }
  return notMeasured("W11", "Whether the site has a favicon could not be established.");
}

/**
 * W12. Needs enough images to make "more than half" meaningful; on a page with two pictures the
 * ratio is noise, so it is reported as not applicable rather than as a finding either way.
 */
function altText(home: PageFacts): CheckResult {
  const { total, withAlt } = home.images;
  if (total < 5) {
    return notApplicable("W12", `The page has ${total} image${total === 1 ? "" : "s"} — too few to judge alt text coverage.`, {
      images: total,
    });
  }
  const missing = total - withAlt;
  if (missing > total / 2) {
    return fired("W12", `${missing} of ${total} images have no alt text, which hurts both accessibility and image search.`, {
      detail: { images: total, missingAlt: missing },
    });
  }
  return passed("W12", `${withAlt} of ${total} images have alt text.`, { images: total, missingAlt: missing });
}
