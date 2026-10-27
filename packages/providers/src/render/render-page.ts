import type { Browser, Page } from "playwright";
import { CRAWLER_USER_AGENT } from "../crawl/policy.js";
import { measureLayout } from "./measure-layout.js";
import type { RenderedPage } from "./types.js";

/**
 * What the browser calls itself.
 *
 * Pinned rather than derived from the running Chromium, so a Playwright upgrade cannot silently
 * reintroduce the word "Headless" and start collecting 403s again — which is exactly how the
 * previous version went wrong without anyone noticing.
 */
/** The viewport the screenshot is cropped to. Matches the render width so nothing reflows. */
const SCREENSHOT_WIDTH = 1280;

const RENDER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

/**
 * One page, rendered.
 *
 * The browser is passed in rather than created here, because starting Chromium costs about three
 * seconds and a site has several pages. Launching per page would roughly triple the machine time —
 * and machine time is what Trigger.dev bills, by the second.
 */

/**
 * Long enough for a slow site on a slow connection; short enough that one bad page cannot stall a
 * run.
 *
 * **Twenty seconds was too short, and it was failing real sites silently.** Measured on
 * ninjatransfers.com — a working, busy business whose home page is 1.9 MB of Shopify — a cold
 * render took **13.9 seconds** and a second one went past twenty. The operator saw the result as
 * "The home page could not be read (timeout)", which reads as a verdict about the business and was
 * nothing of the kind.
 *
 * Thirty-five seconds costs nothing on a healthy site, because navigation ends when the document
 * does. It only spends the extra on the sites that need it, which are exactly the ones worth
 * getting right.
 */
const NAVIGATION_TIMEOUT_MS = 35_000;

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
/**
 * The ceiling on serialised DOM, not on downloaded bytes.
 *
 * Three megabytes was inherited from the plain crawler, where it is the right number: there it caps
 * what gets *downloaded*, and a 3 MB HTML file really is a runaway.
 *
 * It is the wrong number here. `page.content()` serialises a DOM the browser has already built and
 * paid for, inlining every attribute of every node — a perfectly ordinary image-heavy site on Wix
 * or Shopify runs to several megabytes of markup. Measured: a4graphic.com, a real business the
 * operator was looking at, renders in three seconds and serialises to 5 MB. The old cap threw that
 * away *after* loading it, so the audit spent the time and kept nothing.
 *
 * Twelve is high enough for the sites that exist and still low enough to stop something pathological
 * filling a database column.
 */
const MAX_HTML_BYTES = 12_000_000;

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

/**
 * Walks down the page so lazy-loaded images are actually requested, then returns to the top.
 *
 * Deliberately unhurried — a third of a viewport at a time with a pause between — because the point
 * is to cross each image's "near the viewport" threshold and give the network a moment to answer.
 * Racing to the bottom would tick every threshold and photograph the same empty boxes.
 *
 * Bounded three ways: a fixed number of steps, a height ceiling, and a swallowed failure. A page
 * that grows as you scroll it — an infinite feed — must cost a second, not a run.
 */
async function autoScroll(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      const step = Math.round(window.innerHeight / 3);
      const limit = Math.min(document.documentElement.scrollHeight, window.innerHeight * 4);
      for (let y = 0; y < limit; y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 90));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 120));
    });

    // Whatever the scrolling asked for, give it a moment to arrive. Short, because this is a
    // courtesy to the picture and not a reason to hold the audit up.
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  } catch {
    // A page that refuses to be scrolled still gets photographed, just as it was.
  }
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
      /**
       * A real Chrome string, because the default one is refused.
       *
       * The note that used to sit here said the browser's own user-agent was "genuinely
       * Chromium's" and that the 403s were about TLS fingerprints. That was wrong, and measurably
       * so. Playwright runs **chromium-headless-shell**, which announces itself as
       * `HeadlessChrome/143...`, and a great many WAFs refuse that string on sight.
       *
       * Measured on a4graphic.com, a live business the operator had just opened in their own
       * browser: as shipped, **403**. With the string below and nothing else changed, **200** — and
       * the Instagram account in its footer, which is the only route to that business's follower
       * count and had been invisible until now.
       *
       * It is the same engine either way; only the label changes. The page is public, it renders
       * for anyone who visits, and we stay identifiable through the header below rather than
       * pretending to be nobody.
       */
      userAgent: RENDER_USER_AGENT,
      locale: "en-US",
      extraHTTPHeaders: {
        "accept-language": "en-US,en;q=0.9",
        // §13's honesty rule, kept. The plain crawler puts this in its user-agent; here it moves to
        // a header, so a site owner reading their logs still finds out exactly who we are and how
        // to reach us.
        "x-crawled-by": CRAWLER_USER_AGENT,
      },
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
        // `too_big`, not `http_error`. The request succeeded — this one returned 200 — and calling
        // a size refusal an HTTP error told the operator their prospect's server had failed when
        // the truth was that ours had declined to keep the answer.
        outcome: "too_big",
        finalUrl,
        status,
        consoleErrors,
        failedRequests,
        elapsedMs: Date.now() - startedAt,
        detail:
          `The page serialises to ${Math.round(html.length / 1_000_000)} MB, past the ` +
          `${MAX_HTML_BYTES / 1_000_000} MB this keeps. It loaded fine; we simply did not store it.`,
      };
    }

    let screenshot: string | null = null;
    if (params.screenshot) {
      // WebP at quality 70, full page. PNG would be roughly four times the bytes for a screenshot
      // nobody is going to pixel-peep, and storage is the constraint that arrives first.
      /**
       * Scrolled first, then cropped to what a person would actually look at.
       *
       * Two faults in the version this replaces, both visible in the pictures the operator was
       * shown.
       *
       * **Half the page was missing.** Almost every modern site loads its images only as they come
       * near the viewport. A full-page screenshot taken straight after load photographs a document
       * whose images below the fold have never been asked for, so they come out blank — the page
       * appears gutted. Walking down the page first lets the site load what a visitor would see,
       * and `networkidle` waits for those images to arrive.
       *
       * **And it went on forever.** `fullPage` captures the entire document; a long marketing page
       * becomes a strip twenty thousand pixels tall, which is unreadable on screen and large in
       * storage. Three screens' worth is what anyone actually judges a site by, so that is what is
       * kept.
       */
      await autoScroll(page);
      const height = await page
        .evaluate(() => Math.min(document.documentElement.scrollHeight, window.innerHeight * 3))
        .catch(() => 900);

      const buffer = await page.screenshot({
        type: "jpeg",
        quality: 72,
        clip: { x: 0, y: 0, width: SCREENSHOT_WIDTH, height: Math.max(600, Math.round(height)) },
      });
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
