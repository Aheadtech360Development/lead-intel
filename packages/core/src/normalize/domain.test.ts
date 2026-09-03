import { describe, expect, it } from "vitest";
import { normalizeDomain, sameDomain } from "./domain.js";

describe("normalizeDomain", () => {
  it("strips protocol", () => {
    expect(normalizeDomain("https://example.com")).toBe("example.com");
    expect(normalizeDomain("http://example.com")).toBe("example.com");
  });

  it("strips www", () => {
    expect(normalizeDomain("https://www.example.com")).toBe("example.com");
  });

  it("strips trailing slash and path", () => {
    expect(normalizeDomain("https://example.com/")).toBe("example.com");
    expect(normalizeDomain("https://example.com/contact")).toBe("example.com");
  });

  it("strips tracking query parameters", () => {
    expect(normalizeDomain("https://example.com/?utm_source=google")).toBe("example.com");
  });

  it("accepts a bare domain with no scheme", () => {
    expect(normalizeDomain("example.com")).toBe("example.com");
    expect(normalizeDomain("www.example.com")).toBe("example.com");
  });

  it("lowercases the result", () => {
    expect(normalizeDomain("HTTPS://EXAMPLE.COM")).toBe("example.com");
  });

  it("keeps a non-www subdomain distinct from the bare domain", () => {
    expect(normalizeDomain("https://shop.example.com")).toBe("shop.example.com");
    expect(normalizeDomain("https://shop.example.com")).not.toBe(normalizeDomain("https://example.com"));
  });

  it("returns null for empty, missing, or unparseable input", () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
    expect(normalizeDomain("not a url at all !!")).toBeNull();
  });

  it("handles a .co.uk-style multi-part public suffix correctly", () => {
    expect(normalizeDomain("https://www.example.co.uk")).toBe("example.co.uk");
  });

  it("rejects an email address rather than silently extracting its domain as userinfo", () => {
    // Found in production: a person typed their email into a "website" field. Without this
    // guard, `new URL("https://name@gmail.com")` parses "name" as URL userinfo and happily
    // returns "gmail.com" as the hostname — a completely wrong identity key that would collide
    // with every other business whose email also happens to be on gmail.com.
    expect(normalizeDomain("testingcompany@gmail.com")).toBeNull();
    expect(normalizeDomain("someone@example.com")).toBeNull();
    expect(normalizeDomain("https://someone@example.com/path")).toBeNull();
  });
});

describe("sameDomain", () => {
  it("treats different formats of the same domain as equal", () => {
    expect(sameDomain("https://www.example.com/", "example.com")).toBe(true);
    expect(sameDomain("http://EXAMPLE.com/contact?utm_source=x", "www.example.com")).toBe(true);
  });

  it("treats genuinely different domains as different", () => {
    expect(sameDomain("example.com", "example.org")).toBe(false);
  });

  it("never treats two unparseable inputs as the same domain", () => {
    expect(sameDomain(null, null)).toBe(false);
    expect(sameDomain("", "")).toBe(false);
  });
});
