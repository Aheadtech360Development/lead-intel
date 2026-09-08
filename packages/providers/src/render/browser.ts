import { chromium, type Browser } from "playwright";

/**
 * Starting and stopping Chromium.
 *
 * Kept apart from `renderPage` so a caller can hold one browser open across a site's pages. That is
 * the difference between three seconds per site and three seconds per page — and with roughly six
 * pages a site, it is most of the bill.
 */

export interface BrowserSession {
  browser: Browser;
  close: () => Promise<void>;
}

export type BrowserStart = { ok: true; session: BrowserSession } | { ok: false; detail: string };

/**
 * Flags chosen for a container, not for a laptop.
 *
 * `--disable-dev-shm-usage` is the one that matters on Trigger.dev: containers give /dev/shm 64 MB
 * by default, Chromium expects far more, and without this flag it dies partway through a page with
 * an error that reads like a website problem rather than a container one.
 */
const CONTAINER_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  // Nothing here needs sound, and the audio service occasionally hangs shutdown.
  "--mute-audio",
];

export async function startBrowser(): Promise<BrowserStart> {
  try {
    const browser = await chromium.launch({ headless: true, args: CONTAINER_ARGS });
    return {
      ok: true,
      session: {
        browser,
        // Swallowing the close error is deliberate: by this point the pages are read and the work
        // is done, and a browser that fails to shut down cleanly must not fail the site's results.
        close: async () => {
          await browser.close().catch(() => {});
        },
      },
    };
  } catch (err) {
    // Returned rather than thrown, so the caller can record "we could not look" against the site
    // instead of the run dying. A browser that will not start is a fact about our machine, and the
    // businesses must not be marked as though something were wrong with them.
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
