import { describe, expect, it } from "vitest";
import { buildIdentityKeys, hasStrongKey, strongestKey } from "./build.js";

describe("buildIdentityKeys", () => {
  it("builds every key it has material for, sorted strongest first", () => {
    const keys = buildIdentityKeys({
      placeId: "ChIJ_test123",
      domain: "https://www.uniquescreenprinting.com/",
      phone: "(305) 757-6723",
      fbPageId: "uniquescreenprintingmiami",
      name: "Unique Screen Printing",
      location: { lat: 25.7617, lng: -80.1918, city: "Miami", state: "FL" },
    });

    expect(keys.map((k) => k.keyType)).toEqual(["place_id", "domain", "phone", "fb_page_id", "name_location"]);
    expect(keys.map((k) => k.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("produces only the keys it has material for", () => {
    const keys = buildIdentityKeys({ placeId: "ChIJ_only_this_one" });
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ keyType: "place_id", rank: 1 });
  });

  it("returns an empty array when there is no usable material", () => {
    expect(buildIdentityKeys({})).toEqual([]);
  });

  it("skips an invalid phone number rather than producing a bad key", () => {
    const keys = buildIdentityKeys({ phone: "123" });
    expect(keys).toEqual([]);
  });

  it("skips an unparseable domain rather than producing a bad key", () => {
    const keys = buildIdentityKeys({ domain: "not a url !!" });
    expect(keys).toEqual([]);
  });

  it("only produces the rank-5 key when BOTH name and location are usable", () => {
    const nameOnly = buildIdentityKeys({ name: "Unique Screen Printing" });
    expect(nameOnly.find((k) => k.keyType === "name_location")).toBeUndefined();

    const locationOnly = buildIdentityKeys({ location: { lat: 25.76, lng: -80.19 } });
    expect(locationOnly.find((k) => k.keyType === "name_location")).toBeUndefined();

    const both = buildIdentityKeys({
      name: "Unique Screen Printing",
      location: { lat: 25.76, lng: -80.19 },
    });
    expect(both.find((k) => k.keyType === "name_location")).toBeDefined();
  });

  it("normalises the domain key so formatting differences don't produce different keys", () => {
    const a = buildIdentityKeys({ domain: "https://www.example.com/" });
    const b = buildIdentityKeys({ domain: "example.com" });
    expect(a[0]?.keyValue).toBe(b[0]?.keyValue);
  });
});

describe("strongestKey", () => {
  it("picks the lowest-ranked (strongest) key", () => {
    const keys = buildIdentityKeys({ phone: "(305) 757-6723", fbPageId: "somepage" });
    expect(strongestKey(keys)?.keyType).toBe("phone");
  });

  it("returns null for an empty set", () => {
    expect(strongestKey([])).toBeNull();
  });
});

describe("hasStrongKey", () => {
  it("is true when a rank 1 or 2 key exists", () => {
    expect(hasStrongKey(buildIdentityKeys({ placeId: "x" }))).toBe(true);
    expect(hasStrongKey(buildIdentityKeys({ domain: "example.com" }))).toBe(true);
  });

  it("is false when only weaker keys exist", () => {
    expect(hasStrongKey(buildIdentityKeys({ phone: "(305) 757-6723" }))).toBe(false);
    expect(hasStrongKey([])).toBe(false);
  });
});

describe("domains that name a chain or a platform rather than one business", () => {
  // Both rows are verbatim from the import that found this: two Big Frog franchises 350 miles
  // apart, whose paths `normalizeDomain` strips, leaving both holding `bigfrog.com`.
  const buckhead = { name: "Big Frog Custom T-Shirts Buckhead", domain: "bigfrog.com/buckhead", phone: "(404) 252-4223", location: { city: "Atlanta", state: "GA" } };
  const greenHills = { name: "Big Frog Custom T-Shirts Green Hills", domain: "bigfrog.com/greenhills", phone: "(615) 915-2373", location: { city: "Nashville", state: "TN" } };

  it("does not let two franchises of one chain share a domain key", () => {
    const a = buildIdentityKeys(buckhead).filter((k) => k.keyType === "domain");
    const b = buildIdentityKeys(greenHills).filter((k) => k.keyType === "domain");
    expect(a).toEqual([]);
    expect(b).toEqual([]);
  });

  it("leaves each franchise the keys that genuinely tell them apart", () => {
    const a = buildIdentityKeys(buckhead);
    const b = buildIdentityKeys(greenHills);
    expect(a.map((k) => k.keyType)).toEqual(["phone", "name_location"]);
    // No key value is shared, so nothing merges them.
    const shared = a.filter((k) => b.some((o) => o.keyType === k.keyType && o.keyValue === k.keyValue));
    expect(shared).toEqual([]);
  });

  it("refuses a bare platform domain, which every business on it would otherwise claim", () => {
    expect(buildIdentityKeys({ domain: "booksy.com" }).map((k) => k.keyType)).toEqual([]);
  });

  it("keeps a per-business subdomain, which names exactly one shop", () => {
    // Also from the same import: the row is a real business, and this is really its address.
    const keys = buildIdentityKeys({ domain: "rjgraphicsanddesign.myshopify.com" });
    expect(keys).toEqual([
      { keyType: "domain", keyValue: "rjgraphicsanddesign.myshopify.com", rank: 2 },
    ]);
  });

  it("still keys an ordinary business whose domain merely resembles nothing special", () => {
    expect(buildIdentityKeys({ domain: "https://artscapecreative.com" }).map((k) => k.keyValue)).toEqual([
      "artscapecreative.com",
    ]);
  });
});
