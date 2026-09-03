import {
  CRAWLER_USER_AGENT,
  MAX_REDIRECTS,
  MAX_RESPONSE_BYTES,
  REQUEST_TIMEOUT_MS,
} from "./policy.js";
import type { FetchOutcome, FetchPageResult } from "./types.js";

export interface FetchPageParams {
  url: string;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Fetches one page under the spec §13 crawl rules. GET only — never a POST, never a form
 * submission, never credentials, so there is no code path by which this can act on a site rather
 * than read it.
 *
 * Every failure gets its own outcome. Nothing is swallowed into a generic error and nothing is
 * ever returned in a shape a caller can mistake for success, because §13's whole point is that a
 * site we could not read must never score as a site with no problems.
 */
/**
 * Retries a page once when name resolution fails *temporarily*.
 *
 * This is not a network nicety, it is the single largest source of wrong answers this system has
 * had. Three separate audit runs on the operator's machine returned `dns_temporary` for 112, 67
 * and then 124 of a few hundred businesses — the home resolver buckling under concurrent lookups,
 * never the sites. Each time it took manual re-runs at falling concurrency to clear, and each time
 * the intervening state of the app showed hundreds of businesses as unreadable.
 *
 * Only `dns_temporary` is retried, and only once. A `dns_failure` is a real answer about a real
 * domain and repeating it would just be slower; an HTTP error is the server's considered reply.
 * The delay is deliberately longer than a resolver's own internal retry, which is what makes the
 * second attempt worth anything.
 */
const DNS_RETRY_DELAY_MS = 1_500;

export async function fetchPage(params: FetchPageParams): Promise<FetchPageResult> {
  const first = await fetchPageOnce(params);
  if (first.outcome !== "dns_temporary") return first;

  await new Promise((resolve) => setTimeout(resolve, DNS_RETRY_DELAY_MS));
  const second = await fetchPageOnce(params);

  // The retry's answer wins unless it failed the same way, in which case the first result already
  // says everything true that can be said: the name did not resolve, and we do not know why.
  return second.outcome === "dns_temporary" ? first : second;
}

async function fetchPageOnce(params: FetchPageParams): Promise<FetchPageResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const timeoutMs = params.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const maxBytes = params.maxBytes ?? MAX_RESPONSE_BYTES;
  const startedAt = Date.now();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const fail = (outcome: Exclude<FetchOutcome, "ok">, extra: Partial<FetchPageResult> = {}): FetchPageResult =>
    ({
      outcome,
      finalUrl: null,
      status: null,
      detail: null,
      elapsedMs: Date.now() - startedAt,
      ...extra,
    }) as FetchPageResult;

  let requestUrl: URL;
  try {
    requestUrl = new URL(params.url);
  } catch {
    clearTimeout(timer);
    return fail("fetch_failed", { detail: `not a usable URL: ${params.url}` });
  }
  if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") {
    clearTimeout(timer);
    return fail("fetch_failed", { detail: `unsupported protocol: ${requestUrl.protocol}` });
  }

  try {
    const response = await fetchImpl(requestUrl.toString(), {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": CRAWLER_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        // No cookies, no auth, no referer. Nothing that could look like a signed-in visitor.
      },
      signal: controller.signal,
    });

    const finalUrl = response.url || requestUrl.toString();

    if (!response.ok) {
      return fail("http_error", {
        finalUrl,
        status: response.status,
        detail: response.statusText || null,
      });
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      return fail("not_html", { finalUrl, status: response.status, detail: contentType });
    }

    // Check the declared length before reading, so an oversized body is refused rather than
    // downloaded and then discarded.
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      return fail("too_large", {
        finalUrl,
        status: response.status,
        detail: `content-length ${declaredLength} exceeds ${maxBytes}`,
      });
    }

    const html = await response.text();
    // A server may omit or understate content-length, so the real body is checked too.
    if (html.length > maxBytes) {
      return fail("too_large", {
        finalUrl,
        status: response.status,
        detail: `body ${html.length} exceeds ${maxBytes}`,
      });
    }

    return {
      outcome: "ok",
      finalUrl,
      status: response.status,
      html,
      xRobotsTag: response.headers.get("x-robots-tag"),
      redirected: safeHost(finalUrl) !== requestUrl.host,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return fail(classifyFetchError(err), { detail: err instanceof Error ? err.message : String(err) });
  } finally {
    clearTimeout(timer);
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Maps a thrown fetch error to an outcome. Undici (Node's fetch) reports the useful part as a
 * `cause` with a libuv/OpenSSL code, so the chain is walked rather than only the top message
 * read — the same lesson as packages/db's describeDbError, where checking only the outer error
 * silently lost the reason.
 */
export function classifyFetchError(err: unknown): Exclude<FetchOutcome, "ok"> {
  if (err instanceof Error && err.name === "AbortError") return "timeout";

  const codes: string[] = [];
  const messages: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    if (typeof current === "object") {
      const e = current as { code?: unknown; message?: unknown };
      if (typeof e.code === "string") codes.push(e.code);
      if (typeof e.message === "string") messages.push(e.message);
    }
    current = (current as { cause?: unknown })?.cause;
  }
  const haystack = [...codes, ...messages].join(" ");

  // EAI_AGAIN is checked FIRST and separately. It is glibc's "temporary failure in name
  // resolution" — the resolver could not be reached — and it tells us nothing about the domain.
  // Folding it in with ENOTFOUND meant a flaky local network produced "this business's website is
  // dead", the strongest and most actionable finding in the system. Two businesses were recorded
  // dead on it while answering HTTP 200.
  if (/EAI_AGAIN|ETIMEDOUT.*getaddrinfo|ESERVFAIL|EREFUSED/i.test(haystack)) return "dns_temporary";
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|ENODATA|NXDOMAIN/i.test(haystack)) return "dns_failure";
  if (/CERT|SSL|TLS|self.signed|ERR_TLS/i.test(haystack)) return "tls_failure";
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|timeout/i.test(haystack)) return "timeout";
  if (/redirect/i.test(haystack)) return "too_many_redirects";
  // ECONNREFUSED / ECONNRESET / EHOSTUNREACH and anything unrecognised land here: the site did
  // not give us a page, and that is all we are entitled to conclude.
  return "fetch_failed";
}

export { MAX_REDIRECTS };
