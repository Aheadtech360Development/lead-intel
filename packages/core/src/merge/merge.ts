import { IDENTITY_KEY_RANK, type IdentityKey, type IdentityKeyType } from "@lead-intel/shared";
import { nameSimilarity } from "../normalize/name.js";

export interface MergeCandidateRecord {
  recordId: string;
  /** Epoch milliseconds, not a Date — keeps this module free of timezone/serialisation concerns. */
  createdAtMs: number;
  keys: IdentityKey[];
  normalizedName: string | null;
  locationHash: string | null;
}

export type MergeDecision =
  | { action: "auto_merge"; survivorId: string; loserId: string; reason: string }
  | { action: "manual_review"; reason: string };

const DEFAULT_NAME_SIMILARITY_THRESHOLD = 0.5;

/**
 * Decides what happens when writing an identity key for one business collides with a key
 * already owned by another business — the Postgres `23505` case described in spec §7 and
 * build guide §3.4.
 *
 * This function makes the decision. It does not touch a database and does not merge field
 * values — see mergeIdentityKeys() below for combining the key lists once a merge is approved.
 *
 * Auto-merge fires ONLY when all three hold, per spec §7 / v3.2 §4.5.2 (carried forward):
 *   1. The colliding key is rank 1 (place_id) or rank 2 (domain) — never a weaker key
 *   2. Neither record holds a *different* key of that same type (a genuine conflict, not just
 *      a coincidence)
 *   3. Normalised names are similar enough, OR the location hashes match exactly
 *
 * Everything else — including every rank 3–5 collision — goes to manual review. A wrong merge
 * destroys two records' history and is far more expensive to unwind than a duplicate is to
 * resolve, so the bar for automatic action is deliberately high.
 */
export function evaluateLateMerge(params: {
  collidingKeyType: IdentityKeyType;
  collidingKeyValue: string;
  recordA: MergeCandidateRecord;
  recordB: MergeCandidateRecord;
  nameSimilarityThreshold?: number;
}): MergeDecision {
  const { collidingKeyType, collidingKeyValue, recordA, recordB } = params;
  const threshold = params.nameSimilarityThreshold ?? DEFAULT_NAME_SIMILARITY_THRESHOLD;

  // Rank is a fixed property of the key TYPE (spec §7), never of an individual key instance —
  // no need to look it up on either record.
  const collidingRank = IDENTITY_KEY_RANK[collidingKeyType];

  if (collidingRank !== 1 && collidingRank !== 2) {
    return {
      action: "manual_review",
      reason: `weak key collision on ${collidingKeyType} (rank ${collidingRank}) — only rank 1 or 2 keys may auto-merge`,
    };
  }

  if (
    hasConflictingKeyOfSameType(recordA, collidingKeyType, collidingKeyValue) ||
    hasConflictingKeyOfSameType(recordB, collidingKeyType, collidingKeyValue)
  ) {
    return {
      action: "manual_review",
      reason: `one of the records already holds a different ${collidingKeyType} — this is a genuine conflict, not a coincidence`,
    };
  }

  const nameSim = nameSimilarity(recordA.normalizedName, recordB.normalizedName);
  const locationMatch =
    recordA.locationHash !== null &&
    recordB.locationHash !== null &&
    recordA.locationHash === recordB.locationHash;

  if (nameSim < threshold && !locationMatch) {
    return {
      action: "manual_review",
      reason: `names and locations both disagree (name similarity ${nameSim.toFixed(2)}, threshold ${threshold})`,
    };
  }

  const [survivor, loser] =
    recordA.createdAtMs <= recordB.createdAtMs ? [recordA, recordB] : [recordB, recordA];

  return {
    action: "auto_merge",
    survivorId: survivor.recordId,
    loserId: loser.recordId,
    reason: `matched on ${collidingKeyType} (rank ${collidingRank}), ${
      locationMatch ? "same location" : `name similarity ${nameSim.toFixed(2)}`
    }; earlier-created record survives`,
  };
}

function hasConflictingKeyOfSameType(
  record: MergeCandidateRecord,
  keyType: IdentityKeyType,
  collidingValue: string,
): boolean {
  return record.keys.some((k) => k.keyType === keyType && k.keyValue !== collidingValue);
}

/**
 * Combines two key lists after an approved merge: every key from the loser transfers to the
 * survivor, tagged with where it came from, and duplicates (same type + value already present)
 * are dropped rather than doubled. Each key keeps its original rank — merging never upgrades or
 * downgrades a key's strength.
 */
export interface MergedIdentityKey extends IdentityKey {
  migratedFrom: string | null;
}

export function mergeIdentityKeys(
  survivor: MergeCandidateRecord,
  loser: MergeCandidateRecord,
): MergedIdentityKey[] {
  const combined: MergedIdentityKey[] = survivor.keys.map((k) => ({ ...k, migratedFrom: null }));

  for (const loserKey of loser.keys) {
    const alreadyPresent = combined.some(
      (k) => k.keyType === loserKey.keyType && k.keyValue === loserKey.keyValue,
    );
    if (!alreadyPresent) {
      combined.push({ ...loserKey, migratedFrom: loser.recordId });
    }
  }

  return combined.sort((a, b) => a.rank - b.rank);
}
