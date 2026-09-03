import type {
  AttachKeyOutcome,
  CreatedBusinessOutcome,
  DiscoveredFieldUpdate,
  DiscoveryRepo,
  KeyCollisionOutcome,
} from "@lead-intel/core";
import { normalizeLocation, normalizeName } from "@lead-intel/core";
import {
  businesses,
  createDbClient,
  identityKeys,
  isUniqueViolation,
  type Database,
} from "@lead-intel/db";
import type { DiscoveredBusinessInput, IdentityKey } from "@lead-intel/shared";
import { and, eq } from "drizzle-orm";
import { upsertFieldMetadata } from "./field-metadata.js";

/**
 * The real, Supabase/Postgres-backed implementation of packages/core's DiscoveryRepo interface —
 * see resolve.ts's doc comment for why the decision logic there never touches the database
 * directly. Every method here is a thin, honest translation of the interface contract into
 * Drizzle queries; the identity-resolution DECISIONS all live in packages/core, already tested
 * there against an in-memory fake — this file is deliberately not where that logic gets re-tested.
 */
export function createDiscoveryRepo(db: Database = createDbClient()): DiscoveryRepo {
  return {
    async tryCreateBusiness(
      business: DiscoveredBusinessInput,
      keys: IdentityKey[],
      nowMs: number,
    ): Promise<CreatedBusinessOutcome | KeyCollisionOutcome> {
      const location = normalizeLocation({
        lat: business.lat ?? null,
        lng: business.lng ?? null,
        city: business.city ?? null,
        state: business.state ?? null,
        country: business.country ?? null,
      });

      try {
        const businessId = await db.transaction(async (tx) => {
          const [row] = await tx
            .insert(businesses)
            .values({
              displayName: business.name,
              nameNormalized: normalizeName(business.name),
              // Written out rather than left to the column default: this is the one place a
              // discovered business is created, and the operator's list filters on it. A default
              // that silently changed would mis-label every record made here.
              origin: "discovered" as const,
              // websiteStatus deliberately stays at its schema default ("unclear") — Phase 3's
              // scope is recording the raw Places signal (see field_metadata's has_website_field
              // below), not classifying presence, which needs the other two checks spec §4
              // requires and isn't built until Phase 4. Never guess "live" or "no_website" here.
              latRounded: location?.latRounded ?? null,
              lngRounded: location?.lngRounded ?? null,
              city: location?.city ?? null,
              state: location?.state ?? null,
              country: location?.country ?? "us",
              locationHash: location?.locationHash ?? null,
              createdAt: new Date(nowMs),
              updatedAt: new Date(nowMs),
            })
            .returning({ id: businesses.id });

          if (!row) throw new Error("insert into businesses returned no row");

          for (const key of keys) {
            await tx.insert(identityKeys).values({
              businessId: row.id,
              keyType: key.keyType,
              keyValue: key.keyValue,
              rank: key.rank,
            });
          }

          return row.id;
        });

        return { outcome: "created", businessId };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;

        // The transaction above rolled back entirely — nothing partial was left behind. Find out
        // which key(s) already exist so resolve.ts can decide what to do; this lookup happens
        // AFTER the race already occurred, so it carries none of the pre-check race risk build
        // guide §3.4 warns against (see resolve.ts's DiscoveryRepo doc comment).
        const collisions: KeyCollisionOutcome["collisions"] = [];
        for (const key of keys) {
          const existing = await db
            .select({ businessId: identityKeys.businessId })
            .from(identityKeys)
            .where(and(eq(identityKeys.keyType, key.keyType), eq(identityKeys.keyValue, key.keyValue)))
            .limit(1);
          const owner = existing[0];
          if (owner) collisions.push({ key, existingBusinessId: owner.businessId });
        }
        return { outcome: "collision", collisions };
      }
    },

    async getMergeCandidateRecord(businessId: string) {
      const [business] = await db
        .select({
          nameNormalized: businesses.nameNormalized,
          locationHash: businesses.locationHash,
          createdAt: businesses.createdAt,
        })
        .from(businesses)
        .where(eq(businesses.id, businessId))
        .limit(1);
      if (!business) throw new Error(`no such business ${businessId}`);

      const keyRows = await db
        .select({ keyType: identityKeys.keyType, keyValue: identityKeys.keyValue, rank: identityKeys.rank })
        .from(identityKeys)
        .where(eq(identityKeys.businessId, businessId));

      return {
        recordId: businessId,
        createdAtMs: business.createdAt.getTime(),
        keys: keyRows as IdentityKey[],
        normalizedName: business.nameNormalized,
        locationHash: business.locationHash,
      };
    },

    async attachKey(businessId: string, key: IdentityKey): Promise<AttachKeyOutcome> {
      try {
        await db.insert(identityKeys).values({
          businessId,
          keyType: key.keyType,
          keyValue: key.keyValue,
          rank: key.rank,
        });
        return { outcome: "attached" };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const [owner] = await db
          .select({ businessId: identityKeys.businessId })
          .from(identityKeys)
          .where(and(eq(identityKeys.keyType, key.keyType), eq(identityKeys.keyValue, key.keyValue)))
          .limit(1);
        return { outcome: "collision", ...(owner ? { existingBusinessId: owner.businessId } : {}) };
      }
    },

    // Every field routed through resolve.ts is a direct provider read, never a guess — which is
    // exactly the standard upsertFieldMetadata documents and holds itself to.
    async upsertFieldMetadata(businessId: string, fields: DiscoveredFieldUpdate[]): Promise<void> {
      await upsertFieldMetadata(db, businessId, fields);
    },
  };
}
