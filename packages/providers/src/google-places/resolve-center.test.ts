import { describe, expect, it } from "vitest";
import { resolveSearchCenter } from "./resolve-center.js";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response) as typeof fetch;
}

/** Shapes below are copied from real responses captured against the live API during Phase 3
 *  setup — not invented — so these tests fail if Google's actual payload shape drifts. */
const MIAMI = {
  places: [
    {
      displayName: { text: "Miami" },
      formattedAddress: "Miami, FL, USA",
      addressComponents: [
        { longText: "Miami", shortText: "Miami", types: ["locality", "political"] },
        { longText: "United States", shortText: "US", types: ["country", "political"] },
      ],
      location: { latitude: 25.7616798, longitude: -80.1917902 },
      types: ["locality", "political"],
    },
  ],
};

/** The real failure this guard exists for: searching from Pakistan, the one-word query
 *  "Springfield" returns a Karachi school with entirely plausible-looking coordinates. */
const SPRINGFIELD_SCHOOL_KARACHI = {
  places: [
    {
      displayName: { text: "Springfield School" },
      formattedAddress: "V3HR+9HW, Karachi, 75350, Pakistan",
      addressComponents: [
        { longText: "Pakistan", shortText: "PK", types: ["country", "political"] },
      ],
      location: { latitude: 24.8776, longitude: 67.0912 },
      types: ["school", "educational_institution", "point_of_interest", "establishment"],
    },
  ],
};

const POSTCODE_33101 = {
  places: [
    {
      displayName: { text: "33101" },
      formattedAddress: "Miami, FL 33101, USA",
      addressComponents: [
        { longText: "United States", shortText: "US", types: ["country", "political"] },
      ],
      location: { latitude: 25.7781, longitude: -80.1994 },
      types: ["postal_code"],
    },
  ],
};

describe("resolveSearchCenter", () => {
  it("resolves a normal city to its coordinates", async () => {
    const result = await resolveSearchCenter({
      locationText: "Miami, FL",
      apiKey: "test-key",
      fetchImpl: fakeFetch(200, MIAMI),
    });
    expect(result.succeeded).toBe(true);
    expect(result.center?.lat).toBeCloseTo(25.7617, 3);
    expect(result.center?.lng).toBeCloseTo(-80.1918, 3);
    expect(result.resolvedCountry).toBe("US");
    expect(result.rejectedReason).toBeNull();
  });

  it("accepts a postcode — an area, not a business", async () => {
    const result = await resolveSearchCenter({
      locationText: "33101",
      apiKey: "test-key",
      fetchImpl: fakeFetch(200, POSTCODE_33101),
    });
    expect(result.succeeded).toBe(true);
    expect(result.center).not.toBeNull();
  });

  it("REJECTS a location that resolves to the wrong country, rather than searching it", async () => {
    const result = await resolveSearchCenter({
      locationText: "Springfield",
      apiKey: "test-key",
      fetchImpl: fakeFetch(200, SPRINGFIELD_SCHOOL_KARACHI),
    });
    expect(result.succeeded).toBe(false);
    expect(result.center).toBeNull(); // the critical part: no centre is handed back
    expect(result.resolvedCountry).toBe("PK");
    expect(result.rejectedReason).toMatch(/not US/i);
    expect(result.errorCode).toBeNull(); // nothing failed at the provider — we refused the answer
  });

  it("REJECTS a result that is an establishment even when the country matches", async () => {
    const usBusiness = {
      places: [
        {
          displayName: { text: "Springfield Elementary" },
          formattedAddress: "742 Evergreen Terrace, Springfield, IL, USA",
          addressComponents: [{ shortText: "US", types: ["country", "political"] }],
          location: { latitude: 39.78, longitude: -89.65 },
          types: ["school", "point_of_interest", "establishment"],
        },
      ],
    };
    const result = await resolveSearchCenter({
      locationText: "Springfield Elementary",
      apiKey: "test-key",
      fetchImpl: fakeFetch(200, usBusiness),
    });
    expect(result.succeeded).toBe(false);
    expect(result.center).toBeNull();
    expect(result.rejectedReason).toMatch(/specific business/i);
  });

  it("honours a non-default expectedCountry", async () => {
    const result = await resolveSearchCenter({
      locationText: "Karachi",
      expectedCountry: "PK",
      apiKey: "test-key",
      fetchImpl: fakeFetch(200, {
        places: [
          {
            displayName: { text: "Karachi" },
            formattedAddress: "Karachi, Pakistan",
            addressComponents: [{ shortText: "PK", types: ["country", "political"] }],
            location: { latitude: 24.8607, longitude: 67.0011 },
            types: ["locality", "political"],
          },
        ],
      }),
    });
    expect(result.succeeded).toBe(true);
    expect(result.resolvedCountry).toBe("PK");
  });

  it("reports no match without inventing a centre", async () => {
    const result = await resolveSearchCenter({
      locationText: "asdkjhaskdjh",
      apiKey: "test-key",
      fetchImpl: fakeFetch(200, { places: [] }),
    });
    expect(result.succeeded).toBe(false);
    expect(result.center).toBeNull();
    expect(result.rejectedReason).toMatch(/No place matched/i);
  });

  it("surfaces Google's own message on an auth/billing failure", async () => {
    const msg = "You must enable Billing on the Google Cloud Project";
    const result = await resolveSearchCenter({
      locationText: "Miami, FL",
      apiKey: "test-key",
      fetchImpl: fakeFetch(403, { error: { code: 403, status: "PERMISSION_DENIED", message: msg } }),
    });
    expect(result.succeeded).toBe(false);
    expect(result.providerMessage).toBe(msg);
  });
});
