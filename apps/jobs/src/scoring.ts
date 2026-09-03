import { scoreBusiness, sharedPlatformDomain, type BusinessScore, type CheckResult } from "@lead-intel/core";
import { businesses, describeDbError, findings, identityKeys, type Database } from "@lead-intel/db";
import type { ManualReviewReason, WebsiteStatus } from "@lead-intel/shared";
import { and, eq } from "drizzle-orm";

/**
 * Reads a business's stored findings back out of the database, scores them under §6, and writes
 * the result to the business record.
 *
 * Reading the findings back rather than scoring in memory straight after the audit is deliberate:
 * it makes rescoring possible without re-crawling anything. §6's weights, the coverage floor and
 * the gate cut-off are all expected to be tuned against real data (§10.3 calls the cut-off "the
 * lever"), and tuning them must not cost 209 crawls each time. It also means the scores are a
 * function of exactly what is stored — what an operator sees on the page is what was scored.
 */
export async function scoreAndStore(db: Database, businessId: string): Promise<BusinessScore> {
  const rows = await db
    .select({
      checkId: findings.checkId,
      family: findings.family,
      area: findings.area,
      costClass: findings.costClass,
      outcome: findings.outcome,
      points: findings.points,
      maxPoints: findings.maxPoints,
      evidence: findings.evidence,
    })
    .from(findings)
    .where(eq(findings.businessId, businessId));

  const [business] = await db
    .select({ websiteStatus: businesses.websiteStatus, manualReviewReasons: businesses.manualReviewReasons })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) throw new Error(`business ${businessId} not found`);

  const checkResults: CheckResult[] = rows.map((row) => ({
    checkId: row.checkId,
    family: row.family,
    area: row.area,
    costClass: row.costClass,
    outcome: row.outcome,
    points: row.points,
    maxPoints: row.maxPoints,
    evidence: row.evidence ?? "",
  }));

  // A booking-platform profile or a chain's store-locator page is not this business's website, so
  // every finding above describes the wrong site. The score is still computed — it accurately
  // describes what was crawled — but the record is flagged and held back from the gate.
  const [domainKey] = await db
    .select({ value: identityKeys.keyValue })
    .from(identityKeys)
    .where(and(eq(identityKeys.businessId, businessId), eq(identityKeys.keyType, "domain")))
    .limit(1);
  const sharedDomain = sharedPlatformDomain(domainKey?.value ?? null);

  const score = scoreBusiness({
    findings: checkResults,
    presence: business.websiteStatus as WebsiteStatus,
    sharedDomainReason: sharedDomain?.reason ?? null,
  });

  // The audit may already have flagged this record for a reason scoring knows nothing about
  // (an unreadable site, a shared phone). Merging rather than replacing keeps both.
  const merged = [...new Set([...(business.manualReviewReasons ?? []), ...score.manualReviewReasons])] as ManualReviewReason[];

  try {
    await db
      .update(businesses)
      .set({
        problemScore: score.problemScore,
        intentScore: score.intentScore,
        tier: score.tier,
        route: score.route,
        routeReason: score.routeReason,
        areaScores: score.areas,
        passedGate: score.passedGate,
        scoredAt: new Date(),
        manualReviewStatus: merged.length > 0,
        manualReviewReasons: merged,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, businessId));
  } catch (err) {
    throw new Error(`failed to store score for ${businessId}: ${describeDbError(err)}`);
  }

  return score;
}
