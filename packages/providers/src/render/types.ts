/**
 * What a rendered page gives back.
 *
 * The shape is the same discriminated union every other adapter here uses, and for the same reason:
 * a failure must never be readable as an empty page. That distinction matters more with a browser
 * than with plain HTTP, because a browser *always* produces a document — a timeout leaves a
 * half-built DOM, a JavaScript error leaves a blank body, and both look exactly like a site with
 * nothing on it if the caller is handed HTML and no outcome.
 */

export type RenderOutcome =
  | "ok"
  /** The navigation itself failed — DNS, TLS, connection refused. */
  | "unreachable"
  /** A response arrived with a status we will not read. */
  | "http_error"
  /** The page did not settle within the budget. Whatever loaded is discarded, not guessed at. */
  | "timeout"
  /** robots.txt disallows this path. Checked before the browser is pointed at anything. */
  | "blocked_by_robots"
  /** The browser could not be started, or died mid-page. A fact about us, not about them. */
  | "browser_failed"
  /**
   * It loaded, and we chose not to keep it. Also a fact about us.
   *
   * Kept apart from `http_error` deliberately: this page answered 200 in three seconds, and
   * labelling that an HTTP error told the operator their prospect's server was broken.
   */
  | "too_big";

export interface RenderedPage {
  outcome: RenderOutcome;
  url: string;
  /** Where the browser ended up. Redirects are followed, so this may differ from `url`. */
  finalUrl: string | null;
  status: number | null;
  /**
   * The DOM after JavaScript has run — the whole point of this adapter.
   *
   * Null unless the outcome is `ok`. A partial document from a timed-out page is worse than
   * nothing: it parses, it produces findings, and every one of them is a claim about a page that
   * never finished loading.
   */
  html: string | null;
  /** WebP, base64. Only captured when the caller asks, because most pages are read and discarded. */
  screenshot: string | null;
  /** Errors the page's own scripts threw. Evidence of a broken site, and free to collect. */
  consoleErrors: string[];
  /**
   * Requests the page made that failed — dead images, 404 scripts, missing fonts.
   *
   * New information this project has never had. A visitor sees these as broken pictures and missing
   * styling, and no amount of reading the HTML reveals them.
   */
  failedRequests: { url: string; reason: string }[];
  /**
   * Measurements only a rendered page can give.
   *
   * Everything else here could be had from the HTML. These cannot: whether the phone number is
   * visible without scrolling depends on where the browser actually put it, and a page that scrolls
   * sideways on a phone is broken in a way no amount of reading the markup reveals. Null when the
   * page did not render.
   */
  layout: LayoutFacts | null;
  /** How long the page took to become usable, in milliseconds. */
  elapsedMs: number;
  /** A sentence for the operator when the outcome is not `ok`. Null when it is. */
  detail: string | null;
}

export interface LayoutFacts {
  /** The viewport the measurements were taken at, so a mobile reading is never mistaken for desktop. */
  viewportWidth: number;
  /** How far the page scrolls. A very long home page is a different problem from a very short one. */
  documentHeight: number;
  /**
   * True when the page is wider than its own viewport — the reader has to scroll sideways to read.
   * On a phone this is the single most visible sign of a site that was never tested on one.
   */
  scrollsSideways: boolean;
  /** Whether a header, main and footer landmark actually render, rather than merely existing in markup. */
  hasHeader: boolean;
  hasFooter: boolean;
  /** A phone link the visitor can see without scrolling. The first thing a caller wants to know. */
  phoneAboveFold: boolean;
  /** A call to action visible without scrolling, and what it says. */
  ctaAboveFold: string | null;
  /** Text smaller than 12px anywhere with real content in it — unreadable on a phone. */
  tinyTextCount: number;
  /** Tap targets under 32px square. Fingers are about 40px wide. */
  smallTapTargets: number;
  /** Images that rendered at zero size — broken, however fine the markup looks. */
  brokenImages: number;
}

export function isRenderOk(page: RenderedPage): page is RenderedPage & { html: string } {
  return page.outcome === "ok" && page.html !== null;
}

/**
 * Outcomes that mean *stop this site*, rather than *skip this page*.
 *
 * A browser that will not start will not start for the next page either, and a site that refuses
 * the connection refuses it at every path. Carrying on would spend the page budget learning the
 * same thing five more times.
 */
export function isFatalForSite(outcome: RenderOutcome): boolean {
  return outcome === "browser_failed" || outcome === "unreachable";
}
