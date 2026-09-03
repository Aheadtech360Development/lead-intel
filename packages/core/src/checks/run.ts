import { runAdsChecks, runReputationChecks, summariseTracking } from "./ads.js";
import { runContactChecks } from "./contact.js";
import { runIntentChecks } from "./intent.js";
import { parsePage, type PageFacts } from "./parse.js";
import { runSeoChecks } from "./seo.js";
import { detect, REVIEW_WIDGET_SIGNATURES } from "./signatures.js";
import { runSocialChecks } from "./social.js";
import type { CheckResult, SiteEvidence } from "./types.js";
import { runWebChecks } from "./web.js";

/**
 * Runs every FREE check that can be answered from a crawl, and returns one result per check.
 *
 * Pure and deterministic — no network, no clock of its own (`evidence.now` is injected), the same
 * bar as `normalize/`, `discovery/` and `presence/`. Everything that touches the outside world
 * happened before this was called.
 *
 * The output is deliberately **complete rather than interesting**: a result is returned for every
 * check that ran, including all the ones that found nothing wrong, and for every check that could
 * not run. §6.1 divides fired points by the points available from checks that *actually ran*, so
 * the passes are what make the denominator real and the unmeasured ones are what keep them out of
 * it. A function that returned only the problems would leave scoring with nothing to divide by.
 *
 * W6 and W7 come from `evidence.performance` when PageSpeed has run, and report themselves
 * unmeasured when it has not — they are the one pair here that does not read the crawled HTML.
 *
 * Not produced here, because they need something a crawl cannot provide:
 *   - S1–S8       — Places Details and rank lookups (PAID)
 *   - R1–R5       — Places reviews (PAID)
 *   - O3, O5, O7, O8 — reading the social platforms themselves (BEST EFFORT)
 *   - D5, N2–N5, N7, N8 — the same PAID and BEST EFFORT sources
 */
export function runFreeChecks(evidence: SiteEvidence): CheckResult[] {
  const pages: PageFacts[] = evidence.pages.map(parsePage);
  const tracking = summariseTracking(pages);
  const reviewWidgets = pages.flatMap((page) => detect(page.haystack, REVIEW_WIDGET_SIGNATURES));

  const results = [
    ...runWebChecks(evidence, pages),
    ...runContactChecks(evidence, pages),
    ...runSeoChecks(evidence, pages),
    ...runReputationChecks(evidence, pages, [...new Set(reviewWidgets)]),
    ...runSocialChecks(evidence, pages),
    ...runAdsChecks(evidence, pages, tracking),
    ...runIntentChecks(evidence, pages, tracking),
  ];

  assertNoDuplicates(results);
  return results;
}

/**
 * Two results for the same check would mean one silently overwrites the other on its way into
 * `findings` (whose unique index is on business + check), and which one survived would depend on
 * insert order. Better to fail loudly here, in a unit test, than to score a business on whichever
 * copy happened to land last.
 */
function assertNoDuplicates(results: CheckResult[]): void {
  const seen = new Set<string>();
  for (const result of results) {
    if (seen.has(result.checkId)) {
      throw new Error(`runFreeChecks produced ${result.checkId} twice — each check must yield exactly one result`);
    }
    seen.add(result.checkId);
  }
}
