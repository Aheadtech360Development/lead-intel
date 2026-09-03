import { describe, expect, it } from "vitest";
import { searchNicheAtPoint } from "./search-text.js";

function fakeFetch(status: number, body: unknown): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response) as typeof fetch;
}

const params = {
  niche: "screen printing",
  center: { lat: 25.7617, lng: -80.1918 },
  radiusMeters: 5000,
  apiKey: "test-key",
};

describe("searchNicheAtPoint", () => {
  it("returns mapped places and nextPageToken on success", async () => {
    const result = await searchNicheAtPoint({
      ...params,
      fetchImpl: fakeFetch(200, {
        places: [
          {
            id: "place1",
            displayName: { text: "Unique Screen Printing" },
            location: { latitude: 25.76, longitude: -80.19 },
          },
        ],
        nextPageToken: "token123",
      }),
    });

    expect(result.attempted).toBe(true);
    expect(result.succeeded).toBe(true);
    expect(result.returnedCount).toBe(1);
    expect(result.places[0]?.business.name).toBe("Unique Screen Printing");
    expect(result.nextPageToken).toBe("token123");
    expect(result.errorCode).toBeNull();
  });

  it("reports zero results as a genuine success, not a failure", async () => {
    const result = await searchNicheAtPoint({
      ...params,
      fetchImpl: fakeFetch(200, { places: [] }),
    });
    expect(result.succeeded).toBe(true);
    expect(result.returnedCount).toBe(0);
    expect(result.errorCode).toBeNull();
  });

  it("maps 429 to PROVIDER_RATE_LIMITED without conflating it with a zero-result search", async () => {
    const result = await searchNicheAtPoint({
      ...params,
      fetchImpl: fakeFetch(429, { error: { code: 429, status: "RESOURCE_EXHAUSTED" } }),
    });
    expect(result.succeeded).toBe(false);
    expect(result.returnedCount).toBe(0);
    expect(result.errorCode).toBe("PROVIDER_RATE_LIMITED");
  });

  it("maps a 403 RESOURCE_EXHAUSTED body to PROVIDER_QUOTA_EXHAUSTED, the circuit-break signal", async () => {
    const result = await searchNicheAtPoint({
      ...params,
      fetchImpl: fakeFetch(403, { error: { code: 403, status: "RESOURCE_EXHAUSTED" } }),
    });
    expect(result.errorCode).toBe("PROVIDER_QUOTA_EXHAUSTED");
  });

  it("preserves Google's nested error.message so a failed cell is diagnosable later", async () => {
    const googleText = "Places API (New) has not been used in project 123 before or it is disabled.";
    const result = await searchNicheAtPoint({
      ...params,
      fetchImpl: fakeFetch(403, {
        error: { code: 403, status: "PERMISSION_DENIED", message: googleText },
      }),
    });
    expect(result.succeeded).toBe(false);
    expect(result.providerMessage).toBe(googleText);
  });

  it("maps 401/UNAUTHENTICATED to PROVIDER_AUTH_FAILED", async () => {
    const result = await searchNicheAtPoint({
      ...params,
      fetchImpl: fakeFetch(401, { error: { code: 401, status: "UNAUTHENTICATED" } }),
    });
    expect(result.errorCode).toBe("PROVIDER_AUTH_FAILED");
  });

  it("marks a response that fails schema validation as PROVIDER_SCHEMA_INVALID, not a pass", async () => {
    const result = await searchNicheAtPoint({
      ...params,
      fetchImpl: fakeFetch(200, { places: [{ id: 123 }] }), // id should be a string
    });
    expect(result.succeeded).toBe(false);
    expect(result.errorCode).toBe("PROVIDER_SCHEMA_INVALID");
  });

  it("sends the niche, location bias circle, and field mask in the request", async () => {
    let capturedUrl: string | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200, json: async () => ({ places: [] }) } as Response;
    }) as typeof fetch;

    await searchNicheAtPoint({ ...params, fetchImpl });

    expect(capturedUrl).toBe("https://places.googleapis.com/v1/places:searchText");
    expect(capturedInit?.headers).toMatchObject({
      "X-Goog-Api-Key": "test-key",
      "X-Goog-FieldMask": expect.stringContaining("places.websiteUri"),
    });
    const body = JSON.parse(capturedInit?.body as string);
    expect(body.textQuery).toBe("screen printing");
    expect(body.locationBias.circle.center).toEqual({ latitude: 25.7617, longitude: -80.1918 });
    expect(body.locationBias.circle.radius).toBe(5000);
  });
});
