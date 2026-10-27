import {
  nameMatchesChain,
  scoreBusiness,
  sharedPlatformDomain,
  type BusinessScore,
  type CheckResult,
} from "@lead-intel/core";
import { businesses, describeDbError, fieldMetadata, findings, identityKeys, type Database } from "@lead-intel/db";
import type { ManualReviewReason, WebsiteStatus } from "@lead-intel/shared";
import { and, eq, inArray } from "drizzle-orm";

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
    .select({
      displayName: businesses.displayName,
      websiteStatus: businesses.websiteStatus,
      manualReviewReasons: businesses.manualReviewReasons,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) throw new Error(`business ${businessId} not found`);

  // A booking-platform profile or a chain's store-locator page is not this business's website, so
  // every finding above describes the wrong site. The score is still computed — it accurately
  // describes what was crawled — but the record is flagged and held back from the gate.
  const [domainKey] = await db
    .select({ value: identityKeys.keyValue })
    .from(identityKeys)
    .where(and(eq(identityKeys.businessId, businessId), eq(identityKeys.keyType, "domain")))
    .limit(1);

  /**
   * Reviews, rating and followers — read for one narrow purpose.
   *
   * They carry a business only when its Google listing shows no website and nothing else could be
   * measured; see packages/core/src/scoring/demand.ts. Fetched for every business regardless,
   * because a conditional read here would mean the scoring result depended on the order things
   * were checked in.
   */
  const signalRows = await db
    .select({ fieldName: fieldMetadata.fieldName, value: fieldMetadata.value })
    .from(fieldMetadata)
    .where(
      and(
        eq(fieldMetadata.businessId, businessId),
        inArray(fieldMetadata.fieldName, ["rating", "review_count", "instagram_followers"]),
      ),
    );

  const score = computeScore({
    displayName: business.displayName,
    websiteStatus: business.websiteStatus as WebsiteStatus,
    domain: domainKey?.value ?? null,
    findings: rows.map(toCheckResult),
    signals: signalRows,
  });

  await writeScore(db, {
    id: businessId,
    score,
    reasons: mergeReasons(business.manualReviewReasons, business.displayName, score),
  });

  return score;
}

/**
 * Scores **many** businesses in a handful of queries instead of four each.
 *
 * `scoreAndStore` issues four round trips per business — findings, the record, its domain key, its
 * demand signals — and then one update. That is unremarkable for one business and ruinous for a
 * list: re-scoring 422 of them meant 2,110 round trips to a database in Mumbai from a worker that
 * is not, and the operator's report was the obvious consequence — "task lagate hain to poora din
 * lagta hai". The measured run took **13.9 minutes to do arithmetic**, of which the arithmetic was
 * a few seconds.
 *
 * Nothing about the scoring changes here. The same `scoreBusiness` runs on the same facts; only
 * the fetching is done in bulk and the writes are allowed to overlap.
 */
export async function scoreManyAndStore(
  db: Database,
  businessIds: string[],
  options: { onProgress?: (done: number) => Promise<void> | void; stopped?: () => Promise<boolean> } = {},
): Promise<{ scored: BusinessScore[]; missing: string[] }> {
  const scored: BusinessScore[] = [];
  const missing: string[] = [];

  for (let i = 0; i < businessIds.length; i += SCORE_CHUNK) {
    // The operator pressed Stop. Everything already written stays written.
    if (options.stopped && (await options.stopped())) break;
    const chunk = businessIds.slice(i, i + SCORE_CHUNK);

    // Four reads for the whole chunk, run together: they do not depend on each other.
    const [findingRows, businessRows, domainRows, signalRows] = await Promise.all([
      db
        .select({
          businessId: findings.businessId,
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
        .where(inArray(findings.businessId, chunk)),
      db
        .select({
          id: businesses.id,
          displayName: businesses.displayName,
          websiteStatus: businesses.websiteStatus,
          manualReviewReasons: businesses.manualReviewReasons,
        })
        .from(businesses)
        .where(inArray(businesses.id, chunk)),
      db
        .select({ businessId: identityKeys.businessId, value: identityKeys.keyValue })
        .from(identityKeys)
        .where(and(inArray(identityKeys.businessId, chunk), eq(identityKeys.keyType, "domain"))),
      db
        .select({ businessId: fieldMetadata.businessId, fieldName: fieldMetadata.fieldName, value: fieldMetadata.value })
        .from(fieldMetadata)
        .where(
          and(
            inArray(fieldMetadata.businessId, chunk),
            inArray(fieldMetadata.fieldName, ["rating", "review_count", "instagram_followers"]),
          ),
        ),
    ]);

    const findingsBy = groupBy(findingRows, (row) => row.businessId);
    const signalsBy = groupBy(signalRows, (row) => row.businessId);
    const domainBy = new Map(domainRows.map((row) => [row.businessId, row.value]));
    const records = new Map(businessRows.map((row) => [row.id, row]));

    const updates: { id: string; score: BusinessScore; reasons: ManualReviewReason[] }[] = [];

    for (const id of chunk) {
      const business = records.get(id);
      if (!business) {
        missing.push(id);
        continue;
      }

      const score = computeScore({
        displayName: business.displayName,
        websiteStatus: business.websiteStatus as WebsiteStatus,
        domain: domainBy.get(id) ?? null,
        findings: (findingsBy.get(id) ?? []).map(toCheckResult),
        signals: signalsBy.get(id) ?? [],
      });

      updates.push({ id, score, reasons: mergeReasons(business.manualReviewReasons, business.displayName, score) });
      scored.push(score);
    }

    // Writes may overlap; `postgres` holds the pool at five, so this is five in flight rather than
    // one, and nothing here depends on the order they land in.
    for (let w = 0; w < updates.length; w += WRITE_CONCURRENCY) {
      await Promise.all(updates.slice(w, w + WRITE_CONCURRENCY).map((update) => writeScore(db, update)));
    }

    if (options.onProgress) await options.onProgress(Math.min(i + chunk.length, businessIds.length));
  }

  return { scored, missing };
}

/** Big enough that per-chunk overhead disappears, small enough to keep one IN list sane. */
const SCORE_CHUNK = 200;

/** The connection pool is five wide (see packages/db/src/client.ts); asking for more only queues. */
const WRITE_CONCURRENCY = 5;

// ---------------------------------------------------------------- the shared middle

interface ScoreInput {
  displayName: string;
  websiteStatus: WebsiteStatus;
  domain: string | null;
  findings: CheckResult[];
  /** `value` is nullable in the table: a field that exists with no value is a real state. */
  signals: { fieldName: string; value: string | null }[];
}

/**
 * The scoring itself, with no database in it.
 *
 * Both paths above come through here, which is the point: a bulk re-score and a single one cannot
 * drift into giving the same business two different numbers.
 */
function computeScore(input: ScoreInput): BusinessScore {
  const sharedDomain = sharedPlatformDomain(input.domain);

  // Parsed strictly: a value that will not parse is unknown, never zero. Zero reviews and "nobody
  // has looked" are different facts, and only one of them is a judgement about the business.
  const signal = (name: string): number | null => {
    const raw = input.signals.find((r) => r.fieldName === name)?.value;
    if (raw === undefined || raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };

  return scoreBusiness({
    findings: input.findings,
    presence: input.websiteStatus,
    sharedDomainReason: sharedDomain?.reason ?? null,
    demand: {
      reviewCount: signal("review_count"),
      rating: signal("rating"),
      instagramFollowers: signal("instagram_followers"),
    },
  });
}

function toCheckResult(row: {
  checkId: string;
  family: CheckResult["family"];
  area: CheckResult["area"];
  costClass: CheckResult["costClass"];
  outcome: CheckResult["outcome"];
  points: number;
  maxPoints: number;
  evidence: string | null;
}): CheckResult {
  return {
    checkId: row.checkId,
    family: row.family,
    area: row.area,
    costClass: row.costClass,
    outcome: row.outcome,
    points: row.points,
    maxPoints: row.maxPoints,
    evidence: row.evidence ?? "",
  };
}

/**
 * The audit may already have flagged this record for a reason scoring knows nothing about (an
 * unreadable site, a shared phone). Merging rather than replacing keeps both.
 *
 * The chain test is here too. "Office Depot Print & Copy Services" was promoted to Tier 1 by the
 * demand rule: 4.3 stars from 77 reviews and no website on its listing, so `sharedPlatformDomain`
 * had nothing to match. Flagged rather than excluded — see `nameMatchesChain` for why a name is
 * not enough to act on, and why silencing "Michael's Braids" to catch "Michaels" would be worse.
 */
function mergeReasons(
  existing: ManualReviewReason[] | null,
  displayName: string,
  score: BusinessScore,
): ManualReviewReason[] {
  const merged = [...new Set([...(existing ?? []), ...score.manualReviewReasons])] as ManualReviewReason[];
  if (nameMatchesChain(displayName) && !merged.includes("name_matches_chain")) {
    merged.push("name_matches_chain");
  }
  return merged;
}

async function writeScore(
  db: Database,
  update: { id: string; score: BusinessScore; reasons: ManualReviewReason[] },
): Promise<void> {
  try {
    await db
      .update(businesses)
      .set({
        problemScore: update.score.problemScore,
        intentScore: update.score.intentScore,
        tier: update.score.tier,
        route: update.score.route,
        routeReason: update.score.routeReason,
        areaScores: update.score.areas,
        passedGate: update.score.passedGate,
        scoredAt: new Date(),
        manualReviewStatus: update.reasons.length > 0,
        manualReviewReasons: update.reasons,
        updatedAt: new Date(),
      })
      .where(eq(businesses.id, update.id));
  } catch (err) {
    throw new Error(`failed to store score for ${update.id}: ${describeDbError(err)}`);
  }
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}
