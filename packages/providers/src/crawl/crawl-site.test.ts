import { describe, expect, it, vi } from "vitest";
import { crawlSite } from "./crawl-site.js";

/** Routes by URL so a test can make https fail and http succeed, the way a real half-broken
 *  site does. Records every URL requested so ordering and politeness can be asserted. */
function router(routes: Record<string, { status?: number; body?: string; throws?: unknown; contentType?: string }>) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const key = url.toString();
    calls.push(key);
    const route =
      routes[key] ??
      Object.entries(routes).find(([pattern]) => key.startsWith(pattern))?.[1] ??
      { status: 404 };
    if (route.throws) throw route.throws;
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: "",
      url: key,
      headers: new Headers({ "content-type": route.contentType ?? "text/html" }),
      text: async () => route.body ?? "<html><body>ok</body></html>",
    } as unknown as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const noSleep = async () => {};

describe("crawlSite", () => {
  it("fetches robots.txt before the page — §13's 'fetched first and respected'", async () => {
    const { fetchImpl, calls } = router({
      "https://example.com/robots.txt": { body: "User-agent: *\nAllow: /" },
      "https://example.com/": { body: "<html><title>Home</title></html>" },
    });

    await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(calls[0]).toBe("https://example.com/robots.txt");
    expect(calls[1]).toBe("https://example.com/");
  });

  it("returns blocked_by_robots without ever requesting the page", async () => {
    const { fetchImpl, calls } = router({
      "https://example.com/robots.txt": { body: "User-agent: *\nDisallow: /" },
      "https://example.com/": { body: "<html>should never be fetched</html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.homepage.outcome).toBe("blocked_by_robots");
    expect(result.robots.blockedHomepage).toBe(true);
    expect(calls).toEqual(["https://example.com/robots.txt"]); // the page was never touched
  });

  it("prefers https and does not fall back when https works", async () => {
    const { fetchImpl, calls } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: "<html>secure</html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.homepage.outcome).toBe("ok");
    expect(result.resolvedUrl).toBe("https://example.com/");
    expect(calls.some((c) => c.startsWith("http://"))).toBe(false);
  });

  it("falls back to http when https cannot connect — which is itself a finding (W4)", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { throws: Object.assign(new Error("cert"), { code: "CERT_HAS_EXPIRED" }) },
      "http://example.com/": { body: "<html>insecure but alive</html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.homepage.outcome).toBe("ok");
    expect(result.resolvedUrl).toBe("http://example.com/");
    expect(result.pagesFetched).toBe(2);
  });

  /**
   * §13 is a rule about *every* request after the first, not about a particular number of them.
   * Asserting a sleep count would re-break the moment the crawler reads one more page, and would
   * be asserting the shape of the crawl rather than the policy — so this asserts the policy: no
   * gap between requests is ever shorter than the minimum.
   */
  it("never makes two requests closer together than the policy delay", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { throws: new Error("ECONNREFUSED") },
      "http://example.com/": { body: '<html><body><a href="/contact">Contact</a></body></html>' },
    });
    const sleepImpl = vi.fn(async () => {});

    await crawlSite({ domain: "example.com", fetchImpl, sleepImpl });

    expect(sleepImpl.mock.calls.length).toBeGreaterThan(0);
    for (const [delay] of sleepImpl.mock.calls) {
      expect(delay).toBeGreaterThanOrEqual(2000); // §13: "at least 2 seconds apart"
    }
  });

  it("honours a longer Crawl-delay the site asked for", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { body: "User-agent: *\nCrawl-delay: 7" },
      "https://example.com/": { throws: new Error("ECONNREFUSED") },
      "http://example.com/": { body: "<html>ok</html>" },
    });
    const sleepImpl = vi.fn(async () => {});

    await crawlSite({ domain: "example.com", fetchImpl, sleepImpl });

    expect(sleepImpl.mock.calls[0]?.[0]).toBe(7000);
  });

  it("does not retry over http when the host already answered with an error status", async () => {
    // A 500 means the host is up and has given its answer. Asking again over plain http would
    // spend a second request to be told the same thing.
    const { fetchImpl, calls } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { status: 500 },
      "http://example.com/": { body: "<html>never reached</html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.homepage.outcome).toBe("http_error");
    expect(calls.filter((c) => c.startsWith("http://")).length).toBe(0);
  });

  /**
   * A DNS failure is the only crawl outcome that produces "dead" on its own, at 100 points, with
   * no manual review — someone acts on it by phoning a business and offering to rebuild their
   * site. One failed lookup is thin evidence for that.
   */
  it("tries a DNS failure twice before letting it stand", async () => {
    let attempts = 0;
    const dns = new Error("fetch failed", { cause: Object.assign(new Error("dns"), { code: "ENOTFOUND" }) });
    const fetchImpl = (async (url: string | URL) => {
      const key = url.toString();
      if (key.endsWith("/robots.txt")) return { ok: false, status: 404, headers: new Headers(), text: async () => "" } as unknown as Response;
      attempts += 1;
      if (attempts === 1) throw dns;
      return {
        ok: true,
        status: 200,
        url: key,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<html><body>alive after all</body></html>",
      } as unknown as Response;
    }) as typeof fetch;

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(result.homepage.outcome).toBe("ok");
  });

  it("reports a dead domain without inventing a resolvedUrl", async () => {
    const dns = new Error("fetch failed", { cause: Object.assign(new Error("dns"), { code: "ENOTFOUND" }) });
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { throws: dns },
      "https://example.com/": { throws: dns },
      "http://example.com/": { throws: dns },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.homepage.outcome).toBe("dns_failure");
    expect(result.resolvedUrl).toBeNull();
  });

  it("stops within the time budget rather than running indefinitely", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { throws: new Error("ECONNREFUSED") },
      "http://example.com/": { body: "<html>ok</html>" },
    });
    // Budget smaller than the politeness delay: there is no room to wait and then fetch.
    const sleepImpl = vi.fn(async () => {});

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl, budgetMs: 500 });

    expect(sleepImpl).not.toHaveBeenCalled();
    expect(result.pagesFetched).toBe(1);
    expect(result.homepage.outcome).not.toBe("ok");
  });
});

const HOMEPAGE_WITH_LINKS = `<html><body>
  <a href="/contact-us">Contact us</a>
  <a href="/about">About</a>
  <a href="/services">Services</a>
  <a href="/brochure.pdf">Brochure</a>
  <a href="https://facebook.com/acme">Facebook</a>
  <a href="/contact-us#form">Contact again</a>
</body></html>`;

describe("crawlSite — reading more than the homepage", () => {
  it("reads the contact page, because that is where a small business puts its phone number", async () => {
    const { fetchImpl, calls } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: HOMEPAGE_WITH_LINKS },
      "https://example.com/contact-us": { body: "<html><body>Call 305-555-0100</body></html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(calls).toContain("https://example.com/contact-us");
    expect(result.pages.map((p) => p.role)).toContain("contact");
    expect(result.contactPageUnread).toBe(false);
  });

  /**
   * The single most important flag this crawler produces. When the page holding the phone number
   * is the page we failed to read, "no phone number on the site" must not be concluded — and the
   * checks can only know that if the crawler says so.
   */
  it("flags a contact page it linked to but could not read", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: HOMEPAGE_WITH_LINKS },
      "https://example.com/contact-us": { status: 500 },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.contactPageUnread).toBe(true);
    expect(result.pages.map((p) => p.role)).not.toContain("contact");
  });

  it("does not flag a blind spot when the site simply has no contact page", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: "<html><body><a href='/gallery'>Gallery</a></body></html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.contactPageUnread).toBe(false);
  });

  it("counts distinct pages, not links — ignoring anchors, files and off-site links", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: HOMEPAGE_WITH_LINKS },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    // /contact-us, /about, /services — the PDF, the Facebook link and the #form duplicate are out
    expect(result.internalLinks).toEqual([
      "https://example.com/contact-us",
      "https://example.com/about",
      "https://example.com/services",
    ]);
  });

  it("never requests a page robots.txt disallows, even when the homepage is allowed", async () => {
    const { fetchImpl, calls } = router({
      "https://example.com/robots.txt": { body: "User-agent: *\nDisallow: /contact-us" },
      "https://example.com/": { body: HOMEPAGE_WITH_LINKS },
      "https://example.com/about": { body: "<html>about</html>" },
    });

    await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(calls).not.toContain("https://example.com/contact-us");
  });
});

describe("crawlSite — sitemap and favicon", () => {
  it("takes a Sitemap: line in robots.txt as the answer without spending a request", async () => {
    const { fetchImpl, calls } = router({
      "https://example.com/robots.txt": { body: "User-agent: *\nSitemap: https://example.com/sitemap_index.xml" },
      "https://example.com/": { body: "<html>ok</html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.sitemapFound).toBe(true);
    expect(result.robots.sitemapDeclared).toBe(true);
    expect(calls).not.toContain("https://example.com/sitemap.xml");
  });

  /**
   * The false positive this design exists to prevent: a great many sites answer every unknown
   * path with their homepage at HTTP 200. Treating that as a sitemap would report one on sites
   * that have none — and S12 would look like it worked while being wrong exactly where it counts.
   */
  it("does not accept a catch-all HTML page as a sitemap", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: "<html>home</html>" },
      "https://example.com/sitemap.xml": { body: "<html>home again</html>", contentType: "text/html" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.sitemapFound).toBe(false);
  });

  it("accepts a real XML sitemap", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: "<html>home</html>" },
      "https://example.com/sitemap.xml": {
        body: '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>',
        contentType: "application/xml",
      },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.sitemapFound).toBe(true);
  });

  it("does not accept a catch-all HTML page as a favicon", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: "<html>home</html>" },
      "https://example.com/favicon.ico": { body: "<html>home again</html>", contentType: "text/html" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.faviconFound).toBe(false);
  });

  it("reports a real favicon", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { body: "<html>home</html>" },
      "https://example.com/favicon.ico": { body: "   ", contentType: "image/x-icon" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.faviconFound).toBe(true);
  });
});

describe("crawlSite — what it refuses to claim", () => {
  it("reports httpsOk false only when http answered and https did not", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 404 },
      "https://example.com/": { throws: Object.assign(new Error("cert"), { code: "CERT_HAS_EXPIRED" }) },
      "http://example.com/": { body: "<html>insecure but alive</html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.httpsOk).toBe(false);
  });

  it("leaves httpsOk unknown when the site is simply down — a dead site is not a certificate problem", async () => {
    const dns = new Error("fetch failed", { cause: Object.assign(new Error("dns"), { code: "ENOTFOUND" }) });
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { throws: dns },
      "https://example.com/": { throws: dns },
      "http://example.com/": { throws: dns },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.httpsOk).toBeNull();
    expect(result.internalLinks).toBeNull();
  });

  /**
   * S13 is about search engines, not about us. A robots.txt that turns this crawler away while
   * welcoming Googlebot describes our user agent, not the business's visibility.
   */
  it("distinguishes a robots.txt that blocks us from one that blocks search engines", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { body: "User-agent: AheadTech360LeadBot\nDisallow: /\n\nUser-agent: *\nAllow: /" },
      "https://example.com/": { body: "<html>ok</html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.robots.blockedHomepage).toBe(true);
    expect(result.robots.blocksSearchEngines).toBe(false);
  });

  it("reports blocksSearchEngines when robots.txt really does disallow Googlebot", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { body: "User-agent: *\nDisallow: /\n\nUser-agent: AheadTech360LeadBot\nAllow: /" },
      "https://example.com/": { body: "<html>ok</html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.robots.blockedHomepage).toBe(false);
    expect(result.robots.blocksSearchEngines).toBe(true);
  });

  it("leaves blocksSearchEngines unknown when robots.txt was unreachable", async () => {
    const { fetchImpl } = router({
      "https://example.com/robots.txt": { status: 503 },
      "https://example.com/": { body: "<html>ok</html>" },
    });

    const result = await crawlSite({ domain: "example.com", fetchImpl, sleepImpl: noSleep });

    expect(result.robots.source).toBe("unreachable");
    expect(result.robots.blocksSearchEngines).toBeNull();
  });
});
