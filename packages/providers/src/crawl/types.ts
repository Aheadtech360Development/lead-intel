/**
 * The result of trying to fetch one page.
 *
 * Deliberately a discriminated union rather than `{ html, error? }`. Spec §13: "A blocked or
 * failed fetch is recorded as *not measured*, never as a pass. Recording a site we could not read
 * as a site with no problems would corrupt the score that decides where the money goes, and it
 * would do it silently." A shape where the caller can reach for `.html` without first handling
 * the failure is a shape that invites exactly that silence — here, `html` does not exist unless
 * the fetch actually succeeded.
 */
export type FetchOutcome =
  | "ok"
  /** robots.txt forbids us this URL. Their site, their rules — recorded, never worked around. */
  | "blocked_by_robots"
  /**
   * The domain definitively does not resolve — NXDOMAIN. Strong evidence about the business, not
   * a crawler fault, and the only DNS outcome allowed to mean "dead".
   */
  | "dns_failure"
  /**
   * Name resolution failed *temporarily* — `EAI_AGAIN`, the resolver itself being unreachable.
   * This says nothing whatsoever about the domain, and keeping it apart from `dns_failure` is not
   * pedantry: a flaky local network was marking working sites dead, which is the single most
   * actionable and most expensive finding this system produces. Verified live — two businesses
   * recorded as dead were answering HTTP 200 minutes later.
   */
  | "dns_temporary"
  /** TLS handshake failed — no certificate, expired, or a name mismatch. */
  | "tls_failure"
  /** No response within the policy timeout. */
  | "timeout"
  /** Responded, but with 4xx/5xx. */
  | "http_error"
  /** Redirected in a loop, or past the redirect cap. */
  | "too_many_redirects"
  /** Body exceeded the size cap before we stopped reading. */
  | "too_large"
  /** Responded with something that is not a web page (PDF, image, JSON...). */
  | "not_html"
  /** Anything the branches above do not cover. Never assume it means the site is fine. */
  | "fetch_failed";

export interface FetchPageSuccess {
  outcome: "ok";
  /** The URL actually served, after any redirects — not the one we asked for. */
  finalUrl: string;
  status: number;
  html: string;
  /**
   * The `X-Robots-Tag` response header, verbatim, or null when absent. Kept because it is the
   * *other* half of §5.3's S13 ("search engines blocked"): a site can carry no `noindex` anywhere
   * in its HTML and still be de-indexed entirely by this header, and a checker that only reads
   * the markup would call that site fine.
   */
  xRobotsTag: string | null;
  /** True when the final URL's host differs from the requested one. */
  redirected: boolean;
  elapsedMs: number;
}

export interface FetchPageFailure {
  outcome: Exclude<FetchOutcome, "ok">;
  finalUrl: string | null;
  /** Present for http_error; absent when nothing was ever served. */
  status: number | null;
  /** Whatever the runtime told us. Kept verbatim — the same reasoning as providerMessage on the
   *  Places adapters: a category tells you the kind of failure, the message tells you which one. */
  detail: string | null;
  elapsedMs: number;
}

export type FetchPageResult = FetchPageSuccess | FetchPageFailure;

/** Narrowing helper so call sites read as intent rather than string comparison. */
export function isFetchOk(result: FetchPageResult): result is FetchPageSuccess {
  return result.outcome === "ok";
}
