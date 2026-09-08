/**
 * Somewhere to put screenshots.
 *
 * Three methods, and that is the whole interface. It exists because the operator asked what happens
 * when Supabase's free gigabyte runs out — the answer is that moving to Cloudflare R2 or Backblaze
 * should touch one file, not every caller. Keeping the surface this small is what makes that true:
 * anything richer (signed URLs with options, listing, metadata) would be a Supabase shape that the
 * next provider does not have.
 *
 * At today's rate — a home page and, for the roughly one business in nine that sells online, a
 * product page — the whole list is about 80 MB of the free gigabyte. The move is a long way off.
 * The adapter is here so that when it comes it is an afternoon rather than a rewrite.
 */

export interface StoredFile {
  /** The path the caller stores and later reads back. Never a URL: URLs expire, paths do not. */
  path: string;
}

export type PutResult = { ok: true; file: StoredFile } | { ok: false; detail: string };

export interface Storage {
  /** Writes, replacing anything already at that path. */
  put(path: string, body: Buffer, contentType: string): Promise<PutResult>;
  /** A URL the browser can load, valid for a while. Null when it cannot be produced. */
  signedUrl(path: string, seconds: number): Promise<string | null>;
  remove(path: string): Promise<void>;
}

export * from "./supabase.js";
