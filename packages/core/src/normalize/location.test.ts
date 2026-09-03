import { describe, expect, it } from "vitest";
import { normalizeLocation } from "./location.js";

describe("normalizeLocation", () => {
  it("rounds coordinates to a stable grid", () => {
    const loc = normalizeLocation({ lat: 25.761681, lng: -80.191788, city: "Miami", state: "FL" });
    expect(loc?.latRounded).toBe(25.76);
    expect(loc?.lngRounded).toBe(-80.19);
  });

  it("produces the same location hash for two nearby points that round to the same cell", () => {
    const a = normalizeLocation({ lat: 25.7612, lng: -80.1915 });
    const b = normalizeLocation({ lat: 25.7619, lng: -80.1922 });
    expect(a?.locationHash).toBe(b?.locationHash);
  });

  it("produces a different hash for points in different cells", () => {
    const a = normalizeLocation({ lat: 25.76, lng: -80.19 });
    const b = normalizeLocation({ lat: 25.90, lng: -80.30 });
    expect(a?.locationHash).not.toBe(b?.locationHash);
  });

  it("lowercases and trims city and state", () => {
    const loc = normalizeLocation({ lat: 1, lng: 1, city: "  Miami  ", state: "FL" });
    expect(loc?.city).toBe("miami");
    expect(loc?.state).toBe("fl");
  });

  it("defaults country to us when not given", () => {
    const loc = normalizeLocation({ lat: 1, lng: 1 });
    expect(loc?.country).toBe("us");
  });

  it("falls back to a place-name hash when coordinates are missing", () => {
    const loc = normalizeLocation({ city: "Miami", state: "FL" });
    expect(loc?.latRounded).toBeNull();
    expect(loc?.lngRounded).toBeNull();
    expect(loc?.locationHash).toBe("place:us:fl:miami");
  });

  it("returns null when there is neither coordinates nor a city", () => {
    expect(normalizeLocation({})).toBeNull();
    expect(normalizeLocation({ state: "FL" })).toBeNull();
  });

  it("does not throw on non-finite coordinates and falls back to place-name hashing", () => {
    const loc = normalizeLocation({ lat: Number.NaN, lng: Number.NaN, city: "Miami" });
    expect(loc?.latRounded).toBeNull();
    expect(loc?.locationHash).toBe("place:us:unknown:miami");
  });
});
