import {
  IDENTITY_KEY_RANK,
  type DiscoveredBusinessInput,
  type IdentityKey,
} from "@lead-intel/shared";
import { buildIdentityKeys } from "../identity/build.js";
import { evaluateLateMerge, type MergeCandidateRecord } from "../merge/merge.js";
import { normalizeLocation, type LocationInput } from "../normalize/location.js";
import { normalizeName } from "../normalize/name.js";

/** DiscoveredBusinessInput's location fields are optional (`lat?: number | null`); LocationInput
 *  wants them present-but-nullable. Under exactOptionalPropertyTypes these are different shapes
 *  — `?? null` bridges "absent" and "explicitly null" the same way the rest of this codebase
 *  already treats them (see normalizeLocation's own doc comment). */
function toLocationInput(business: DiscoveredBusinessInput): LocationInput {
  return {
    lat: business.lat ?? null,
    lng: business.lng ?? null,
    city: business.city ?? null,
    state: business.state ?? null,
    country: business.country ?? null,
  };
}

/**
 * A raw field this discovered result carries, destined for field_metadata. Deliberately generic
 * (fieldName/value/sourceName only) rather than typed to Places specifically — this module
 * never imports packages/providers (core stays independent of any one source; apps/jobs is the
 * integration point that knows about both). Every field written through this module's
 * upsertFieldMetadata call is a direct provider read, never a guess — the real repo
 * implementation in apps/jobs always writes verification_status "verified" for it, the same
 * standard the manual-entry form uses once its own validation passes.
 */
export interface DiscoveredFieldUpdate {
  fieldName: string;
  value: string;
  sourceName: string;
}

export interface CreatedBusinessOutcome {
  outcome: "created";
  businessId: string;
}

export interface KeyCollisionOutcome {
  outcome: "collision";
  /** Every key from this attempt that already belongs to an existing business. Usually one
   *  entry — more than one only when different keys from the same discovered result point at
   *  different existing businesses (see resolveBusinessForRawResult's handling of that case). */
  collisions: Array<{ key: IdentityKey; existingBusinessId: string }>;
}

export interface AttachKeyOutcome {
  outcome: "attached" | "collision";
  /** Only present when outcome is "collision" — the business that already owns this exact key. */
  existingBusinessId?: string;
}

/**
 * The database-touching operations resolve.ts needs, injected so the decision logic here stays
 * network-free and unit-testable (same bar as normalize/ and merge/) while the real
 * implementation — in apps/jobs, backed by Supabase — does the actual I/O.
 */
export interface DiscoveryRepo {
  /**
   * Attempts to insert a new business row plus every key in `keys`, all in one transaction.
   * Per development-build-guide.md §3.4, this must NEVER be preceded by a pre-check SELECT —
   * unlike the manual-entry form's single human on one form, grid cells run concurrently, so a
   * check-then-insert has a real race window. The real implementation inserts optimistically and
   * reports back which keys (if any) hit the identity_keys unique constraint (Postgres 23505),
   * rolling back the whole attempt so nothing partial is left for this module to reconcile
   * against a business that doesn't actually own all its keys yet.
   */
  tryCreateBusiness(
    business: DiscoveredBusinessInput,
    keys: IdentityKey[],
    nowMs: number,
  ): Promise<CreatedBusinessOutcome | KeyCollisionOutcome>;

  /** Everything evaluateLateMerge needs about an already-existing business: its full key set,
   *  normalised name, location hash, and creation time (the tie-break for which record
   *  survives an auto-merge). */
  getMergeCandidateRecord(businessId: string): Promise<MergeCandidateRecord>;

  /** Adds one new key to an existing business — the common "new evidence about a business we
   *  already have" case. Can itself collide (a different, third business already owns this
   *  exact key) — the caller must not assume this always succeeds. */
  attachKey(businessId: string, key: IdentityKey): Promise<AttachKeyOutcome>;

  /** Writes/updates field_metadata for a business from this discovered result. */
  upsertFieldMetadata(businessId: string, fields: DiscoveredFieldUpdate[]): Promise<void>;
}

export type ResolveOutcome =
  | { action: "created"; businessId: string }
  | { action: "attached"; businessId: string }
  | { action: "manual_review"; reason: string; involvedBusinessIds: string[] };

/**
 * The discovery-time identity resolution step (Phase 3 plan, item 2): given one raw result from
 * a grid search, decides whether it's a new business, evidence for a business already on file,
 * or something a human needs to look at — and carries out that decision through `repo`.
 *
 * This intentionally does NOT call packages/core's mergeIdentityKeys / write a merge_snapshots
 * row. Those exist for merging two ALREADY-PERSISTED canonical businesses that turn out to be
 * the same one (e.g. one from manual entry, one from a later discovery run). Here, the incoming
 * side has never been persisted as its own business — it's either folded into an existing
 * record via attachKey, or it becomes that record. There is no "before" state to make
 * reversible, so merge_snapshots' reason for existing doesn't apply.
 */
export async function resolveBusinessForRawResult(params: {
  business: DiscoveredBusinessInput;
  fields: DiscoveredFieldUpdate[];
  repo: DiscoveryRepo;
  nowMs?: number;
  nameSimilarityThreshold?: number;
}): Promise<ResolveOutcome> {
  const { business, fields, repo } = params;
  const now = params.nowMs ?? Date.now();

  const keys = buildIdentityKeys({
    name: business.name,
    domain: business.domain ?? null,
    phone: business.phone ?? null,
    placeId: business.placeId ?? null,
    fbPageId: business.fbPageId ?? null,
    location: toLocationInput(business),
  });

  if (keys.length === 0) {
    // A Places result should always yield at least a place_id key. Reaching this means the
    // caller passed a malformed input — fail loud rather than silently create a business no
    // key can ever look up again.
    throw new Error(
      "resolveBusinessForRawResult: no identity keys could be built from this input — expected at least a place_id",
    );
  }

  const attempt = await repo.tryCreateBusiness(business, keys, now);

  if (attempt.outcome === "created") {
    await repo.upsertFieldMetadata(attempt.businessId, fields);
    return { action: "created", businessId: attempt.businessId };
  }

  return resolveCollision({ business, fields, keys, collisions: attempt.collisions, repo, now, threshold: params.nameSimilarityThreshold });
}

async function resolveCollision(params: {
  business: DiscoveredBusinessInput;
  fields: DiscoveredFieldUpdate[];
  keys: IdentityKey[];
  collisions: KeyCollisionOutcome["collisions"];
  repo: DiscoveryRepo;
  now: number;
  threshold: number | undefined;
}): Promise<ResolveOutcome> {
  const { business, fields, keys, repo, now, threshold } = params;

  const byRank = [...params.collisions].sort(
    (a, b) => IDENTITY_KEY_RANK[a.key.keyType] - IDENTITY_KEY_RANK[b.key.keyType],
  );
  const primary = byRank[0];
  if (!primary) {
    throw new Error("resolveBusinessForRawResult: collision outcome with no collisions listed");
  }

  const otherBusinessIds = [...new Set(byRank.slice(1).map((c) => c.existingBusinessId))].filter(
    (id) => id !== primary.existingBusinessId,
  );
  if (otherBusinessIds.length > 0) {
    // Different keys from ONE discovered result collide with TWO OR MORE different existing
    // businesses — a genuine multi-way identity conflict. Always a human call, never a guess at
    // which existing business is "more right".
    return {
      action: "manual_review",
      reason: `keys from one result collide across multiple existing businesses`,
      involvedBusinessIds: [primary.existingBusinessId, ...otherBusinessIds],
    };
  }

  const existingBusinessId = primary.existingBusinessId;
  const collidingRank = IDENTITY_KEY_RANK[primary.key.keyType];

  if (collidingRank > 2) {
    // spec §7 / merge.ts: only rank 1 (place_id) or rank 2 (domain) collisions may auto-resolve.
    // A phone or name_location match alone is evidence, not proof — record it against the
    // candidate business, but don't fold this result into it automatically.
    await repo.upsertFieldMetadata(existingBusinessId, fields);
    return {
      action: "manual_review",
      reason: `weak key match (${primary.key.keyType}) on an existing business — not auto-resolved`,
      involvedBusinessIds: [existingBusinessId],
    };
  }

  const existingRecord = await repo.getMergeCandidateRecord(existingBusinessId);
  const location = normalizeLocation(toLocationInput(business));
  const incomingRecord: MergeCandidateRecord = {
    recordId: "__incoming__", // sentinel — never persisted; evaluateLateMerge only reads key/name/location/createdAt shape
    createdAtMs: now,
    keys,
    normalizedName: normalizeName(business.name),
    locationHash: location?.locationHash ?? null,
  };

  const decision = evaluateLateMerge({
    collidingKeyType: primary.key.keyType,
    collidingKeyValue: primary.key.keyValue,
    recordA: existingRecord,
    recordB: incomingRecord,
    ...(threshold !== undefined ? { nameSimilarityThreshold: threshold } : {}),
  });

  if (decision.action === "manual_review") {
    await repo.upsertFieldMetadata(existingBusinessId, fields);
    return { action: "manual_review", reason: decision.reason, involvedBusinessIds: [existingBusinessId] };
  }

  // auto_merge: the existing business always survives (it was created before "now", and
  // evaluateLateMerge's tie-break is earlier-created wins) — attach every key from this result
  // it doesn't already hold.
  for (const key of keys) {
    const alreadyHeld = existingRecord.keys.some((k) => k.keyType === key.keyType && k.keyValue === key.keyValue);
    if (alreadyHeld) continue;
    const attachResult = await repo.attachKey(existingBusinessId, key);
    if (attachResult.outcome === "collision" && attachResult.existingBusinessId) {
      return {
        action: "manual_review",
        reason: `attaching ${key.keyType} collided with a third business`,
        involvedBusinessIds: [existingBusinessId, attachResult.existingBusinessId],
      };
    }
  }

  await repo.upsertFieldMetadata(existingBusinessId, fields);
  return { action: "attached", businessId: existingBusinessId };
}
