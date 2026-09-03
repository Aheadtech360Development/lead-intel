import { z } from "zod";
import { getGooglePlacesApiKey } from "../config.js";

/**
 * The fields this adapter asks for, and **only** these.
 *
 * The field mask is what Google bills on, so it is not a convenience — a mask that asks for more
 * than the checks read is money spent on nothing. Every entry below is consumed by a check in
 * §5.3 or §5.4; nothing is requested "in case it is useful later".
 *
 * `photos` and `reviews` are deliberately **absent**, and that was established by measurement
 * rather than assumption: requested against three of our own businesses and then against a
 * Starbucks with 2,243 ratings, this project's key returns HTTP 200 with an empty body for both
 * every time. No error, no message — Google simply omits them. Asking for a field that never
 * arrives would risk paying for a higher SKU and getting nothing, so the checks that need them
 * (S4, R3, R4, R5) report themselves unmeasured instead.
 */
export const PLACE_DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "businessStatus",
  "primaryType",
  "types",
  "websiteUri",
  "regularOpeningHours",
  "rating",
  "userRatingCount",
].join(",");

export const PlaceDetails = z.object({
  id: z.string().optional(),
  displayName: z.object({ text: z.string().optional() }).optional(),
  businessStatus: z.enum(["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"]).optional(),
  primaryType: z.string().optional(),
  types: z.array(z.string()).optional(),
  websiteUri: z.string().optional(),
  regularOpeningHours: z
    .object({
      openNow: z.boolean().optional(),
      weekdayDescriptions: z.array(z.string()).optional(),
      periods: z.array(z.unknown()).optional(),
    })
    .optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
});
export type PlaceDetails = z.infer<typeof PlaceDetails>;

export type PlaceDetailsOutcome =
  | "ok"
  /** Google no longer has this place — the listing is genuinely gone, which is itself a finding. */
  | "not_found"
  | "auth_failed"
  | "quota_exhausted"
  | "rate_limited"
  | "invalid_response"
  | "timeout"
  | "failed";

export interface PlaceDetailsSuccess {
  outcome: "ok";
  details: PlaceDetails;
  elapsedMs: number;
}

export interface PlaceDetailsFailure {
  outcome: Exclude<PlaceDetailsOutcome, "ok">;
  status: number | null;
  /** Google's own error.message, verbatim. */
  providerMessage: string | null;
  detail: string | null;
  elapsedMs: number;
}

export type PlaceDetailsResult = PlaceDetailsSuccess | PlaceDetailsFailure;

export function isPlaceDetailsOk(result: PlaceDetailsResult): result is PlaceDetailsSuccess {
  return result.outcome === "ok";
}

export const PLACE_DETAILS_TIMEOUT_MS = 15_000;

/**
 * Fetches one place's details from Places API (New).
 *
 * **This is a paid call.** Unlike the crawler and PageSpeed, every invocation costs money, which
 * is why §9 puts the Stage 5 gate in front of it: only businesses that already look like they
 * have a problem get bought. Nothing in this file decides who is worth buying — the caller does.
 */
export async function fetchPlaceDetails(params: {
  placeId: string;
  apiKey?: string;
  fieldMask?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<PlaceDetailsResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const startedAt = Date.now();

  const fail = (outcome: Exclude<PlaceDetailsOutcome, "ok">, extra: Partial<PlaceDetailsFailure> = {}): PlaceDetailsResult => ({
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
  const timer = setTimeout(() => controller.abort(), params.timeoutMs ?? PLACE_DETAILS_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`https://places.googleapis.com/v1/places/${encodeURIComponent(params.placeId)}`, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": params.fieldMask ?? PLACE_DETAILS_FIELD_MASK,
      },
      signal: controller.signal,
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const error = (body as { error?: { message?: string; status?: string } } | null)?.error;
      return fail(classify(response.status, error?.status), {
        status: response.status,
        providerMessage: error?.message ?? null,
        detail: error?.status ?? null,
      });
    }

    const parsed = PlaceDetails.safeParse(body);
    if (!parsed.success) {
      return fail("invalid_response", { status: response.status, detail: parsed.error.message.slice(0, 300) });
    }

    return { outcome: "ok", details: parsed.data, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return fail("timeout", { detail: `no response within ${params.timeoutMs ?? PLACE_DETAILS_TIMEOUT_MS}ms` });
    }
    return fail("failed", { detail: err instanceof Error ? err.message : String(err) });
  } finally {
    clearTimeout(timer);
  }
}

/** 429 and a 403 RESOURCE_EXHAUSTED mean different things: one is a short-term rate limit worth
 *  retrying, the other is the daily cap and a reason to stop the whole provider (build guide §16). */
function classify(httpStatus: number, errorStatus: string | undefined): Exclude<PlaceDetailsOutcome, "ok"> {
  if (httpStatus === 404) return "not_found";
  if (httpStatus === 429) return "rate_limited";
  if (errorStatus === "RESOURCE_EXHAUSTED") return "quota_exhausted";
  if (httpStatus === 401 || httpStatus === 403) return "auth_failed";
  if (httpStatus >= 500) return "rate_limited";
  return "failed";
}
