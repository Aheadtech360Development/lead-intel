import { z } from "zod";
import { getGooglePlacesApiKey } from "../config.js";

/**
 * YouTube, for §5.5's O8 ("No video content").
 *
 * The one social platform this system can read honestly. §5.5's own table calls YouTube
 * "Reliable — official free API", and it is the only entry there that does not need an app review
 * or a paid reseller: the same Google Cloud project and the same key already in use, plus one
 * API to enable.
 *
 * Facebook and Instagram activity (O3, O5, O7) are deliberately absent. Reading another account's
 * posts needs a Facebook app with Page Public Content Access — 60+ days of review, frequently
 * refused — and the market's largest LinkedIn equivalent was sued out of existence in July 2025.
 * Those checks stay `not_measured` with that reason rather than being half-built.
 */

export type YouTubeOutcome =
  | "ok"
  /** Searched, and this business has no channel we could find. A real finding, not a failure. */
  | "no_channel"
  | "not_enabled"
  | "quota_exhausted"
  | "auth_failed"
  | "invalid_response"
  | "timeout"
  | "failed";

export interface YouTubeChannelFound {
  outcome: "ok";
  channelId: string;
  channelTitle: string;
  /** When the most recent video was published, or null when the channel has never posted. */
  latestVideoAt: string | null;
  latestVideoTitle: string | null;
  elapsedMs: number;
}

export interface YouTubeFailure {
  outcome: Exclude<YouTubeOutcome, "ok">;
  status: number | null;
  /** Google's own error.message, verbatim — the Phase 3 Geocoding lesson, kept. */
  providerMessage: string | null;
  detail: string | null;
  elapsedMs: number;
}

export type YouTubeResult = YouTubeChannelFound | YouTubeFailure;

export function isYouTubeOk(result: YouTubeResult): result is YouTubeChannelFound {
  return result.outcome === "ok";
}

export const YOUTUBE_TIMEOUT_MS = 15_000;

const SearchResponse = z.object({
  items: z
    .array(
      z.object({
        id: z.object({ channelId: z.string().optional(), videoId: z.string().optional() }).optional(),
        snippet: z
          .object({ title: z.string().optional(), channelTitle: z.string().optional(), publishedAt: z.string().optional() })
          .optional(),
      }),
    )
    .default([]),
});

/**
 * Finds a business's YouTube channel and when it last posted.
 *
 * Two calls: one to find the channel by name, one to read its most recent upload. Both are free
 * and both count against the same daily quota, which is generous — but `quota_exhausted` is kept
 * apart from every other failure because it means *stop*, where the others mean *this business*.
 *
 * Matching a channel to a business by name is inherently uncertain — "Miami Printing" could be
 * anyone's channel. The caller decides what to do with that; this adapter returns what it found
 * and its title, so a wrong match is visible rather than silent.
 */
export async function findYouTubeChannel(params: {
  businessName: string;
  /** Narrows the search, since a business name alone is rarely unique. */
  city?: string | null;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<YouTubeResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const startedAt = Date.now();

  const fail = (outcome: Exclude<YouTubeOutcome, "ok">, extra: Partial<YouTubeFailure> = {}): YouTubeResult => ({
    outcome,
    status: null,
    providerMessage: null,
    detail: null,
    elapsedMs: Date.now() - startedAt,
    ...extra,
  });

  let apiKey: string;
  try {
    apiKey = params.apiKey ?? getGooglePlacesApiKey();
  } catch (err) {
    return fail("auth_failed", { detail: err instanceof Error ? err.message : String(err) });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? YOUTUBE_TIMEOUT_MS);

  try {
    const query = [params.businessName, params.city].filter(Boolean).join(" ");
    const channel = await search(fetchImpl, apiKey, controller.signal, { q: query, type: "channel" });
    if ("error" in channel) return fail(channel.outcome, channel);

    const first = channel.items[0];
    const channelId = first?.id?.channelId;
    if (!channelId) {
      return fail("no_channel", { detail: `No YouTube channel found for "${query}".` });
    }

    // The channel's most recent upload, via its uploads playlist rather than a second search.
    //
    // This is a quota decision, and the quota is the binding constraint on this check. YouTube
    // gives 10,000 units a day and charges **100 units for every `search.list`** — but only 1 unit
    // each for `channels.list` and `playlistItems.list`. Asking `search` for the latest video cost
    // as much as finding the channel did, halving how many businesses a day could cover. Two
    // one-unit calls return the same answer, so a day now reaches roughly 100 businesses instead
    // of 50, and O8 finishes across the whole list in days rather than a week.
    const latest = await latestUpload(fetchImpl, apiKey, controller.signal, channelId);
    if (latest && "error" in latest) return fail(latest.outcome, latest);

    return {
      outcome: "ok",
      channelId,
      channelTitle: first?.snippet?.channelTitle ?? first?.snippet?.title ?? query,
      latestVideoAt: latest?.publishedAt ?? null,
      latestVideoTitle: latest?.title ?? null,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return fail("timeout", { detail: `no response within ${params.timeoutMs ?? YOUTUBE_TIMEOUT_MS}ms` });
    }
    return fail("failed", { detail: err instanceof Error ? err.message : String(err) });
  } finally {
    clearTimeout(timer);
  }
}

type SearchOk = z.infer<typeof SearchResponse>;
type SearchErr = { error: true; outcome: Exclude<YouTubeOutcome, "ok">; status: number | null; providerMessage: string | null; detail: string | null };

/** `"error" in body` cannot narrow a `Record<string, unknown>`, which may carry any key. */
function isErr(value: Record<string, unknown> | SearchErr): value is SearchErr {
  return value.error === true;
}

/**
 * The channel's newest upload, at 2 quota units instead of 100.
 *
 * Returns null — not an error — when the channel has no uploads playlist or the playlist is
 * empty. A channel that exists and has never posted is a genuine answer to O8's question, and
 * one worth telling apart from a lookup that failed.
 */
async function latestUpload(
  fetchImpl: typeof fetch,
  apiKey: string,
  signal: AbortSignal,
  channelId: string,
): Promise<{ publishedAt: string | null; title: string | null } | SearchErr | null> {
  const channel = await call(fetchImpl, apiKey, signal, "channels", {
    part: "contentDetails",
    id: channelId,
  });
  if (isErr(channel)) return channel;

  const uploads = ChannelsResponse.safeParse(channel);
  const playlistId = uploads.success ? uploads.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads : undefined;
  if (!playlistId) return null;

  const items = await call(fetchImpl, apiKey, signal, "playlistItems", {
    part: "snippet",
    playlistId,
    maxResults: "1",
  });
  if (isErr(items)) return items;

  // Its own schema, not `SearchResponse`. A search result's `id` is an object
  // (`{ channelId }` / `{ videoId }`); a playlist item's `id` is a **string**. Reusing the search
  // schema made every parse fail, and because a failed parse yields no snippet, every business
  // with a channel came back "has a channel but has never posted" — a false statement about the
  // one thing O8 exists to report. Caught on live data: Crystal DTF's newest upload is
  // 2026-08-26 and the adapter was returning null for it.
  const parsed = PlaylistItemsResponse.safeParse(items);
  const snippet = parsed.success ? parsed.data.items?.[0]?.snippet : undefined;
  return { publishedAt: snippet?.publishedAt ?? null, title: snippet?.title ?? null };
}

async function search(
  fetchImpl: typeof fetch,
  apiKey: string,
  signal: AbortSignal,
  query: Record<string, string>,
): Promise<SearchOk | SearchErr> {
  const body = await call(fetchImpl, apiKey, signal, "search", { part: "snippet", ...query });
  if (isErr(body)) return body;

  const parsed = SearchResponse.safeParse(body);
  if (!parsed.success) {
    return {
      error: true,
      outcome: "invalid_response",
      status: 200,
      providerMessage: null,
      detail: parsed.error.message.slice(0, 300),
    };
  }
  return parsed.data;
}

/** One request to any YouTube endpoint, with the shared error classification. */
async function call(
  fetchImpl: typeof fetch,
  apiKey: string,
  signal: AbortSignal,
  endpoint: "search" | "channels" | "playlistItems",
  query: Record<string, string>,
): Promise<Record<string, unknown> | SearchErr> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  url.searchParams.set("key", apiKey);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

  const response = await fetchImpl(url.toString(), { method: "GET", signal });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const error = (body as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null)?.error;
    const message = error?.message ?? "";
    const reason = error?.errors?.[0]?.reason ?? "";
    return {
      error: true,
      // "Not enabled" separated from every other 403 for the same reason it is on PageSpeed: it is
      // a setup step nobody has clicked, not a revoked key, and the two send you to very
      // different places.
      outcome: /has not been used in project|is disabled/i.test(message)
        ? "not_enabled"
        : /quotaExceeded|dailyLimitExceeded/i.test(reason) || response.status === 429
          ? "quota_exhausted"
          : response.status === 401 || response.status === 403
            ? "auth_failed"
            : "failed",
      status: response.status,
      providerMessage: message || null,
      detail: reason || null,
    };
  }

  // Shape-checking belongs to the caller: `search`, `channels` and `playlistItems` return
  // different documents, and this function's job is the request and its failure classification.
  return (body ?? {}) as Record<string, unknown>;
}

const PlaylistItemsResponse = z.object({
  items: z
    .array(z.object({ snippet: z.object({ title: z.string().optional(), publishedAt: z.string().optional() }).optional() }))
    .optional(),
});

const ChannelsResponse = z.object({
  items: z
    .array(z.object({ contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string().optional() }).optional() }).optional() }))
    .optional(),
});
