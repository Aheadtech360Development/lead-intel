import type { PutResult, Storage } from "./index.js";

/**
 * Supabase Storage, over its REST API rather than its SDK.
 *
 * The worker already talks to Postgres directly through Drizzle and has no `@supabase/supabase-js`
 * anywhere; pulling the whole client in to upload a JPEG would add a dependency and a second way of
 * authenticating for the sake of one HTTP call. The REST endpoint is three lines.
 */

export const SCREENSHOT_BUCKET = "page-screenshots";

export function supabaseStorage(params: { url: string; serviceKey: string; bucket?: string }): Storage {
  const bucket = params.bucket ?? SCREENSHOT_BUCKET;
  const base = `${params.url.replace(/\/$/, "")}/storage/v1`;

  /**
   * Works with either kind of Supabase key.
   *
   * Supabase is midway through replacing the JWT-based `service_role` key with a `sb_secret_...`
   * one; the old kind keeps working until the end of 2026, so an operator opening the dashboard
   * today may copy either. The two authenticate differently — the new keys are not JWTs and are
   * rejected on an `Authorization: Bearer` header in some places — so the header is chosen from the
   * key itself rather than assumed.
   *
   * `apikey` is sent for both, because both are accepted there. Telling somebody to fetch a key and
   * then failing because they fetched the newer one would be a poor way to repay the trip.
   */
  const isJwt = params.serviceKey.startsWith("ey");
  const headers: Record<string, string> = isJwt
    ? { authorization: `Bearer ${params.serviceKey}`, apikey: params.serviceKey }
    : { apikey: params.serviceKey };

  return {
    async put(path, body, contentType): Promise<PutResult> {
      try {
        const response = await fetch(`${base}/object/${bucket}/${encodeURI(path)}`, {
          method: "POST",
          headers: {
            ...headers,
            "content-type": contentType,
            // Re-auditing a site replaces its picture rather than leaving one per run behind.
            "x-upsert": "true",
          },
          body: new Uint8Array(body),
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return { ok: false, detail: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }
        return { ok: true, file: { path } };
      } catch (err) {
        // Returned, never thrown. A screenshot that will not upload must not lose the audit it
        // belongs to — the measurements are the valuable part and they are already in hand.
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    },

    async signedUrl(path, seconds) {
      try {
        const response = await fetch(`${base}/object/sign/${bucket}/${encodeURI(path)}`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ expiresIn: seconds }),
        });
        if (!response.ok) return null;
        const body = (await response.json()) as { signedURL?: string };
        return body.signedURL ? `${params.url.replace(/\/$/, "")}/storage/v1${body.signedURL}` : null;
      } catch {
        return null;
      }
    },

    async remove(path) {
      await fetch(`${base}/object/${bucket}/${encodeURI(path)}`, { method: "DELETE", headers }).catch(() => {});
    },
  };
}

/**
 * Where a business's screenshot lives.
 *
 * Business id first so everything about one business sits together and can be removed in one go,
 * and the page type rather than the URL because a URL contains slashes, query strings and
 * characters that would need escaping into something nobody could read in a file listing.
 */
export function screenshotPath(businessId: string, pageType: string): string {
  return `${businessId}/${pageType}.jpg`;
}
