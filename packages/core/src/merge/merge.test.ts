import { describe, expect, it } from "vitest";
import { evaluateLateMerge, mergeIdentityKeys, type MergeCandidateRecord } from "./merge.js";

function record(overrides: Partial<MergeCandidateRecord> = {}): MergeCandidateRecord {
  return {
    recordId: "r1",
    createdAtMs: 1_000,
    keys: [],
    normalizedName: null,
    locationHash: null,
    ...overrides,
  };
}

describe("evaluateLateMerge — auto-merge cases", () => {
  it("auto-merges on a rank-1 place_id collision with matching names", () => {
    const a = record({
      recordId: "a",
      createdAtMs: 2_000,
      normalizedName: "unique screen printing",
      keys: [{ keyType: "phone", keyValue: "+13055550100", rank: 3 }],
    });
    const b = record({
      recordId: "b",
      createdAtMs: 1_000,
      normalizedName: "unique screen printing",
      keys: [{ keyType: "place_id", keyValue: "ChIJ_shared", rank: 1 }],
    });

    const decision = evaluateLateMerge({
      collidingKeyType: "place_id",
      collidingKeyValue: "ChIJ_shared",
      recordA: a,
      recordB: b,
    });

    expect(decision.action).toBe("auto_merge");
    if (decision.action === "auto_merge") {
      // b was created earlier (1_000 < 2_000) and survives
      expect(decision.survivorId).toBe("b");
      expect(decision.loserId).toBe("a");
    }
  });

  it("auto-merges on a rank-2 domain collision when location matches, even if names differ slightly", () => {
    const a = record({
      recordId: "a",
      createdAtMs: 5_000,
      normalizedName: "unique screen printing miami",
      locationHash: "geo:25.76:-80.19",
    });
    const b = record({
      recordId: "b",
      createdAtMs: 3_000,
      normalizedName: "unique custom printing",
      locationHash: "geo:25.76:-80.19",
      keys: [{ keyType: "domain", keyValue: "uniqueprinting.com", rank: 2 }],
    });

    const decision = evaluateLateMerge({
      collidingKeyType: "domain",
      collidingKeyValue: "uniqueprinting.com",
      recordA: a,
      recordB: b,
    });

    expect(decision.action).toBe("auto_merge");
    if (decision.action === "auto_merge") {
      expect(decision.survivorId).toBe("b"); // earlier createdAtMs
    }
  });

  it("the earlier-created record always survives, regardless of which side is A or B", () => {
    const older = record({ recordId: "older", createdAtMs: 100, normalizedName: "shop" });
    const newer = record({ recordId: "newer", createdAtMs: 999, normalizedName: "shop" });

    const decision = evaluateLateMerge({
      collidingKeyType: "place_id",
      collidingKeyValue: "ChIJ_x",
      recordA: newer,
      recordB: older,
    });

    expect(decision.action).toBe("auto_merge");
    if (decision.action === "auto_merge") {
      expect(decision.survivorId).toBe("older");
      expect(decision.loserId).toBe("newer");
    }
  });
});

describe("evaluateLateMerge — manual review cases (the important ones)", () => {
  it("never auto-merges on a weak key, even with an identical name", () => {
    const a = record({ recordId: "a", normalizedName: "cedar and pine" });
    const b = record({ recordId: "b", normalizedName: "cedar and pine" });

    const decision = evaluateLateMerge({
      collidingKeyType: "phone",
      collidingKeyValue: "+13055550100",
      recordA: a,
      recordB: b,
    });

    expect(decision.action).toBe("manual_review");
  });

  it("never auto-merges on the weakest key (name_location) even though it IS a name+location match", () => {
    // This looks like it should qualify on names/location, but rank 5 is explicitly excluded —
    // the auto-merge gate is on the COLLIDING key's rank, not on whether names happen to match.
    const a = record({ recordId: "a", normalizedName: "north loop goods" });
    const b = record({ recordId: "b", normalizedName: "north loop goods" });

    const decision = evaluateLateMerge({
      collidingKeyType: "name_location",
      collidingKeyValue: "north loop goods::geo:25.76:-80.19",
      recordA: a,
      recordB: b,
    });

    expect(decision.action).toBe("manual_review");
  });

  it("sends a changed-owner domain to review instead of merging — the case that must never auto-merge", () => {
    // Business B previously owned domain "oldbrand.com". The domain was sold and now resolves
    // to a completely different business (A), which happens to be getting the same domain key
    // attached during discovery. Names disagree and locations disagree: this must NOT merge.
    const a = record({
      recordId: "a",
      normalizedName: "brand new owner llc",
      locationHash: "geo:40.71:-74.00", // New York
    });
    const b = record({
      recordId: "b",
      normalizedName: "original founder shop",
      locationHash: "geo:25.76:-80.19", // Miami
      keys: [{ keyType: "domain", keyValue: "oldbrand.com", rank: 2 }],
    });

    const decision = evaluateLateMerge({
      collidingKeyType: "domain",
      collidingKeyValue: "oldbrand.com",
      recordA: a,
      recordB: b,
    });

    expect(decision.action).toBe("manual_review");
  });

  it("sends a genuine same-type conflict to review — record A already has a DIFFERENT place_id", () => {
    const a = record({
      recordId: "a",
      normalizedName: "shared building llc",
      keys: [{ keyType: "place_id", keyValue: "ChIJ_a_own_id", rank: 1 }],
    });
    const b = record({
      recordId: "b",
      normalizedName: "shared building llc",
      keys: [{ keyType: "place_id", keyValue: "ChIJ_shared", rank: 1 }],
    });

    const decision = evaluateLateMerge({
      collidingKeyType: "place_id",
      collidingKeyValue: "ChIJ_shared",
      recordA: a,
      recordB: b,
    });

    expect(decision.action).toBe("manual_review");
    if (decision.action === "manual_review") {
      expect(decision.reason).toMatch(/conflict/i);
    }
  });

  it("goes to review when both name and location are missing on one side", () => {
    const a = record({ recordId: "a" }); // no name, no location
    const b = record({ recordId: "b", normalizedName: "unique screen printing" });

    const decision = evaluateLateMerge({
      collidingKeyType: "place_id",
      collidingKeyValue: "ChIJ_x",
      recordA: a,
      recordB: b,
    });

    expect(decision.action).toBe("manual_review");
  });
});

describe("mergeIdentityKeys", () => {
  it("combines keys from both records, tagging the loser's keys with migratedFrom", () => {
    const survivor = record({
      recordId: "survivor",
      keys: [{ keyType: "place_id", keyValue: "ChIJ_shared", rank: 1 }],
    });
    const loser = record({
      recordId: "loser",
      keys: [
        { keyType: "place_id", keyValue: "ChIJ_shared", rank: 1 },
        { keyType: "fb_page_id", keyValue: "somepage", rank: 4 },
      ],
    });

    const merged = mergeIdentityKeys(survivor, loser);

    expect(merged).toHaveLength(2); // duplicate place_id is not doubled
    const fb = merged.find((k) => k.keyType === "fb_page_id");
    expect(fb?.migratedFrom).toBe("loser");
    const placeId = merged.find((k) => k.keyType === "place_id");
    expect(placeId?.migratedFrom).toBeNull(); // it was already on the survivor
  });

  it("keeps the surviving record's own keys marked as not migrated", () => {
    const survivor = record({
      recordId: "survivor",
      keys: [{ keyType: "domain", keyValue: "example.com", rank: 2 }],
    });
    const loser = record({ recordId: "loser", keys: [] });

    const merged = mergeIdentityKeys(survivor, loser);
    expect(merged).toEqual([{ keyType: "domain", keyValue: "example.com", rank: 2, migratedFrom: null }]);
  });

  it("never loses a key from either side", () => {
    const survivor = record({ recordId: "s", keys: [{ keyType: "place_id", keyValue: "p1", rank: 1 }] });
    const loser = record({
      recordId: "l",
      keys: [
        { keyType: "domain", keyValue: "d1.com", rank: 2 },
        { keyType: "phone", keyValue: "+13055550100", rank: 3 },
      ],
    });

    const merged = mergeIdentityKeys(survivor, loser);
    expect(merged.map((k) => k.keyValue).sort()).toEqual(["+13055550100", "d1.com", "p1"]);
  });
});
