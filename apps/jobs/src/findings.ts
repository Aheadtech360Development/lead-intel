import type { CheckResult } from "@lead-intel/core";
import { findings, type Database } from "@lead-intel/db";

/**
 * Writes the current result of every check for a business.
 *
 * Upsert rather than append, matching field_metadata: `findings` holds what we currently know
 * about a business, not a history of every time we looked. Re-auditing a site replaces its
 * findings, so a business whose site has since been fixed stops carrying the old problem instead
 * of accumulating both answers and leaving the score to whichever row was read first.
 *
 * `points` and `maxPoints` come straight from the check result, which built them from the
 * registry — nothing here decides how much anything is worth. The database's own
 * findings_points_match_outcome constraint is the backstop: a row where a blocked check carried
 * attainable points would be rejected rather than quietly scored.
 */
export async function upsertFindings(
  db: Database,
  businessId: string,
  results: CheckResult[],
  context: { sourceName: string; runId?: string | null },
): Promise<void> {
  if (results.length === 0) return;
  const now = new Date();

  for (const result of results) {
    const values = {
      businessId,
      checkId: result.checkId,
      family: result.family,
      area: result.area,
      outcome: result.outcome,
      costClass: result.costClass,
      points: result.points,
      maxPoints: result.maxPoints,
      evidence: result.evidence,
      detail: result.detail ?? null,
      sourceName: context.sourceName,
      runId: context.runId ?? null,
      measuredAt: now,
      updatedAt: now,
    };

    await db
      .insert(findings)
      .values(values)
      .onConflictDoUpdate({
        target: [findings.businessId, findings.checkId],
        set: {
          family: values.family,
          area: values.area,
          outcome: values.outcome,
          costClass: values.costClass,
          points: values.points,
          maxPoints: values.maxPoints,
          evidence: values.evidence,
          detail: values.detail,
          sourceName: values.sourceName,
          runId: values.runId,
          measuredAt: now,
          updatedAt: now,
        },
      });
  }
}
