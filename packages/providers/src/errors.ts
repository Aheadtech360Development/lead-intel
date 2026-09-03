import type { ErrorCode } from "@lead-intel/shared";

interface GoogleApiErrorBody {
  error?: { code?: number; message?: string; status?: string };
}

/**
 * Maps a failed Places API (New) HTTP response to this project's ErrorCode enum, so
 * provider_calls carries the same vocabulary regardless of source. Google's error envelope is
 * `{ error: { code, message, status } }`; `status` is the gRPC-style string ("UNAUTHENTICATED",
 * "RESOURCE_EXHAUSTED", ...). Distinguishing 429 (short-term rate limit, retry-able) from a 403
 * RESOURCE_EXHAUSTED (the daily quota cap set in Cloud Console, per pre-build-risks-and-api-
 * limits.md §0 — a circuit-break signal, not a retry one) matters because build guide §16 halts
 * the whole provider on PROVIDER_QUOTA_EXHAUSTED but not on PROVIDER_RATE_LIMITED.
 */
export function mapPlacesHttpError(httpStatus: number, body: unknown): ErrorCode {
  const status = (body as GoogleApiErrorBody | null)?.error?.status;

  if (httpStatus === 429) return "PROVIDER_RATE_LIMITED";
  if (httpStatus === 401 || status === "UNAUTHENTICATED") return "PROVIDER_AUTH_FAILED";
  if (httpStatus === 403) {
    return status === "RESOURCE_EXHAUSTED" ? "PROVIDER_QUOTA_EXHAUSTED" : "PROVIDER_AUTH_FAILED";
  }
  if (status === "RESOURCE_EXHAUSTED") return "PROVIDER_QUOTA_EXHAUSTED";
  return "INTERNAL";
}
