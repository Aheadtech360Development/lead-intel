import { describe, expect, it } from "vitest";
import { normalizePhone, samePhone } from "./phone.js";

describe("normalizePhone", () => {
  it("normalises a US number with formatting to E.164", () => {
    const result = normalizePhone("(305) 757-6723");
    expect(result?.e164).toBe("+13057576723");
    expect(result?.country).toBe("US");
  });

  it("accepts an already-E.164 number", () => {
    expect(normalizePhone("+13057576723")?.e164).toBe("+13057576723");
  });

  it("accepts a number with dots or spaces as separators", () => {
    expect(normalizePhone("305.757.6723")?.e164).toBe("+13057576723");
    expect(normalizePhone("305 757 6723")?.e164).toBe("+13057576723");
  });

  it("respects an explicit default country over the US default", () => {
    const result = normalizePhone("020 7946 0958", "GB");
    expect(result?.country).toBe("GB");
    expect(result?.e164).toBe("+442079460958");
  });

  it("returns a line type that is always one of the known values", () => {
    const result = normalizePhone("(305) 757-6723");
    expect(["mobile", "landline", "voip", "unknown"]).toContain(result?.lineType);
  });

  it("reports 'unknown' rather than a guessed line type for a US number", () => {
    // The North American Numbering Plan does not encode line type — libphonenumber-js reports
    // "FIXED_LINE_OR_MOBILE" for essentially every valid US number, and this must never be
    // reported as a confident "landline". Almost all business phones this system sees are US
    // numbers, so this is the common case, not an edge case.
    expect(normalizePhone("(305) 757-6723")?.lineType).toBe("unknown");
  });

  it("reports a genuine landline correctly for a country whose numbering plan encodes it", () => {
    expect(normalizePhone("020 7946 0958", "GB")?.lineType).toBe("landline");
  });

  it("returns null for an invalid number", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("not a phone number")).toBeNull();
  });

  it("returns null for empty or missing input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
  });
});

describe("samePhone", () => {
  it("treats different formats of the same number as equal", () => {
    expect(samePhone("(305) 757-6723", "+13057576723")).toBe(true);
    expect(samePhone("305-757-6723", "305.757.6723")).toBe(true);
  });

  it("treats genuinely different numbers as different", () => {
    expect(samePhone("(305) 757-6723", "(305) 757-9999")).toBe(false);
  });

  it("never treats two invalid inputs as the same number", () => {
    expect(samePhone("123", "123")).toBe(false);
  });
});
