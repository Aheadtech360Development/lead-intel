import { getApifyToken } from "../config.js";

/**
 * Runs one Apify actor and returns its dataset.
 *
 * Apify's `run-sync-get-dataset-items` endpoint starts an actor, waits, and returns the results in
 * a single request — no run id to poll, no webhook to receive. That matters here because every
 * caller in this system is already a job that owns its own concurrency and its own budget; adding
 * a polling loop would put a second, invisible one underneath it.
 *
 * Failures are separated the way every provider in this codebase separates them: a fact about the
 * account (`no_token`, `auth_failed`, `out_of_credit`) is different from a fact about this one
 * lookup (`not_found`, `timeout`), and only the first kind means *stop*. A pass that keeps going
 * after the credit runs out would write "we looked and found nothing" against businesses nobody
 * looked at, and a stored outcome is what marks a business as done.
 */

export type ApifyOutcome =
  | "ok"
  /** The actor ran and returned nothing for this input. A real answer, not a failure. */
  | "not_found"
  | "no_token"
  | "auth_failed"
  /** The account is out of credit or over its plan limit. Stop the whole pass. */
  | "out_of_credit"
  | "rate_limited"
  | "timeout"
  | "failed";

export interface ApifyRunOk<T> {
  outcome: "ok";
  items: T[];
  elapsedMs: number;
}

export interface ApifyRunFailure {
  outcome: Exclude<ApifyOutcome, "ok">;
  status: number | null;
  /** Apify's own error message, verbatim — the same rule the Google adapters follow. */
  providerMessage: string | null;
  detail: string | null;
  elapsedMs: number;
}

export type ApifyRunResult<T> = ApifyRunOk<T> | ApifyRunFailure;

export function isApifyOk<T>(result: ApifyRunResult<T>): result is ApifyRunOk<T> {
  return result.outcome === "ok";
}

/** True when the failure is about the account rather than this input, so the caller must stop. */
export function isApifyFatal(result: ApifyRunResult<unknown>): boolean {
  return (
    result.outcome === "no_token" ||
    result.outcome === "auth_failed" ||
    result.outcome === "out_of_credit" ||
    result.outcome === "rate_limited"
  );
}

/** Actors are slow — they drive a real browser. Well above a page fetch, well below forever. */
export const APIFY_TIMEOUT_MS = 180_000;

export async function runApifyActor<T>(params: {
  /** e.g. "apify~instagram-profile-scraper" — the tilde form Apify's REST API uses. */
  actor: string;
  input: Record<string, unknown>;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<ApifyRunResult<T>> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const startedAt = Date.now();
  const timeoutMs = params.timeoutMs ?? APIFY_TIMEOUT_MS;

  const fail = (outcome: Exclude<ApifyOutcome, "ok">, extra: Partial<ApifyRunFailure> = {}): ApifyRunResult<T> => ({
    outcome,
    status: null,
    providerMessage: null,
    detail: null,
    elapsedMs: Date.now() - startedAt,
    ...extra,
  });

  let token: string;
  try {
    token = params.token ?? getApifyToken();
  } catch (err) {
    return fail("no_token", { detail: err instanceof Error ? err.message : String(err) });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = new URL(`https://api.apify.com/v2/acts/${params.actor}/run-sync-get-dataset-items`);
    // Apify's own timeout, in seconds, so the actor gives up at roughly the same moment we do
    // rather than running on and billing for work nobody is waiting for.
    url.searchParams.set("timeout", String(Math.floor(timeoutMs / 1000)));

    const response = await fetchImpl(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(params.input),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message = (body as { error?: { message?: string; type?: string } } | null)?.error?.message ?? "";
      const type = (body as { error?: { type?: string } } | null)?.error?.type ?? "";
      return fail(
        response.status === 401 || response.status === 403
          ? "auth_failed"
          : response.status === 402 || /usage|credit|limit-exceeded|monthly/i.test(`${type} ${message}`)
            ? "out_of_credit"
            : response.status === 429
              ? "rate_limited"
              : "failed",
        { status: response.status, providerMessage: message || null, detail: type || null },
      );
    }

    const items = (await response.json().catch(() => null)) as T[] | null;
    if (!Array.isArray(items)) {
      return fail("failed", { status: response.status, detail: "the actor did not return a list of results" });
    }
    if (items.length === 0) {
      return fail("not_found", { status: response.status });
    }

    return { outcome: "ok", items, elapsedMs: Date.now() - startedAt };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return fail("timeout", { detail: `no response within ${timeoutMs}ms` });
    }
    return fail("failed", { detail: err instanceof Error ? err.message : String(err) });
  } finally {
    clearTimeout(timer);
  }
}
