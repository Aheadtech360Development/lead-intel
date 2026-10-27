import { notMeasured, fired, passed } from "./result.js";
import type { CheckResult } from "./types.js";

/**
 * The checks that only a **paid** social lookup can answer: D5, N2, O5 and N5.
 *
 * This module exists because of a fault that cost real money without anyone seeing it. The Meta
 * Ad Library lookup (Apify, about 11.6¢ a business — the most expensive thing this product buys)
 * stored `meta_ads_running` in `field_metadata`, re-scored the business, and the score never
 * moved. It could not move: scoring reads `findings`, and nothing was writing a finding from that
 * purchase. The operator's report was exactly right — "check kerte hain to score change q nhi
 * hota" — and the answer was that two of the six ADS checks and one of the ten intent checks had
 * no producer at all.
 *
 * So the rule this module enforces is: **anything bought must land as a finding, or say in words
 * why it cannot.** A purchase that changes nothing and explains nothing is indistinguishable from
 * a purchase that failed.
 */

export interface MetaAdsEvidence {
  /** False when no Facebook page could be found for this business at all. */
  pageFound: boolean;
  /** True when at least one ad is live now. Null when the lookup failed or was never made. */
  runningAds: boolean | null;
  /** How many ads are live, when known. Shown as evidence, never scored on its own. */
  activeCount?: number | null;
  /** When the oldest still-running ad began — how long they have been at it. */
  runningSince?: string | null;
  /** Why there is no answer, in the operator's words. Used only when `runningAds` is null. */
  unavailableReason?: string | null;
}

/**
 * D5 ("Not currently advertising") and N2 ("Currently running Meta ads") from one Ad Library
 * lookup.
 *
 * They are two readings of the same fact and they always disagree, which is correct rather than
 * redundant: D5 is a **problem** — a business not advertising has a gap this agency sells into —
 * and N2 is **intent** — a business already paying Meta is a business that pays for marketing.
 * §6.3 keeps the two sums apart, so one lookup legitimately moves both numbers in opposite
 * directions, and a business running ads goes up on Intent while losing D5's problem points.
 *
 * No ads found is a real answer, not a failure: the Ad Library is complete for live ads, so
 * "nothing is running" is something we know rather than something we could not see. A page that
 * does not exist is different, and says so.
 */
export function runMetaAdsChecks(evidence: MetaAdsEvidence | null): CheckResult[] {
  if (!evidence) {
    const reason = "Their Meta ads have not been looked up yet — this is a paid lookup, bought one business at a time.";
    return [notMeasured("D5", reason), notMeasured("N2", reason)];
  }

  if (!evidence.pageFound) {
    const reason =
      "No Facebook page was found for this business, so there is no Ad Library entry to read. That is not the same as having no ads — it means there is nowhere to look.";
    return [notMeasured("D5", reason), notMeasured("N2", reason)];
  }

  if (evidence.runningAds === null) {
    // Always a whole sentence, even when the provider's own words are two. The operator reads this
    // line on its own, with no context around it.
    const reason = evidence.unavailableReason
      ? `The Meta Ad Library lookup did not come back with an answer: ${evidence.unavailableReason}`
      : "The Meta Ad Library lookup did not come back with an answer.";
    return [notMeasured("D5", reason), notMeasured("N2", reason)];
  }

  if (evidence.runningAds) {
    const count = evidence.activeCount ?? null;
    const how = count && count > 0 ? `${count} live ${count === 1 ? "ad" : "ads"}` : "live ads";
    const since = evidence.runningSince ? `, running since ${evidence.runningSince}` : "";
    return [
      passed("D5", `They are advertising on Meta right now — ${how}${since}.`),
      fired("N2", `Paying Meta for ads right now — ${how}${since}. They already buy marketing.`),
    ];
  }

  return [
    fired("D5", "No live ads in the Meta Ad Library. They are not advertising on Facebook or Instagram today."),
    passed("N2", "No live ads in the Meta Ad Library, so there is no ad spend to count as intent."),
  ];
}

export interface InstagramEvidence {
  /** False when no Instagram account could be found or read. */
  profileFound: boolean;
  /**
   * When they last posted, if any source knows. The profile scrape this product buys does not
   * return it — see the note on `runInstagramChecks`.
   */
  lastPostAt?: Date | null;
  followers?: number | null;
  posts?: number | null;
  unavailableReason?: string | null;
}

/**
 * O5 ("Instagram has gone quiet") and N5 ("Posted on social in the last 30 days") after an
 * Instagram lookup.
 *
 * **Both are usually unanswerable, and that is the finding.** The actor this product buys
 * (`apify~instagram-profile-scraper`, 0.26¢ a business) returns the profile — followers, post
 * count, category, bio — and **no post dates**. "How recently did they post" needs the posts
 * themselves, which is a different and dearer actor.
 *
 * Writing that down as an unmeasured finding with the reason, rather than leaving the two checks
 * absent, is the whole point. Absent, the operator buys Instagram data, watches the score sit
 * still and has nothing to read. Present, the record says which question the purchase answered
 * and which it did not — and the day a source for post dates is connected, the coverage number
 * moves visibly instead of silently.
 */
export function runInstagramChecks(evidence: InstagramEvidence | null, now: Date = new Date()): CheckResult[] {
  if (!evidence) {
    const reason = "Their Instagram has not been looked up yet — this is a paid lookup, bought one business at a time.";
    return [notMeasured("O5", reason), notMeasured("N5", reason)];
  }

  if (!evidence.profileFound) {
    const reason = evidence.unavailableReason
      ? `No Instagram account could be read for this business: ${evidence.unavailableReason}`
      : "No Instagram account could be read for this business, so there is nothing to say about how recently they posted.";
    return [notMeasured("O5", reason), notMeasured("N5", reason)];
  }

  if (!evidence.lastPostAt) {
    const reason =
      "The Instagram lookup returns their follower and post counts but no post dates, so how recently they posted is unknown. Nothing here says they are quiet — only that nobody has looked.";
    return [notMeasured("O5", reason), notMeasured("N5", reason)];
  }

  const days = Math.floor((now.getTime() - evidence.lastPostAt.getTime()) / 86_400_000);
  const when = `Last Instagram post ${days} ${days === 1 ? "day" : "days"} ago.`;

  return [
    days > 90 ? fired("O5", `${when} Nothing for over three months.`) : passed("O5", when),
    days <= 30 ? fired("N5", `${when} They are still posting, so somebody is working on their presence.`) : passed("N5", when),
  ];
}
