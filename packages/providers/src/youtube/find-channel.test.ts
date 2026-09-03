import { describe, expect, it } from "vitest";
import { findYouTubeChannel, isYouTubeOk } from "./find-channel.js";

/**
 * Answers each successive call with the next queued response.
 *
 * The adapter makes up to three: `search` to find the channel (100 quota units), then
 * `channels` and `playlistItems` to read its newest upload (1 unit each). The second and third
 * replaced a second `search`, which cost as much as the first and halved how many businesses a
 * day's quota could cover.
 */
function respondInOrder(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let call = 0;
  return (async () => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return {
      ok: (next?.status ?? 500) >= 200 && (next?.status ?? 500) < 300,
      status: next?.status ?? 500,
      json: async () => next?.body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

const CHANNEL_HIT = {
  items: [{ id: { channelId: "UC123" }, snippet: { channelTitle: "Acme Printing", title: "Acme Printing" } }],
};
const UPLOADS_PLAYLIST = {
  items: [{ contentDetails: { relatedPlaylists: { uploads: "UU123" } } }],
};
/**
 * A playlist item's `id` is a **string**, where a search result's is an object. Reusing the search
 * schema here made every parse fail silently, so every channel came back "has never posted" —
 * verified wrong against a live channel whose newest upload was that same week. This fixture keeps
 * the real shape so the two can never be confused again.
 */
const VIDEO_HIT = {
  items: [{ id: "UUxxxx.abcdef", snippet: { title: "Our new press", publishedAt: "2026-03-14T10:00:00Z" } }],
};

describe("findYouTubeChannel — a channel that exists", () => {
  it("returns the channel and when it last posted", async () => {
    const result = await findYouTubeChannel({
      businessName: "Acme Printing",
      city: "Miami",
      apiKey: "k",
      fetchImpl: respondInOrder([
        { status: 200, body: CHANNEL_HIT },
        { status: 200, body: UPLOADS_PLAYLIST },
        { status: 200, body: VIDEO_HIT },
      ]),
    });

    expect(isYouTubeOk(result)).toBe(true);
    if (!isYouTubeOk(result)) return;
    expect(result.channelId).toBe("UC123");
    expect(result.channelTitle).toBe("Acme Printing");
    expect(result.latestVideoAt).toBe("2026-03-14T10:00:00Z");
  });

  /** A channel with nothing on it is a real state, and a very tellable one on a sales call. */
  it("reports a channel that has never posted", async () => {
    const result = await findYouTubeChannel({
      businessName: "Acme",
      apiKey: "k",
      fetchImpl: respondInOrder([
        { status: 200, body: CHANNEL_HIT },
        { status: 200, body: UPLOADS_PLAYLIST },
        { status: 200, body: { items: [] } },
      ]),
    });
    expect(isYouTubeOk(result)).toBe(true);
    if (!isYouTubeOk(result)) return;
    expect(result.latestVideoAt).toBeNull();
  });

  /** A channel with no uploads playlist at all is still a channel — not an error. */
  it("reports a channel whose uploads playlist is missing", async () => {
    const result = await findYouTubeChannel({
      businessName: "Acme",
      apiKey: "k",
      fetchImpl: respondInOrder([
        { status: 200, body: CHANNEL_HIT },
        { status: 200, body: { items: [] } },
      ]),
    });
    expect(isYouTubeOk(result)).toBe(true);
    if (!isYouTubeOk(result)) return;
    expect(result.channelId).toBe("UC123");
    expect(result.latestVideoAt).toBeNull();
  });
});

describe("findYouTubeChannel — no channel is a finding, not a failure", () => {
  it("says so plainly when nothing matches", async () => {
    const result = await findYouTubeChannel({
      businessName: "Acme",
      apiKey: "k",
      fetchImpl: respondInOrder([{ status: 200, body: { items: [] } }]),
    });
    expect(result.outcome).toBe("no_channel");
    expect(isYouTubeOk(result)).toBe(false);
  });
});

describe("findYouTubeChannel — failures are never a result", () => {
  /**
   * Separated from every other 403 for the same reason it is on the PageSpeed adapter: it is a
   * setup step nobody has clicked yet, not a revoked key, and the two send you somewhere very
   * different.
   */
  it("recognises an API that has not been switched on", async () => {
    const result = await findYouTubeChannel({
      businessName: "Acme",
      apiKey: "k",
      fetchImpl: respondInOrder([
        {
          status: 403,
          body: { error: { message: "YouTube Data API v3 has not been used in project 918911905442 before or it is disabled." } },
        },
      ]),
    });
    expect(result.outcome).toBe("not_enabled");
    if (isYouTubeOk(result)) return;
    expect(result.providerMessage).toContain("918911905442");
  });

  /** One means stop; the other means this business. */
  it("keeps a spent daily quota apart from an auth problem", async () => {
    const quota = await findYouTubeChannel({
      businessName: "Acme",
      apiKey: "k",
      fetchImpl: respondInOrder([
        { status: 403, body: { error: { message: "quota", errors: [{ reason: "quotaExceeded" }] } } },
      ]),
    });
    expect(quota.outcome).toBe("quota_exhausted");

    const auth = await findYouTubeChannel({
      businessName: "Acme",
      apiKey: "k",
      fetchImpl: respondInOrder([{ status: 401, body: { error: { message: "bad key" } } }]),
    });
    expect(auth.outcome).toBe("auth_failed");
  });

  it("refuses a body that is not the shape we expect", async () => {
    const result = await findYouTubeChannel({
      businessName: "Acme",
      apiKey: "k",
      fetchImpl: respondInOrder([{ status: 200, body: { items: "not an array" } }]),
    });
    expect(result.outcome).toBe("invalid_response");
  });

  it("reports a thrown network error rather than letting it escape", async () => {
    const boom = (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const result = await findYouTubeChannel({ businessName: "Acme", apiKey: "k", fetchImpl: boom });
    expect(result.outcome).toBe("failed");
  });

  /** The invariant, restated for this provider: no failure path may look like a channel. */
  it("NO failure path ever yields a channel", async () => {
    const failures: Array<{ status: number; body: unknown }> = [
      { status: 400, body: { error: { message: "bad request" } } },
      { status: 401, body: {} },
      { status: 403, body: { error: { message: "denied" } } },
      { status: 429, body: {} },
      { status: 500, body: {} },
    ];
    for (const failure of failures) {
      const result = await findYouTubeChannel({
        businessName: "Acme",
        apiKey: "k",
        fetchImpl: respondInOrder([failure]),
      });
      expect(isYouTubeOk(result), `HTTP ${failure.status}`).toBe(false);
      expect(result).not.toHaveProperty("channelId");
    }
  });
});
