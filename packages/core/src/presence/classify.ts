import type { WebsiteStatus } from "@lead-intel/shared";

/**
 * What the crawler found, reduced to just what classification needs. Deliberately not the
 * provider's own result type: packages/core never imports packages/providers (core stays
 * independent of any one source — apps/jobs is the integration point that knows both).
 */
export interface PresenceEvidence {
  /** Did Google Places list a website for this business? */
  hasWebsiteOnListing: boolean;
  /** The normalised domain we had to try, if any. */
  domain: string | null;
  /** How the homepage fetch ended. Mirrors the crawler's FetchOutcome values. */
  fetchOutcome:
    | "ok"
    | "blocked_by_robots"
    | "dns_failure"
    | "dns_temporary"
    | "tls_failure"
    | "timeout"
    | "http_error"
    | "too_many_redirects"
    | "too_large"
    | "not_html"
    | "fetch_failed"
    /** No fetch was attempted — there was no domain to try. */
    | "not_attempted";
  httpStatus?: number | null;
  /** Where we actually ended up, after redirects. */
  finalUrl?: string | null;
  /** Homepage HTML, present only when the fetch succeeded. */
  html?: string | null;
}

export interface PresenceVerdict {
  status: WebsiteStatus;
  /** Plain-language reason, suitable for showing an operator next to the status. */
  reason: string;
  /** True when a human should look at this rather than trust the verdict. */
  needsManualReview: boolean;
}

/**
 * Decides a business's website presence (spec §4) from crawl evidence. Pure and deterministic —
 * no network, same bar as normalize/ and discovery/.
 *
 * The states this can return are deliberately narrower than §4's five:
 *
 * - `live` and `dead` are decidable from a fetch, so they are decided.
 * - **`no_website` is never returned.** §4 requires all three checks — the Places field, a
 *   Facebook page lookup, and a direct name search — before a business may be called
 *   website-less. Only the first exists today, so a business with no listed website returns
 *   `unclear` with a reason saying so. Returning `no_website` on one check out of three would be
 *   precisely the guess §4 forbids, and "no website" is the most valuable finding in the system —
 *   the one it is most expensive to be wrong about, because someone acts on it in a sales call.
 * - **`social_only` is never returned** for the same reason: it needs the Facebook lookup.
 *
 * Anything that could not be measured lands in `unclear` and is flagged for review. §13: a site
 * we could not read must never be scored as a site with no problems.
 */
export function classifyPresence(evidence: PresenceEvidence): PresenceVerdict {
  if (!evidence.domain) {
    return {
      status: "unclear",
      reason: evidence.hasWebsiteOnListing
        ? "The listing mentioned a website but no usable domain could be read from it."
        : "No website on the Google listing. Confirming there is genuinely none also needs a Facebook check and a name search, which this system cannot do yet — so this is unconfirmed, not a 'no website' lead.",
      needsManualReview: true,
    };
  }

  switch (evidence.fetchOutcome) {
    case "ok": {
      const parked = detectParked(evidence);
      if (parked) {
        return { status: "dead", reason: `The domain resolves but the page is ${parked}.`, needsManualReview: false };
      }
      if (isEffectivelyEmpty(evidence.html ?? "")) {
        // Served a page, but nothing on it. Could be a broken site or a JS-only app we cannot
        // read — genuinely ambiguous, so it goes to a human rather than being called either way.
        return {
          status: "unclear",
          reason: "The page loaded but contained almost no readable content — it may be broken, or built so that its content only appears in a browser.",
          needsManualReview: true,
        };
      }
      return { status: "live", reason: `The site loads (HTTP ${evidence.httpStatus ?? 200}).`, needsManualReview: false };
    }

    case "dns_failure":
      // The strongest dead signal there is: the domain definitively does not resolve.
      return { status: "dead", reason: "The domain does not resolve — there is no server behind it.", needsManualReview: false };

    case "dns_temporary":
      // Name resolution failed temporarily — our resolver, not their domain. Found live: two
      // businesses were recorded dead on this while answering HTTP 200 minutes later. "Dead
      // website" is the most actionable finding this system produces, and it must never be
      // reachable from a fault on our own side of the wire.
      return {
        status: "unclear",
        reason: "The domain could not be looked up — a temporary name-resolution failure on our side, which says nothing about the site. Worth checking again.",
        needsManualReview: true,
      };

    case "http_error": {
      const status = evidence.httpStatus ?? 0;

      // 404/410 are the only statuses that actually say "there is nothing here". Everything else
      // in the 4xx range says something about *us* — that we were refused — and refusal is not
      // evidence about the business.
      if (status === 404 || status === 410) {
        return {
          status: "dead",
          reason: `The homepage returns HTTP ${status} — there is no page at this address.`,
          needsManualReview: false,
        };
      }

      // Being turned away is the single most expensive mistake this function can make. A 403 to
      // an identified crawler is the signature of a bot-blocker (Cloudflare and similar), not of
      // an abandoned site — the first live audit called a working print shop "dead" on exactly
      // this, its robots.txt equally refused, which is the tell. pre-build-risks §2.3: "a blocked
      // fetch is recorded as not measured — never as a pass", and it must not be recorded as a
      // failure of the business either.
      if (status === 401 || status === 403 || status === 429) {
        return {
          status: "unclear",
          reason: `The site refused an automated visit (HTTP ${status}). That usually means bot protection rather than a broken site — open it in a browser to settle it.`,
          needsManualReview: true,
        };
      }

      if (status >= 500) {
        // A 5xx can be a momentary outage. Real, but not proof the site is abandoned.
        return {
          status: "unclear",
          reason: `The server answered with an error (HTTP ${status}). That may be temporary, so this needs a second look.`,
          needsManualReview: true,
        };
      }

      // Any other 4xx on a plain GET of a homepage is odd enough that guessing either way would
      // be worse than admitting we do not know.
      return {
        status: "unclear",
        reason: `The homepage answered with HTTP ${status}, which is not enough to tell whether the site works.`,
        needsManualReview: true,
      };
    }

    case "blocked_by_robots":
      return {
        status: "unclear",
        reason: "The site's robots.txt asks us not to fetch it, so nothing was measured. This is not evidence either way.",
        needsManualReview: true,
      };

    case "tls_failure":
      // The site may well be alive over plain HTTP; the crawler already tried that. Reaching here
      // means neither worked, but a certificate problem is not the same proof as a dead domain.
      return {
        status: "unclear",
        reason: "The certificate could not be validated and the site did not answer over plain HTTP either.",
        needsManualReview: true,
      };

    case "timeout":
      return {
        status: "unclear",
        reason: "The site did not respond in time. That may be a slow server rather than a dead one.",
        needsManualReview: true,
      };

    case "not_html":
      return {
        status: "unclear",
        reason: "The address served something that is not a web page.",
        needsManualReview: true,
      };

    case "too_large":
    case "too_many_redirects":
    case "fetch_failed":
    case "not_attempted":
    default:
      return {
        status: "unclear",
        reason: "The site could not be read, so nothing was measured.",
        needsManualReview: true,
      };
  }
}

/**
 * Hosts that serve registrar parking pages. Matched against the URL we actually ended up at, so
 * a domain that redirects to one of these is caught even though it answered with HTTP 200.
 */
const PARKING_HOSTS = [
  "sedoparking.com",
  "sedo.com",
  "afternic.com",
  "dan.com",
  "undeveloped.com",
  "parkingcrew.net",
  "bodis.com",
  "above.com",
  "domainmarket.com",
  "hugedomains.com",
  "namecheap.com/domains/registration",
  "godaddy.com/forsale",
  "cashparking.com",
];

/**
 * Phrases that only appear on a page whose purpose is selling or holding the domain. Kept
 * deliberately specific: "coming soon" alone is far too common on real small-business sites that
 * are simply thin, and calling those dead would wrongly promote them to a top-priority lead.
 */
const PARKING_PHRASES = [
  "this domain is for sale",
  "buy this domain",
  "the domain name is for sale",
  "domain for sale",
  "this web page is parked",
  "this domain has expired",
  "domain has expired and is pending renewal",
  "website coming soon! please check back",
  "this site is parked",
  "parked free, courtesy of",
  "future home of something quite cool",
  "if you are the owner of this website",
];

/** Returns a short description of why the page looks parked, or null when it does not. */
function detectParked(evidence: PresenceEvidence): string | null {
  const finalUrl = (evidence.finalUrl ?? "").toLowerCase();
  for (const host of PARKING_HOSTS) {
    if (finalUrl.includes(host)) return `a parking page (it redirects to ${host})`;
  }

  const text = stripHtml(evidence.html ?? "").toLowerCase();
  for (const phrase of PARKING_PHRASES) {
    if (text.includes(phrase)) return `a parked or for-sale placeholder ("${phrase}")`;
  }

  return null;
}

/**
 * A page with essentially no words. The threshold is low on purpose: this is meant to catch
 * blank or error-stub pages, not to judge a small site as too thin — that is what §5.1's W10
 * ("barely a website") is for, and it is a finding rather than a presence state.
 */
function isEffectivelyEmpty(html: string): boolean {
  if (html.trim().length === 0) return true;
  const text = stripHtml(html).replace(/\s+/g, " ").trim();
  return text.length < 40;
}

/** Crude but sufficient: strips scripts, styles and tags to leave visible text. Nothing here
 *  depends on well-formed HTML, which real sites frequently are not. */
function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}
