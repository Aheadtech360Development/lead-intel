import { describe, expect, it } from "vitest";
import { mapRawPlace, RawPlace } from "./types.js";

function place(overrides: Partial<RawPlace> = {}): RawPlace {
  return {
    id: "ChIJ_test_place_id",
    displayName: { text: "Unique Screen Printing" },
    formattedAddress: "123 Main St, Miami, FL 33101, USA",
    addressComponents: [
      { longText: "Miami", shortText: "Miami", types: ["locality"] },
      { longText: "Florida", shortText: "FL", types: ["administrative_area_level_1"] },
      { longText: "United States", shortText: "US", types: ["country"] },
    ],
    location: { latitude: 25.7617, longitude: -80.1918 },
    nationalPhoneNumber: "(305) 757-6723",
    websiteUri: "https://uniquescreenprinting.com",
    rating: 4.5,
    userRatingCount: 120,
    businessStatus: "OPERATIONAL",
    primaryType: "clothing_store",
    ...overrides,
  };
}

describe("mapRawPlace", () => {
  it("maps a fully-populated result", () => {
    const result = mapRawPlace(place());
    expect(result).not.toBeNull();
    expect(result?.business).toEqual({
      name: "Unique Screen Printing",
      domain: "https://uniquescreenprinting.com",
      phone: "(305) 757-6723",
      placeId: "ChIJ_test_place_id",
      fbPageId: null,
      lat: 25.7617,
      lng: -80.1918,
      city: "Miami",
      state: "FL",
      country: "US",
    });
    expect(result?.rating).toBe(4.5);
    expect(result?.userRatingCount).toBe(120);
    expect(result?.businessStatus).toBe("operational");
    expect(result?.hasWebsiteField).toBe(true);
  });

  it("returns null when there is no name — nothing to identify the business by", () => {
    expect(mapRawPlace(place({ displayName: undefined }))).toBeNull();
    expect(mapRawPlace(place({ displayName: { text: "   " } }))).toBeNull();
  });

  it("marks hasWebsiteField false when websiteUri is absent, never guesses a domain", () => {
    const result = mapRawPlace(place({ websiteUri: undefined }));
    expect(result?.hasWebsiteField).toBe(false);
    expect(result?.business.domain).toBeNull();
  });

  it("leaves city/state/country null rather than parsing them out of formattedAddress", () => {
    const result = mapRawPlace(place({ addressComponents: undefined }));
    expect(result?.business.city).toBeNull();
    expect(result?.business.state).toBeNull();
    expect(result?.business.country).toBeNull();
  });

  it("passes businessStatus through lowercased, and null when absent", () => {
    expect(mapRawPlace(place({ businessStatus: "CLOSED_PERMANENTLY" }))?.businessStatus).toBe(
      "closed_permanently",
    );
    expect(mapRawPlace(place({ businessStatus: undefined }))?.businessStatus).toBeNull();
  });
});
