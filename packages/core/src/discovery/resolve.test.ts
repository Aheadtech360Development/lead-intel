import type { DiscoveredBusinessInput, IdentityKey } from "@lead-intel/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { normalizeLocation } from "../normalize/location.js";
import { normalizeName } from "../normalize/name.js";
import {
  resolveBusinessForRawResult,
  type AttachKeyOutcome,
  type CreatedBusinessOutcome,
  type DiscoveredFieldUpdate,
  type DiscoveryRepo,
  type KeyCollisionOutcome,
} from "./resolve.js";

interface StoredBusiness {
  business: DiscoveredBusinessInput;
  keys: IdentityKey[];
  createdAtMs: number;
  normalizedName: string | null;
  locationHash: string | null;
  fields: Map<string, DiscoveredFieldUpdate>;
}

/** Simulates the real Supabase-backed repo's atomicity contract (insert succeeds or reports
 *  every colliding key) with an in-memory map — correct for a single-threaded test even though
 *  the real implementation achieves it via insert-and-catch-23505, not a pre-check (see
 *  resolve.ts's DiscoveryRepo doc comment for why that distinction matters in production). */
class FakeDiscoveryRepo implements DiscoveryRepo {
  businesses = new Map<string, StoredBusiness>();
  keyIndex = new Map<string, string>();
  private nextId = 1;

  private keyStr(k: IdentityKey): string {
    return `${k.keyType}:${k.keyValue}`;
  }

  async tryCreateBusiness(
    business: DiscoveredBusinessInput,
    keys: IdentityKey[],
    nowMs: number,
  ): Promise<CreatedBusinessOutcome | KeyCollisionOutcome> {
    const collisions = keys
      .filter((k) => this.keyIndex.has(this.keyStr(k)))
      .map((k) => ({ key: k, existingBusinessId: this.keyIndex.get(this.keyStr(k)) as string }));
    if (collisions.length > 0) return { outcome: "collision", collisions };

    const id = `biz-${this.nextId++}`;
    const location = normalizeLocation({
      lat: business.lat,
      lng: business.lng,
      city: business.city,
      state: business.state,
      country: business.country,
    });
    this.businesses.set(id, {
      business,
      keys,
      createdAtMs: nowMs,
      normalizedName: normalizeName(business.name),
      locationHash: location?.locationHash ?? null,
      fields: new Map(),
    });
    for (const k of keys) this.keyIndex.set(this.keyStr(k), id);
    return { outcome: "created", businessId: id };
  }

  async getMergeCandidateRecord(businessId: string) {
    const stored = this.businesses.get(businessId);
    if (!stored) throw new Error(`no such business ${businessId}`);
    return {
      recordId: businessId,
      createdAtMs: stored.createdAtMs,
      keys: stored.keys,
      normalizedName: stored.normalizedName,
      locationHash: stored.locationHash,
    };
  }

  async attachKey(businessId: string, key: IdentityKey): Promise<AttachKeyOutcome> {
    const owner = this.keyIndex.get(this.keyStr(key));
    if (owner && owner !== businessId) return { outcome: "collision", existingBusinessId: owner };
    const stored = this.businesses.get(businessId);
    if (!stored) throw new Error(`no such business ${businessId}`);
    stored.keys.push(key);
    this.keyIndex.set(this.keyStr(key), businessId);
    return { outcome: "attached" };
  }

  async upsertFieldMetadata(businessId: string, fields: DiscoveredFieldUpdate[]): Promise<void> {
    const stored = this.businesses.get(businessId);
    if (!stored) throw new Error(`no such business ${businessId}`);
    for (const f of fields) stored.fields.set(f.fieldName, f);
  }
}

function business(overrides: Partial<DiscoveredBusinessInput> = {}): DiscoveredBusinessInput {
  return {
    name: "Unique Screen Printing",
    domain: "uniquescreenprinting.com",
    phone: "(305) 757-6723",
    placeId: "place-1",
    fbPageId: null,
    lat: 25.7617,
    lng: -80.1918,
    city: "Miami",
    state: "FL",
    country: "US",
    ...overrides,
  };
}

const ratingField: DiscoveredFieldUpdate[] = [{ fieldName: "rating", value: "4.5", sourceName: "google_places" }];

describe("resolveBusinessForRawResult", () => {
  let repo: FakeDiscoveryRepo;

  beforeEach(() => {
    repo = new FakeDiscoveryRepo();
  });

  it("creates a new business when nothing collides", async () => {
    const result = await resolveBusinessForRawResult({ business: business(), fields: ratingField, repo });
    expect(result.action).toBe("created");
    expect(repo.businesses.size).toBe(1);
    const stored = [...repo.businesses.values()][0];
    expect(stored?.fields.get("rating")?.value).toBe("4.5");
  });

  it("attaches (never duplicates) when the same place_id is seen again from an overlapping grid cell", async () => {
    const first = await resolveBusinessForRawResult({ business: business(), fields: [], repo });
    expect(first.action).toBe("created");

    const second = await resolveBusinessForRawResult({
      business: business({ phone: "(305) 757-6723" }), // same everything, as an overlapping search would return
      fields: [{ fieldName: "rating", value: "4.6", sourceName: "google_places" }],
      repo,
    });

    expect(second.action).toBe("attached");
    expect(repo.businesses.size).toBe(1); // still one business, not two
    const stored = [...repo.businesses.values()][0];
    expect(stored?.fields.get("rating")?.value).toBe("4.6"); // freshest reading kept
  });

  it("auto-resolves a rank-2 (domain) collision when names are similar, attaching new keys", async () => {
    await resolveBusinessForRawResult({
      business: business({ placeId: "place-1", phone: null }),
      fields: [],
      repo,
    });

    // A second result: different place_id (Places sometimes issues a new one), same domain,
    // near-identical name — should resolve to the SAME business, not create a second one.
    const result = await resolveBusinessForRawResult({
      business: business({ placeId: "place-2", name: "Unique Screen Printing LLC", phone: "(305) 757-6723" }),
      fields: [],
      repo,
    });

    expect(result.action).toBe("attached");
    expect(repo.businesses.size).toBe(1);
    const stored = [...repo.businesses.values()][0];
    // The new place_id and phone keys should now both point at the same business.
    expect(stored?.keys.some((k) => k.keyType === "place_id" && k.keyValue === "place-2")).toBe(true);
    expect(stored?.keys.some((k) => k.keyType === "phone")).toBe(true);
  });

  it("sends a rank-2 (domain) collision to manual review when names and locations both disagree", async () => {
    await resolveBusinessForRawResult({
      business: business({ placeId: "place-1", name: "Unique Screen Printing", city: "Miami", state: "FL" }),
      fields: [],
      repo,
    });

    const result = await resolveBusinessForRawResult({
      business: business({
        placeId: "place-2",
        name: "Totally Different Bakery",
        domain: "uniquescreenprinting.com", // shares the domain — e.g. two listings pointing at one shared site
        lat: 39.7392,
        lng: -104.9903,
        city: "Denver",
        state: "CO",
        phone: null,
      }),
      fields: [],
      repo,
    });

    expect(result.action).toBe("manual_review");
    if (result.action === "manual_review") {
      expect(result.involvedBusinessIds).toHaveLength(1);
    }
    expect(repo.businesses.size).toBe(1); // nothing new created, nothing wrongly attached either
  });

  it("sends a weak-key-only (phone) collision to manual review, never auto-attaching", async () => {
    await resolveBusinessForRawResult({
      business: business({ placeId: "place-1", domain: null }),
      fields: [],
      repo,
    });

    const result = await resolveBusinessForRawResult({
      business: business({ placeId: "place-2", domain: null, name: "A Totally Different Business" }),
      fields: [{ fieldName: "rating", value: "3.0", sourceName: "google_places" }],
      repo,
    });

    expect(result.action).toBe("manual_review");
    expect(repo.businesses.size).toBe(1);
    // Still records the field against the candidate — evidence isn't discarded, just not
    // auto-resolved.
    const stored = [...repo.businesses.values()][0];
    expect(stored?.fields.get("rating")?.value).toBe("3.0");
  });

  it("flags manual review when keys from one result collide across two different existing businesses", async () => {
    await resolveBusinessForRawResult({
      business: business({ placeId: "place-1", domain: "site-a.com", phone: null }),
      fields: [],
      repo,
    });
    await resolveBusinessForRawResult({
      business: business({ placeId: "place-2", domain: "site-b.com", phone: "+13055550000", name: "Second Business" }),
      fields: [],
      repo,
    });

    // A third result whose domain matches business 1 and whose phone matches business 2 —
    // a genuine multi-way conflict, must never be auto-resolved toward either.
    const result = await resolveBusinessForRawResult({
      business: business({ placeId: "place-3", domain: "site-a.com", phone: "+13055550000", name: "Third Business" }),
      fields: [],
      repo,
    });

    expect(result.action).toBe("manual_review");
    if (result.action === "manual_review") {
      expect(result.involvedBusinessIds).toHaveLength(2);
    }
    expect(repo.businesses.size).toBe(2); // unchanged — no guess was made
  });

  it("throws rather than silently creating an unfindable business with zero identity keys", async () => {
    await expect(
      resolveBusinessForRawResult({
        business: business({ placeId: null, domain: null, phone: null, city: null, state: null, name: "   " }),
        fields: [],
        repo,
      }),
    ).rejects.toThrow(/no identity keys/);
  });
});
