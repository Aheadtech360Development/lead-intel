import type { Browser, Page } from "playwright";
import { measureLayout } from "./measure-layout.js";
import type { RenderedPage } from "./types.js";

/**
 * One page, rendered.
 *
 * The browser is passed in rather than created here, because starting Chromium costs about three
 * seconds and a site has several pages. Launching per page would roughly triple the machine time —
 * and machine time is what Trigger.dev bills, by the second.
 */

/** Long enough for a slow site on a slow connection; short enough that one bad page cannot stall a run. */
const NAVIGATION_TIMEOUT_MS = 20_000;

/**
 * How long to wait after navigation for the page to stop changing.
 *
 * `networkidle` is deliberately not used. It waits for 500ms of complete network silence, which
 * many real sites never reach — analytics beacons, chat widgets and ad scripts poll forever, and
 * the wait becomes the timeout on sites that are working perfectly well. `domcontentloaded` plus a
 * short settle catches the JavaScript-rendered content this adapter exists for, without hostage to
 * a marketing pixel.
 */
const SETTLE_MS = 1_500;

/** Beyond this the page is not a small business's website and the extra bytes teach us nothing. */
const MAX_HTML_BYTES = 3_000_000;

/**
 * Request failures that say nothing about the site.
 *
 * `ERR_BLOCKED_BY_ORB` and `ERR_BLOCKED_BY_RESPONSE` are Chromium refusing a cross-origin response
 * on the visitor's behalf — a browser security decision, present on perfectly healthy sites.
 * `ERR_ABORTED` is usually the page cancelling its own analytics beacon on navigation. Counting any
 * of them as a fault would put "fifteen things on your site are broken" in front of an operator
 * about to phone a business whose site is fine.
 *
 * What survives the filter is what a visitor would actually notice: a name that will not resolve, a
 * connection that fails, a request that times out.
 */
const IGNORABLE_REQUEST_FAILURES = /ERR_BLOCKED_BY_ORB|ERR_BLOCKED_BY_RESPONSE|ERR_BLOCKED_BY_CLIENT|ERR_ABORTED/i;

export interface RenderPageParams {
  browser: Browser;
  url: string;
  /** Screenshots are kept for home and product pages only, so most calls skip the cost. */
  screenshot?: boolean;
  /** Defaults to desktop. Mobile is where these sites are usually worst. */
  viewport?: { width: number; height: number };
}

/**
 * Renders a page, retrying once when the failure looks like this machine rather than that site.
 *
 * The plain crawler learned this the expensive way: 124 businesses were recorded as unreachable in
 * one pass, cleared by hand twice, and turned out to be the local DNS resolver rather than 124
 * broken websites. `fetchPage` gained a single retry and the number fell to nine.
 *
 * The renderer reproduced the bug exactly. In the first measurement run `nicenewcards.com` came
 * back unreachable in 254ms; probed again a minute later it loaded fine, while `kiwibeautyshop.com`
 * failed both times with ERR_NAME_NOT_RESOLVED and is genuinely dead. Without this, the measurement
 * that decides whether browser rendering is worth it is itself measuring the wrong thing.
 *
 * Only name resolution is retried. A 403 will be a 403 again, and a timeout has already spent
 * twenty seconds proving it.
 *
 * **Three attempts, not two, and the last word admits doubt.** One retry was not enough: on the
 * operator's own machine `crystaldtf.com` failed twice in a row with ERR_NAME_NOT_RESOLVED while
 * `curl` fetched the same address in one second. A resolver that fails under load fails again 1.5
 * seconds later, so the backoff now widens — and when every attempt has failed on the *name*
 * rather than on a connection, the detail says out loud that this may be our resolver rather than
 * their website.
 *
 * That last part is the important half. The outcome is unchanged, because nothing downstream should
 * start treating a hard "unreachable" differently. But an operator reading "could not reach it" and
 * concluding a live business is dead is the same mistake this product has already made in the
 * crawler, in the scoring and in the social checks: reporting a fact about us as a fact about them.
 */
const DNS_FAILURE = /ERR_NAME_NOT_RESOLVED|getaddrinfo|ENOTFOUND/i;

/** Growing, because a resolver failing under load is still failing a second and a half later. */
const DNS_RETRY_DELAYS_MS = [1_500, 4_000];

export async function renderPage(params: RenderPageParams): Promise<RenderedPage> {
  let attempt = await renderPageOnce(params);
  if (attempt.outcome !== "unreachable" || !DNS_FAILURE.test(attempt.detail ?? "")) return attempt;

  let spentMs = attempt.elapsedMs;

  for (const delay of DNS_RETRY_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const next = await renderPageOnce(params);
    spentMs += delay + next.elapsedMs;

    // Anything other than another name failure is the real answer, good or bad.
    if (next.outcome !== "unreachable" || !DNS_FAILURE.test(next.detail ?? "")) {
      return { ...next, elapsedMs: spentMs };
    }
    attempt = next;
  }

  return {
    ...attempt,
    elapsedMs: spentMs,
    detail:
      `The address would not resolve, on all ${DNS_RETRY_DELAYS_MS.length + 1} attempts. ` +
      `This is usually their website being genuinely gone — but it can also be the machine running ` +
      `this audit failing to look the name up, which has happened here before. Worth opening the ` +
      `address yourself before telling anyone their site is dead.`,
  };
}

async function renderPageOnce(params: RenderPageParams): Promise<RenderedPage> {
  const startedAt = Date.now();
  const base = {
    url: params.url,
    finalUrl: null,
    status: null,
    html: null,
    screenshot: null,
    consoleErrors: [] as string[],
    failedRequests: [] as { url: string; reason: string }[],
    layout: null,
  };

  let page: Page | null = null;

  try {
    page = await params.browser.newPage({
      viewport: params.viewport ?? { width: 1280, height: 900 },
      // A real browser's own string. The point of using a browser at all is to be one — the 25 sites
      // returning 403 to the old crawler are refusing its TLS fingerprint, not its user-agent, and
      // Chromium's is genuinely Chromium's.
      ignoreHTTPSErrors: true,
    });

    const consoleErrors: string[] = [];
    const failedRequests: { url: string; reason: string }[] = [];

    // Capped so one page that logs in a loop cannot fill memory or a database column.
    page.on("console", (message) => {
      if (message.type() === "error" && consoleErrors.length < 25) {
        consoleErrors.push(message.text().slice(0, 300));
      }
    });
    page.on("requestfailed", (request) => {
      const reason = request.failure()?.errorText ?? "unknown";
      // Only the site's own faults. Measuring crystaldtf.com produced fifteen "failed" requests, and
      // not one was the site's doing — Chromium's opaque-response blocking on a third-party script,
      // a cross-origin refusal from shop.app, and analytics beacons the page itself aborted. Every
      // one would have become a finding, and every one would have been wrong on a Priority 1 lead.
      if (IGNORABLE_REQUEST_FAILURES.test(reason)) return;
      if (failedRequests.length < 25) {
        failedRequests.push({ url: request.url().slice(0, 400), reason });
      }
    });

    const response = await page.goto(params.url, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_TIMEOUT_MS,
    });

    // Give client-rendered content its moment. Without this the React and Vue sites — the whole
    // reason for using a browser — hand back the same empty shell plain HTTP already gave us.
    await page.waitForTimeout(SETTLE_MS);

    const status = response?.status() ?? null;
    const finalUrl = page.url();

    if (status !== null && status >= 400) {
      return {
        ...base,
        outcome: "http_error",
        finalUrl,
        status,
        consoleErrors,
        failedRequests,
        elapsedMs: Date.now() - startedAt,
        detail: `The site answered with HTTP ${status}.`,
      };
    }

    // Taken before the HTML, while the page is open and settled. It is the reason for the browser.
    const layout = await measureLayout(page);

    const html = await page.content();
    if (html.length > MAX_HTML_BYTES) {
      return {
        ...base,
        outcome: "http_error",
        finalUrl,
        status,
        consoleErrors,
        failedRequests,
        elapsedMs: Date.now() - startedAt,
        detail: `The page is ${Math.round(html.length / 1_000_000)} MB, far past anything a small business site should be.`,
      };
    }

    let screenshot: string | null = null;
    if (params.screenshot) {
      // WebP at quality 70, full page. PNG would be roughly four times the bytes for a screenshot
      // nobody is going to pixel-peep, and storage is the constraint that arrives first.
      const buffer = await page.screenshot({ fullPage: true, type: "jpeg", quality: 70 });
      screenshot = buffer.toString("base64");
    }

    return {
      ...base,
      outcome: "ok",
      finalUrl,
      status,
      html,
      screenshot,
      layout,
      consoleErrors,
      failedRequests,
      elapsedMs: Date.now() - startedAt,
      detail: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const elapsedMs = Date.now() - startedAt;

    // Timeout and unreachable are told apart because they mean different things to the operator and
    // to the runner: a timeout is worth one retry, a refused connection is not.
    if (/Timeout|timed out/i.test(message)) {
      return { ...base, outcome: "timeout", elapsedMs, detail: `No usable page within ${NAVIGATION_TIMEOUT_MS}ms.` };
    }
    if (/net::|ERR_|ENOTFOUND|ECONNREFUSED|getaddrinfo/i.test(message)) {
      return { ...base, outcome: "unreachable", elapsedMs, detail: `Could not reach it: ${message.slice(0, 200)}` };
    }
    return { ...base, outcome: "browser_failed", elapsedMs, detail: message.slice(0, 300) };
  } finally {
    // Closed even on the failure paths. A leaked page keeps a renderer process alive, and across a
    // few hundred sites that is the difference between finishing and running out of memory.
    await page?.close().catch(() => {});
  }
}
