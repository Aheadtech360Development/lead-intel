import { describe, expect, it } from "vitest";
import { CHECK_DEFINITIONS, checkDefinition } from "./registry.js";
import { runFreeChecks } from "./run.js";
import type { CheckResult, SiteEvidence, SitePage } from "./types.js";

const NOW = new Date("2026-08-18T00:00:00Z");

function page(html: string, role: SitePage["role"] = "homepage", extra: Partial<SitePage> = {}): SitePage {
  return { url: `https://example.com/${role === "homepage" ? "" : role}`, role, html, ...extra };
}

function evidence(overrides: Partial<SiteEvidence> = {}): SiteEvidence {
  return {
    businessName: "Unique Screen Printing",
    city: "Miami",
    niche: "screen printing",
    domain: "example.com",
    presence: "live",
    httpsOk: true,
    pages: [readable("<html><head><title>Home</title></head><body><h1>Home</h1></body></html>")],
    robots: { source: "missing", blocksSearchEngines: false },
    sitemapFound: false,
    faviconFound: false,
    internalLinks: [],
    contactPageUnread: false,
    socialPageUnread: false,
    now: NOW,
    ...overrides,
  };
}

function byId(results: CheckResult[]): Map<string, CheckResult> {
  return new Map(results.map((r) => [r.checkId, r]));
}

/**
 * Ordinary body copy, added to fixtures that need to clear the readable-text floor so the test
 * exercises the check it names rather than the app-shell coverage rule. Both rules are asserted
 * on their own elsewhere; padding here keeps each test about one thing.
 */
const FILLER = `<p>Acme Printing has been printing custom shirts, hoodies and hats for teams,
  schools and small businesses across the area for many years. Bring us a design of your own or
  let one of us help you make one from scratch. Rush orders are welcome, and every single job is
  checked over by a person before it leaves the shop.</p>`;

/** A fixture page with enough prose to be genuinely readable. */
function prose(body: string, role: SitePage["role"] = "homepage", extra: Partial<SitePage> = {}): SitePage {
  return page(`<html><body>${body}${FILLER}</body></html>`, role, extra);
}

/** An existing fixture, padded so it clears the readable-text floor. `page()` stays raw, for the
 *  tests that are about the floor itself. */
function readable(html: string, role: SitePage["role"] = "homepage", extra: Partial<SitePage> = {}): SitePage {
  const padded = html.includes("</body>") ? html.replace("</body>", `${FILLER}</body>`) : `${html}${FILLER}`;
  return page(padded, role, extra);
}

/** A site with everything a good local business site has. Used as the "should mostly pass" case. */
const HEALTHY_HOMEPAGE = `<!doctype html><html><head>
  <title>Unique Screen Printing — Custom Shirts in Miami</title>
  <meta name="description" content="Custom screen printing in Miami since 1998.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="icon" href="/favicon.png">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"LocalBusiness","name":"Unique Screen Printing",
     "address":{"@type":"PostalAddress","streetAddress":"123 NW 5th Ave","addressLocality":"Miami","addressRegion":"FL","postalCode":"33127"},
     "openingHours":"Mo-Fr 09:00-17:00","dateModified":"2026-05-02"}
  </script>
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>
  <script>fbq('init', '123456789');</script>
</head><body>
  <h1>Custom Screen Printing in Miami</h1>
  <p>123 NW 5th Ave, Miami, FL 33127. Open Monday to Friday, 9:00 am to 5:00 pm.</p>
  <a href="tel:+13055550100">305-555-0100</a>
  <a href="mailto:hello@example.com">hello@example.com</a>
  <a href="https://www.google.com/maps/place/Unique+Screen+Printing">Get directions</a>
  <a href="https://facebook.com/uniqueprinting">Facebook</a>
  <a href="https://instagram.com/uniqueprinting">Instagram</a>
  <a href="https://youtube.com/@uniqueprinting">YouTube</a>
  <a href="/contact">Get a quote</a>
  <form><textarea name="message"></textarea><button type="submit">Send</button></form>
  <section><h2>What our customers say</h2><p>Great work!</p></section>
  <img src="1.jpg" alt="A printed shirt"><img src="2.jpg" alt="Our shop">
  <img src="3.jpg" alt="A hoodie"><img src="4.jpg" alt="Team"><img src="5.jpg" alt="Press">
  <footer>© 2026 Unique Screen Printing</footer>
</body></html>`;

// ---------------------------------------------------------------------------
// The invariants that must hold for every possible input
// ---------------------------------------------------------------------------

describe("runFreeChecks — structural invariants", () => {
  it("returns each check exactly once", () => {
    const results = runFreeChecks(evidence({ pages: [readable(HEALTHY_HOMEPAGE)] }));
    const ids = results.map((r) => r.checkId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only ever emits check IDs that exist in the registry", () => {
    const known = new Set(CHECK_DEFINITIONS.map((d) => d.id));
    for (const result of runFreeChecks(evidence({ pages: [readable(HEALTHY_HOMEPAGE)] }))) {
      expect(known.has(result.checkId)).toBe(true);
    }
  });

  /**
   * §6.1's accounting rule, asserted directly against a wide spread of inputs. The database
   * carries the same rule as a CHECK constraint; this is the layer that means it never has to
   * reject anything.
   */
  it("points and maxPoints always agree with the outcome", () => {
    const cases: SiteEvidence[] = [
      evidence({ pages: [readable(HEALTHY_HOMEPAGE)] }),
      evidence({ pages: [], presence: "unclear", httpsOk: null, internalLinks: null, sitemapFound: null, faviconFound: null }),
      evidence({ presence: "dead", pages: [] }),
      evidence({ presence: "no_website", domain: null, pages: [] }),
      evidence({ contactPageUnread: true }),
      evidence({ robots: { source: "fetched", blocksSearchEngines: true } }),
    ];

    for (const input of cases) {
      for (const result of runFreeChecks(input)) {
        const definition = checkDefinition(result.checkId);
        switch (result.outcome) {
          case "fired":
            expect(result.points).toBeGreaterThan(0);
            expect(result.points).toBeLessThanOrEqual(definition.points);
            expect(result.maxPoints).toBe(definition.points);
            break;
          case "passed":
            expect(result.points).toBe(0);
            expect(result.maxPoints).toBe(definition.points);
            break;
          default:
            expect(result.points).toBe(0);
            expect(result.maxPoints).toBe(0);
        }
        expect(result.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it("only ever produces FREE checks — nothing here may claim to have run a paid one", () => {
    for (const result of runFreeChecks(evidence({ pages: [readable(HEALTHY_HOMEPAGE)] }))) {
      expect(result.costClass).toBe("FREE");
    }
  });
});

// ---------------------------------------------------------------------------
// The rule the whole module exists to keep: nothing is concluded from nothing
// ---------------------------------------------------------------------------

describe("runFreeChecks — an unread site produces no findings at all", () => {
  const unread = runFreeChecks(
    evidence({
      pages: [],
      presence: "unclear",
      httpsOk: null,
      internalLinks: null,
      sitemapFound: null,
      faviconFound: null,
      robots: { source: "unreachable", blocksSearchEngines: null },
    }),
  );

  it("fires nothing", () => {
    expect(unread.filter((r) => r.outcome === "fired")).toEqual([]);
  });

  it("passes nothing either — a site we could not read is not a site with no problems", () => {
    expect(unread.filter((r) => r.outcome === "passed")).toEqual([]);
  });

  it("puts zero attainable points on the table, so it cannot be scored", () => {
    expect(unread.reduce((sum, r) => sum + r.maxPoints, 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §5.2 contactability — the blind-spot rule
// ---------------------------------------------------------------------------

describe("contactability — absence is only concluded when we looked in the right place", () => {
  /** Long enough to clear the readable-text floor, so these tests exercise the blind-spot rule
   *  rather than the app-shell one. Both are asserted, separately, below. */
  const bare = `<html><body><h1>Acme Printing</h1><p>We print custom shirts, hoodies and hats for
    teams, schools and small businesses across the area. We have been doing it for a long time and
    we are good at it. Bring us your design or let us help you make one. Rush orders welcome, and
    every order is checked by a person before it ships out of the shop.</p></body></html>`;

  it("fires 'no phone number' when the site was fully read and has none", () => {
    const results = byId(runFreeChecks(evidence({ pages: [page(bare)], contactPageUnread: false })));
    expect(results.get("K1")?.outcome).toBe("fired");
  });

  /**
   * The false positive this rule exists to stop. The contact page is where a small business puts
   * its phone number; concluding "no phone number on the site" from a homepage we read and a
   * contact page we did not is how a system manufactures a finding, and an operator takes it
   * onto a sales call.
   */
  it("reports 'not measured' instead when the contact page could not be read", () => {
    const results = byId(runFreeChecks(evidence({ pages: [page(bare)], contactPageUnread: true })));
    for (const id of ["K1", "K3", "K4", "K5", "K6", "K7", "K8"]) {
      expect(results.get(id)?.outcome, id).toBe("not_measured");
    }
  });

  /**
   * The second half of the coverage rule, and the one that scales worst if it is missing. A
   * single-page app with no server rendering hands a crawler an empty shell — no form, no phone,
   * no address, no social links — not because the business lacks them but because none of it
   * exists until a browser runs the JavaScript. Every "not found" check would fire at once and
   * the most modern site on the list would come out looking like the most neglected one.
   */
  it("concludes nothing from an app shell that served no readable content", () => {
    const shell = `<html><head><title>Acme</title></head><body>
      <div id="root"></div><script src="/static/js/main.8f2a1c.js"></script></body></html>`;
    const results = byId(runFreeChecks(evidence({ pages: [page(shell)] })));

    for (const id of ["K1", "K3", "K4", "K5", "K6", "K7", "K8", "O1", "O2", "O4", "O6", "R6"]) {
      expect(results.get(id)?.outcome, id).toBe("not_measured");
    }
    expect(results.get("K1")?.evidence).toMatch(/readable text/i);
  });

  /**
   * The other half of the same rule, and the one length alone cannot decide. A rendered app shell
   * is enormous and says nothing; a real small site is small and says something. Both of these
   * are taken verbatim from the live audit.
   */
  it("tells a big empty shell apart from a small real page", () => {
    // needlepointthis.com: 95 KB of markup, zero readable characters.
    const shell = `<html><head><title>Needlepoint This</title></head><body><div id="app"></div>
      <!--${"x".repeat(30_000)}--></body></html>`;
    expect(byId(runFreeChecks(evidence({ pages: [page(shell)] }))).get("K1")?.outcome).toBe("not_measured");

    // fibercircleyarn.com: 16 KB of Weebly markup carrying its address, phone and opening hours
    // in 277 characters. A thin real site is still a real site.
    const thinButReal = `<html><head><title>Fiber Circle Yarns</title></head><body>
      <p>Fiber Circle Yarns Home Yarns We Carry About the Store Newsletter Contact Us Texas'
      Largest Yarn Mercantile 200 McKinney St Farmersville TX 75442 972-782-6630 Mon, Tues, Wed -
      Call ahead Thurs 10-5 Fri 10-5 Sat 10-4 Sun closed. Come and see our full range.</p>
      </body></html>`;
    const real = byId(runFreeChecks(evidence({ pages: [page(thinButReal)] })));
    expect(real.get("K1")?.outcome).toBe("passed");
    expect(real.get("K4")?.outcome).toBe("passed");
    expect(real.get("K5")?.outcome).toBe("passed");
  });

  /**
   * A real one, verbatim: `texasoptical.net` serves 114 bytes whose entire content is a
   * JavaScript redirect. Judged as a page it has no title, no meta description, no viewport tag,
   * no tracking and one page total — ten findings, every one of them about a stub rather than
   * about the business. Nothing derived from page content may be concluded from this.
   */
  it("concludes nothing about the page from a redirect stub", () => {
    const stub = `<!DOCTYPE html><html><head><script>window.onload=function(){window.location.href="/lander"}</script></head></html>`;
    const results = byId(runFreeChecks(evidence({ pages: [page(stub)], presence: "unclear", internalLinks: [] })));

    const pageDerived = ["W5", "W8", "W9", "W10", "W11", "W12", "S9", "S10", "S11", "S14", "D1", "D2", "D3", "D4", "D6", "N1", "N6", "N9", "N10"];
    for (const id of pageDerived) {
      expect(results.get(id)?.outcome, id).toBe("not_measured");
    }
    // The checks that read the connection, a probe or robots.txt still answer — they never
    // depended on the markup in the first place.
    expect(results.get("W4")?.outcome).toBe("passed");
    expect(results.get("S12")?.outcome).toBe("fired");
    expect(results.get("S13")?.outcome).toBe("passed");
  });

  it("still finds a phone number on the contact page when it was read", () => {
    const results = byId(
      runFreeChecks(
        evidence({
          pages: [page(bare), readable("<html><body><a href='tel:+13055550100'>Call us</a></body></html>", "contact")],
        }),
      ),
    );
    expect(results.get("K1")?.outcome).toBe("passed");
    expect(results.get("K2")?.outcome).toBe("passed");
  });

  it("fires tap-to-call only when a number exists in plain text", () => {
    const results = byId(
      runFreeChecks(evidence({ pages: [readable("<html><body><p>Call us on (305) 555-0100</p></body></html>")] })),
    );
    expect(results.get("K1")?.outcome).toBe("passed");
    expect(results.get("K2")?.outcome).toBe("fired");
  });

  it("marks tap-to-call not applicable when there is no number to make tappable", () => {
    const results = byId(runFreeChecks(evidence({ pages: [page(bare)] })));
    expect(results.get("K2")?.outcome).toBe("not_applicable");
  });

  /**
   * The address-next-to-the-phone case, which is how almost every local business site is laid
   * out. A greedy scan matches `75442 972-782-6630` — fifteen digits, not a valid number — and
   * having consumed the text never tries the real number inside it, firing "no phone number on
   * the site" at 30 points on a site that plainly shows one.
   */
  it("finds a phone number sitting immediately after a postcode", () => {
    const body = "<p>200 McKinney St, Farmersville TX 75442 972-782-6630 — call ahead.</p>";
    const results = byId(runFreeChecks(evidence({ pages: [prose(body)] })));
    expect(results.get("K1")?.outcome).toBe("passed");
    expect(results.get("K1")?.evidence).toContain("+19727826630");
  });

  it("finds a number written across several tokens", () => {
    const body = "<p>Reach us on +1 (305) 555 0100 during opening hours.</p>";
    expect(byId(runFreeChecks(evidence({ pages: [prose(body)] }))).get("K1")?.outcome).toBe("passed");
  });

  /** Validation, not a regex, is what keeps prices and SKUs from being read as phone numbers. */
  it("does not mistake a long number for a phone number", () => {
    const results = byId(
      runFreeChecks(evidence({ pages: [prose("<p>Order #0000000000 — total $1,234.5678</p>")] })),
    );
    expect(results.get("K1")?.outcome).toBe("fired");
  });

  it("recognises a street address written out in the page text", () => {
    const body = "<p>Visit us at 123 NW 5th Ave, Miami, FL 33127</p>";
    expect(byId(runFreeChecks(evidence({ pages: [prose(body)] }))).get("K4")?.outcome).toBe("passed");
  });

  it("does not read a bare five-digit number as an address", () => {
    const body = "<p>Over 33127 shirts printed since 1998</p>";
    expect(byId(runFreeChecks(evidence({ pages: [prose(body)] }))).get("K4")?.outcome).toBe("fired");
  });

  it("recognises published opening hours", () => {
    const body = "<p>Open Monday to Friday, 9:00 am to 5:00 pm. Saturday 10am-2pm.</p>";
    expect(byId(runFreeChecks(evidence({ pages: [prose(body)] }))).get("K5")?.outcome).toBe("passed");
  });

  it("does not read a single date mention as opening hours", () => {
    const body = "<p>Our Saturday sale starts at 10:00 am.</p>";
    expect(byId(runFreeChecks(evidence({ pages: [prose(body)] }))).get("K5")?.outcome).toBe("fired");
  });
});

// ---------------------------------------------------------------------------
// §5.1 web presence and quality
// ---------------------------------------------------------------------------

describe("web presence and quality", () => {
  it("restates the §4 verdict rather than recomputing it", () => {
    const dead = byId(runFreeChecks(evidence({ presence: "dead", pages: [] })));
    expect(dead.get("W2")?.outcome).toBe("fired");
    expect(dead.get("W2")?.points).toBe(100);
    expect(dead.get("W1")?.outcome).toBe("passed");
  });

  /**
   * W1 is the heaviest finding in the model and the one an operator acts on by offering to build
   * a website. classifyPresence returns `unclear` precisely when it could not settle the
   * question; nothing here may settle it for them.
   */
  it("never fires 'no website' from an unclear presence verdict", () => {
    const results = byId(runFreeChecks(evidence({ presence: "unclear", pages: [] })));
    expect(results.get("W1")?.outcome).toBe("not_measured");
    expect(results.get("W2")?.outcome).toBe("not_measured");
    expect(results.get("W3")?.outcome).toBe("not_measured");
  });

  it("fires 'no valid HTTPS' only when http answered and https did not", () => {
    expect(byId(runFreeChecks(evidence({ httpsOk: false }))).get("W4")?.outcome).toBe("fired");
    expect(byId(runFreeChecks(evidence({ httpsOk: true }))).get("W4")?.outcome).toBe("passed");
    expect(byId(runFreeChecks(evidence({ httpsOk: null }))).get("W4")?.outcome).toBe("not_measured");
  });

  it("fires 'not mobile-friendly' when there is no viewport tag and no responsive CSS", () => {
    const results = byId(runFreeChecks(evidence({ pages: [readable("<html><body>plain</body></html>")] })));
    expect(results.get("W5")?.outcome).toBe("fired");
  });

  it("passes a page that declares a viewport", () => {
    const html = '<html><head><meta name="viewport" content="width=device-width"></head><body>x</body></html>';
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("W5")?.outcome).toBe("passed");
  });

  it("flags a dated platform but not a current one", () => {
    const weebly = '<html><head><meta name="generator" content="Weebly"></head><body>x</body></html>';
    expect(byId(runFreeChecks(evidence({ pages: [readable(weebly)] }))).get("W8")?.outcome).toBe("fired");

    const squarespace = '<html><body><script src="https://static1.squarespace.com/x.js"></script></body></html>';
    expect(byId(runFreeChecks(evidence({ pages: [readable(squarespace)] }))).get("W8")?.outcome).toBe("passed");
  });

  it("fires 'looks abandoned' on a copyright two or more years old", () => {
    const stale = byId(runFreeChecks(evidence({ pages: [readable("<html><body><footer>© 2024 Acme</footer></body></html>")] })));
    expect(stale.get("W9")?.outcome).toBe("fired");

    const lastYear = byId(runFreeChecks(evidence({ pages: [readable("<html><body><footer>© 2025 Acme</footer></body></html>")] })));
    expect(lastYear.get("W9")?.outcome).toBe("passed");
  });

  /** "Since 1998" in body copy alongside "© 2026" in the footer must yield 2026, not 1998. */
  it("reads the copyright year, not any year on the page", () => {
    const html = "<html><body><p>Serving Miami since 1998.</p><footer>© 2026 Acme</footer></body></html>";
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("W9")?.outcome).toBe("passed");
  });

  it("does not judge a site's age when it prints no copyright year", () => {
    expect(byId(runFreeChecks(evidence({ pages: [readable("<html><body>no year here</body></html>")] }))).get("W9")?.outcome).toBe(
      "not_measured",
    );
  });

  it("fires 'barely a website' below four pages and passes at four", () => {
    expect(byId(runFreeChecks(evidence({ internalLinks: ["/a", "/b"] }))).get("W10")?.outcome).toBe("fired");
    expect(byId(runFreeChecks(evidence({ internalLinks: ["/a", "/b", "/c"] }))).get("W10")?.outcome).toBe("passed");
    expect(byId(runFreeChecks(evidence({ internalLinks: null }))).get("W10")?.outcome).toBe("not_measured");
  });

  it("accepts a favicon from either the link tag or /favicon.ico", () => {
    const tagged = '<html><head><link rel="icon" href="/f.png"></head><body>x</body></html>';
    expect(byId(runFreeChecks(evidence({ pages: [readable(tagged)], faviconFound: false }))).get("W11")?.outcome).toBe("passed");
    expect(byId(runFreeChecks(evidence({ faviconFound: true }))).get("W11")?.outcome).toBe("passed");
    expect(byId(runFreeChecks(evidence({ faviconFound: false }))).get("W11")?.outcome).toBe("fired");
    expect(byId(runFreeChecks(evidence({ faviconFound: null }))).get("W11")?.outcome).toBe("not_measured");
  });

  it("judges alt text only when there are enough images for a ratio to mean anything", () => {
    const two = "<html><body><img src=1.jpg><img src=2.jpg></body></html>";
    expect(byId(runFreeChecks(evidence({ pages: [readable(two)] }))).get("W12")?.outcome).toBe("not_applicable");

    const sixBare = `<html><body>${"<img src=x.jpg>".repeat(6)}</body></html>`;
    expect(byId(runFreeChecks(evidence({ pages: [readable(sixBare)] }))).get("W12")?.outcome).toBe("fired");
  });

  it("does not penalise correctly-marked decorative images", () => {
    const html = `<html><body>${'<img src=d.jpg alt="" aria-hidden="true">'.repeat(6)}<img src=a.jpg alt="A shirt"></body></html>`;
    // Only the one real image counts, which is too few to judge.
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("W12")?.outcome).toBe("not_applicable");
  });
});

// ---------------------------------------------------------------------------
// §5.1 W6/W7 — the two PageSpeed checks
// ---------------------------------------------------------------------------

describe("mobile performance", () => {
  it("reports both as unmeasured when PageSpeed has not run", () => {
    const results = byId(runFreeChecks(evidence({ pages: [readable(HEALTHY_HOMEPAGE)] })));
    expect(results.get("W6")?.outcome).toBe("not_measured");
    expect(results.get("W7")?.outcome).toBe("not_measured");
  });

  /** §5.1 W6's thresholds are Google's own LCP boundaries: good ≤2.5s, poor >4s. */
  it.each([
    [1800, "passed", 0],
    [2500, "fired", 15],
    [3900, "fired", 15],
    [4001, "fired", 30],
    [9000, "fired", 30],
  ])("LCP of %ims is %s for %i points", (lcpMs, outcome, points) => {
    const results = byId(
      runFreeChecks(evidence({ performance: { performanceScore: 95, lcpMs: lcpMs as number } })),
    );
    expect(results.get("W6")?.outcome).toBe(outcome);
    expect(results.get("W6")?.points).toBe(points);
  });

  /** §5.1 W7's bands are Lighthouse's own: under 50 poor, 50-89 needs improvement, 90+ good. */
  it.each([
    [95, "passed", 0],
    [90, "passed", 0],
    [89, "fired", 10],
    [50, "fired", 10],
    [49, "fired", 25],
    [3, "fired", 25],
  ])("a performance score of %i is %s for %i points", (score, outcome, points) => {
    const results = byId(
      runFreeChecks(evidence({ performance: { performanceScore: score as number, lcpMs: 1000 } })),
    );
    expect(results.get("W7")?.outcome).toBe(outcome);
    expect(results.get("W7")?.points).toBe(points);
  });

  it("carries the reason through when PageSpeed could not measure the page", () => {
    const results = byId(
      runFreeChecks(
        evidence({
          performance: { performanceScore: null, lcpMs: null, unavailableReason: "Lighthouse could not load the page." },
        }),
      ),
    );
    expect(results.get("W6")?.outcome).toBe("not_measured");
    expect(results.get("W6")?.evidence).toContain("could not load");
    expect(results.get("W7")?.outcome).toBe("not_measured");
  });

  /**
   * The one place in this system where an app shell is not an obstacle: PageSpeed runs a real
   * browser, so it measures a single-page app exactly as a visitor experiences it. Gating these
   * on the crawl's blind spot would throw away the measurement most worth having.
   */
  it("measures performance even on a page our own crawler could not read", () => {
    const shell = `<html><head><title>Acme</title></head><body><div id="root"></div></body></html>`;
    const results = byId(
      runFreeChecks(evidence({ pages: [page(shell)], performance: { performanceScore: 22, lcpMs: 7200 } })),
    );
    expect(results.get("K1")?.outcome).toBe("not_measured"); // the crawl-derived checks still abstain
    expect(results.get("W6")?.outcome).toBe("fired");
    expect(results.get("W7")?.outcome).toBe("fired");
  });
});

// ---------------------------------------------------------------------------
// §5.3 SEO
// ---------------------------------------------------------------------------

describe("local search and listings", () => {
  it("accepts a LocalBusiness subtype as local markup", () => {
    const html = '<html><head><script type="application/ld+json">{"@type":"Dentist","name":"X"}</script></head><body>x</body></html>';
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("S9")?.outcome).toBe("passed");
  });

  it("fires when the only structured data is unrelated", () => {
    const html = '<html><head><script type="application/ld+json">{"@type":"WebSite","name":"X"}</script></head><body>x</body></html>';
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("S9")?.outcome).toBe("fired");
  });

  it("survives malformed JSON-LD without losing the valid block beside it", () => {
    const html = `<html><head>
      <script type="application/ld+json">{ this is not json </script>
      <script type="application/ld+json">{"@type":"HairSalon"}</script>
    </head><body>x</body></html>`;
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("S9")?.outcome).toBe("passed");
  });

  it("fires on a missing title and on duplicate titles across pages", () => {
    expect(byId(runFreeChecks(evidence({ pages: [readable("<html><body>x</body></html>")] }))).get("S10")?.outcome).toBe("fired");

    const same = "<html><head><title>Acme</title></head><body>x</body></html>";
    const results = byId(runFreeChecks(evidence({ pages: [readable(same), readable(same, "contact")] })));
    expect(results.get("S10")?.outcome).toBe("fired");
  });

  it("says so when only one page was read, rather than implying duplicates were checked", () => {
    const one = byId(runFreeChecks(evidence({ pages: [readable("<html><head><title>Acme</title></head><body>x</body></html>")] })));
    expect(one.get("S10")?.outcome).toBe("passed");
    expect(one.get("S10")?.evidence).toMatch(/only one page/i);
  });

  /**
   * At 40 points, S13 is the heaviest FREE check in the SEO area — and it is about search
   * engines, not about us. A robots.txt that turns this crawler away while welcoming Googlebot
   * describes our user agent, and firing on it would put a large problem on a healthy site.
   */
  it("does not fire 'search engines blocked' when robots.txt blocks only our crawler", () => {
    const results = byId(runFreeChecks(evidence({ robots: { source: "fetched", blocksSearchEngines: false } })));
    expect(results.get("S13")?.outcome).toBe("passed");
  });

  it("fires when robots.txt really does block search engines", () => {
    const results = byId(runFreeChecks(evidence({ robots: { source: "fetched", blocksSearchEngines: true } })));
    expect(results.get("S13")?.outcome).toBe("fired");
    expect(results.get("S13")?.points).toBe(40);
  });

  it("catches a noindex in the X-Robots-Tag header, not only in the markup", () => {
    const results = byId(
      runFreeChecks(
        evidence({ pages: [readable("<html><body>x</body></html>", "homepage", { xRobotsTag: "noindex, nofollow" })] }),
      ),
    );
    expect(results.get("S13")?.outcome).toBe("fired");
  });

  it("fires when neither the city nor the service appears in the title", () => {
    const html = "<html><head><title>Home</title></head><body><h1>Welcome</h1></body></html>";
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("S14")?.outcome).toBe("fired");
  });

  it("passes when the title names the city", () => {
    const html = "<html><head><title>Acme — Miami</title></head><body><h1>Welcome</h1></body></html>";
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("S14")?.outcome).toBe("passed");
  });

  it("does not judge the title when neither city nor niche is known", () => {
    const results = byId(runFreeChecks(evidence({ city: null, niche: null })));
    expect(results.get("S14")?.outcome).toBe("not_measured");
  });
});

// ---------------------------------------------------------------------------
// §5.5 social and §5.6 advertising
// ---------------------------------------------------------------------------

describe("social presence", () => {
  it("counts linked profiles", () => {
    const results = byId(runFreeChecks(evidence({ pages: [readable(HEALTHY_HOMEPAGE)] })));
    expect(results.get("O1")?.outcome).toBe("passed");
    expect(results.get("O2")?.outcome).toBe("passed");
    expect(results.get("O4")?.outcome).toBe("passed");
    expect(results.get("O6")?.outcome).toBe("passed");
  });

  /**
   * "Share this on Facebook" appears on sites whose owner has no Facebook page at all. Counting
   * it would mean O2 quietly never fires — the check would look like it worked while measuring
   * the site's plugins instead of its social presence.
   */
  it("does not count a share button as a profile", () => {
    const body = `
      <a href="https://www.facebook.com/sharer/sharer.php?u=https://example.com">Share</a>
      <a href="https://twitter.com/intent/tweet?url=https://example.com">Tweet</a>`;
    const results = byId(runFreeChecks(evidence({ pages: [prose(body)] })));
    expect(results.get("O2")?.outcome).toBe("fired");
    expect(results.get("O1")?.outcome).toBe("fired");
  });

  it("does not count a bare platform link with no profile after it", () => {
    const body = '<a href="https://facebook.com/">Facebook</a>';
    expect(byId(runFreeChecks(evidence({ pages: [prose(body)] }))).get("O2")?.outcome).toBe("fired");
  });

  /**
   * From live data, and the reason this blind spot exists at all.
   *
   * `crystaldtf.com` was a Priority 1 lead carrying four fired social checks worth 95 points. Its
   * homepage links to no social platform whatsoever; all four of its profiles — Facebook,
   * Instagram, TikTok, YouTube — live on `crystaldtf.com/pages/socials`, which the crawl never
   * reached. Opening a call by telling that owner their socials are not connected would have been
   * wrong about the one thing they had visibly bothered to set up.
   */
  it("says nothing about social profiles when a socials page was linked but not read", () => {
    const results = byId(
      runFreeChecks(evidence({ pages: [readable("<html><body><h1>Crystal DTF</h1><p>Direct to film transfers, shipped fast.</p></body></html>")], socialPageUnread: true })),
    );
    for (const id of ["O1", "O2", "O4", "O6"]) {
      expect(results.get(id)?.outcome, id).toBe("not_measured");
    }
    expect(results.get("O2")?.evidence).toMatch(/could not be read/i);
  });

  it("still concludes normally when no socials page was linked", () => {
    const body = '<html><body><h1>Acme</h1><p>We print shirts in Dallas, Texas, every day.</p></body></html>';
    const results = byId(runFreeChecks(evidence({ pages: [readable(body)], socialPageUnread: false })));
    expect(results.get("O2")?.outcome).toBe("fired");
  });

  it("counts profiles found on a socials page, not only the homepage", () => {
    // The shape of the real fix: the crawler now fetches that page, so the links arrive as an
    // ordinary page of the crawl and the checks pass without any special case.
    const home = readable("<html><body><h1>Crystal DTF</h1><p>Direct to film transfers.</p></body></html>");
    const socials = {
      ...readable(
        `<html><body><h1>Follow us</h1>
         <a href="https://www.facebook.com/crystaldtftransfers">Facebook</a>
         <a href="https://www.instagram.com/crystaldtfofficial/">Instagram</a>
         <a href="https://www.tiktok.com/@crystaldtf.com">TikTok</a>
         <a href="https://www.youtube.com/@CrystalDTFOfficial">YouTube</a></body></html>`,
      ),
      role: "social" as const,
    };
    const results = byId(runFreeChecks(evidence({ pages: [home, socials] })));
    expect(results.get("O1")?.outcome).toBe("passed");
    expect(results.get("O2")?.outcome).toBe("passed");
    expect(results.get("O4")?.outcome).toBe("passed");
    expect(results.get("O6")?.outcome).toBe("passed");
  });

  it("fires 'almost no social footprint' below three platforms", () => {
    const html = '<html><body><a href="https://facebook.com/acme">f</a><a href="https://instagram.com/acme">i</a></body></html>';
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("O6")?.outcome).toBe("fired");
  });
});

describe("advertising and tracking", () => {
  it("finds an inline Meta Pixel, which has no script src to match on", () => {
    const html = "<html><head><script>!function(f,b,e,v,n,t,s){}(window);fbq('init','123');</script></head><body>x</body></html>";
    const results = byId(runFreeChecks(evidence({ pages: [readable(html)] })));
    expect(results.get("D2")?.outcome).toBe("passed");
    expect(results.get("D1")?.outcome).toBe("passed");
  });

  it("fires 'no tracking of any kind' on a site with none", () => {
    const results = byId(runFreeChecks(evidence({ pages: [readable("<html><body>plain</body></html>")] })));
    expect(results.get("D1")?.outcome).toBe("fired");
    expect(results.get("D2")?.outcome).toBe("fired");
    expect(results.get("D3")?.outcome).toBe("fired");
    expect(results.get("D4")?.outcome).toBe("fired");
  });

  /** With no pixel at all there is nothing for retargeting to be about; D1 already scored it. */
  it("does not charge the same absence twice through D6", () => {
    const results = byId(runFreeChecks(evidence({ pages: [readable("<html><body>plain</body></html>")] })));
    expect(results.get("D6")?.outcome).toBe("not_applicable");
  });

  it("fires D6 when analytics is installed but nothing retargets", () => {
    const html = '<html><head><script src="https://plausible.io/js/script.js"></script></head><body>x</body></html>';
    const results = byId(runFreeChecks(evidence({ pages: [readable(html)] })));
    expect(results.get("D4")?.outcome).toBe("passed");
    expect(results.get("D6")?.outcome).toBe("fired");
  });
});

// ---------------------------------------------------------------------------
// §5.4 R6 and §6.3 Intent
// ---------------------------------------------------------------------------

describe("reputation and intent", () => {
  it("sees reviews shown on the site", () => {
    expect(byId(runFreeChecks(evidence({ pages: [readable(HEALTHY_HOMEPAGE)] }))).get("R6")?.outcome).toBe("passed");
    expect(byId(runFreeChecks(evidence({ pages: [prose("<p>Nothing but shirts.</p>")] }))).get("R6")?.outcome).toBe("fired");
  });

  it("credits tracking as an intent signal", () => {
    expect(byId(runFreeChecks(evidence({ pages: [readable(HEALTHY_HOMEPAGE)] }))).get("N1")?.outcome).toBe("fired");
    expect(byId(runFreeChecks(evidence({ pages: [readable("<html><body>x</body></html>")] }))).get("N1")?.outcome).toBe("passed");
  });

  it("credits a site updated within the last year", () => {
    expect(byId(runFreeChecks(evidence({ pages: [readable(HEALTHY_HOMEPAGE)] }))).get("N6")?.outcome).toBe("fired");
  });

  it("does not credit a site whose only date is years old", () => {
    const html = "<html><body><footer>© 2021 Acme</footer></body></html>";
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("N6")?.outcome).toBe("passed");
  });

  it("credits a careers page", () => {
    const html = '<html><body><a href="/careers">Join our team</a></body></html>';
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("N9")?.outcome).toBe("fired");
  });

  it("credits a paid booking or chat widget", () => {
    const html = '<html><body><script src="https://embed.tawk.to/abc/default"></script></body></html>';
    expect(byId(runFreeChecks(evidence({ pages: [readable(html)] }))).get("N10")?.outcome).toBe("fired");
  });

  /** Intent is credits only: a missing signal adds nothing and never subtracts. */
  it("never awards a negative or oversized intent credit", () => {
    const results = runFreeChecks(evidence({ pages: [readable(HEALTHY_HOMEPAGE)] })).filter((r) => r.family === "N");
    const earned = results.reduce((sum, r) => sum + r.points, 0);
    expect(earned).toBeGreaterThanOrEqual(0);
    expect(earned).toBeLessThanOrEqual(CHECK_DEFINITIONS.filter((d) => d.family === "N").reduce((s, d) => s + d.points, 0));
  });
});

// ---------------------------------------------------------------------------
// A healthy site should mostly pass; a neglected one should mostly fire
// ---------------------------------------------------------------------------

describe("runFreeChecks — end to end on realistic pages", () => {
  it("finds little wrong with a well-built site", () => {
    const results = runFreeChecks(evidence({ pages: [readable(HEALTHY_HOMEPAGE)], sitemapFound: true, faviconFound: true, internalLinks: ["/a", "/b", "/c"] }));
    const fired = results.filter((r) => r.outcome === "fired" && r.family !== "N").map((r) => r.checkId);
    // D3 (no Google Ads tag) is the one genuine gap in the fixture; nothing else should fire.
    expect(fired).toEqual(["D3"]);
  });

  it("finds plenty wrong with a neglected one-pager", () => {
    const neglected = `<html><head><meta name="generator" content="Weebly"></head><body>
      <h1>Welcome</h1><p>We do printing.</p>${FILLER}<footer>© 2019</footer></body></html>`;
    const results = runFreeChecks(
      evidence({ pages: [readable(neglected)], httpsOk: false, internalLinks: [], sitemapFound: false, faviconFound: false }),
    );
    const fired = new Set(results.filter((r) => r.outcome === "fired").map((r) => r.checkId));
    for (const id of ["W4", "W5", "W8", "W9", "W10", "W11", "K1", "K3", "S9", "S11", "S12", "O1", "D1"]) {
      expect(fired.has(id), `${id} should have fired`).toBe(true);
    }
  });
});
