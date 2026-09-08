import { describe, expect, it } from "vitest";
import { choosePages } from "./discover.js";

const HOME = "https://dtfdallas.com/";

describe("choosePages", () => {
  it("always starts at the home page", () => {
    const picked = choosePages({ homeUrl: HOME, links: [] });
    expect(picked).toHaveLength(1);
    expect(picked[0]?.type).toBe("home");
  });

  /**
   * The rule the whole function exists for. A blog-heavy site offers dozens of posts; taking links
   * in the order they appear would audit eight of them and never open the services page.
   */
  it("takes variety of page type before quantity", () => {
    const links = [
      { url: "/blog/post-1" },
      { url: "/blog/post-2" },
      { url: "/blog/post-3" },
      { url: "/blog/post-4" },
      { url: "/blog/post-5" },
      { url: "/services" },
      { url: "/contact" },
    ];
    const types = choosePages({ homeUrl: HOME, links }).map((p) => p.type);
    expect(types).toContain("services");
    expect(types).toContain("contact");
    // One blog post, not five. Spare budget is not a reason to audit four more of the least
    // informative page type on the site.
    expect(types.filter((t) => t === "blog")).toHaveLength(1);
    expect(types.length).toBeLessThan(8);
  });

  it("prefers the more useful page types when the budget is tight", () => {
    const links = [{ url: "/blog/a" }, { url: "/about" }, { url: "/services" }];
    const types = choosePages({ homeUrl: HOME, links, budget: 3 }).map((p) => p.type);
    expect(types).toEqual(["home", "services", "contact"].slice(0, 2).concat(types.slice(2)));
    expect(types[1]).toBe("services");
    expect(types).not.toContain("blog");
  });

  it("does not audit the same page twice when the site links it three times", () => {
    const links = [
      { url: "/contact" },
      { url: "/contact/" },
      { url: "https://dtfdallas.com/contact" },
      { url: "/contact?utm_source=nav" },
      { url: "/contact#form" },
    ];
    expect(choosePages({ homeUrl: HOME, links })).toHaveLength(2);
  });

  it("stays on the site", () => {
    const links = [
      { url: "https://facebook.com/dtfdallas" },
      { url: "https://instagram.com/dtfdallas" },
      { url: "/services" },
    ];
    const picked = choosePages({ homeUrl: HOME, links });
    expect(picked).toHaveLength(2);
    expect(picked[1]?.url).toContain("dtfdallas.com/services");
  });

  it("treats www and bare host as one site", () => {
    const picked = choosePages({
      homeUrl: HOME,
      links: [{ url: "https://www.dtfdallas.com/services" }],
    });
    expect(picked).toHaveLength(2);
  });

  it("ignores mailto, tel and javascript links", () => {
    const links = [{ url: "mailto:a@b.com" }, { url: "tel:+12145550123" }, { url: "javascript:void(0)" }];
    expect(choosePages({ homeUrl: HOME, links })).toHaveLength(1);
  });

  it("never exceeds the budget", () => {
    const links = Array.from({ length: 60 }, (_, i) => ({ url: `/page-${i}` }));
    expect(choosePages({ homeUrl: HOME, links }).length).toBeLessThanOrEqual(8);
  });

  it("uses the link's words when the address gives nothing away", () => {
    const picked = choosePages({ homeUrl: HOME, links: [{ url: "/p/8821", linkText: "Book an appointment" }] });
    expect(picked[1]?.type).toBe("contact");
  });

  it("prefers a confident match over a guess for the same type", () => {
    const picked = choosePages({
      homeUrl: HOME,
      links: [{ url: "/p/1", linkText: "get in touch" }, { url: "/contact", linkText: "Contact us" }],
      budget: 2,
    });
    expect(picked[1]?.url).toContain("/contact");
  });

  it("caps repeats of a type rather than filling the budget for its own sake", () => {
    const links = [
      { url: "/services/printing" },
      { url: "/services/embroidery" },
      { url: "/services/signage" },
      { url: "/services/vinyl" },
    ];
    const types = choosePages({ homeUrl: HOME, links }).map((p) => p.type);
    expect(types.filter((t) => t === "services")).toHaveLength(2);
  });

  it("survives links that are not URLs at all", () => {
    expect(() => choosePages({ homeUrl: HOME, links: [{ url: "" }, { url: "###" }] })).not.toThrow();
  });
});

/**
 * Found by auditing a real Shopify site. `/customer_authentication/redirect` and `/search` were
 * both rendered — eight seconds between them, on a login bounce and an empty search form. Neither
 * is a page a visitor browses to, and both crowded out a real page that would have fitted.
 */
describe("pages that are machinery, not pages", () => {
  it("skips cart, checkout, account and login paths", () => {
    const links = [
      { url: "/cart" },
      { url: "/checkout" },
      { url: "/account/login" },
      { url: "/customer_authentication/redirect" },
      { url: "/search" },
      { url: "/services" },
    ];
    const picked = choosePages({ homeUrl: HOME, links });
    expect(picked).toHaveLength(2);
    expect(picked[1]?.url).toContain("/services");
  });

  it("does not mistake a real page for machinery", () => {
    // `/pages/about-us` contains no utility segment; `/searchlight-signs` merely starts with the
    // same letters and must survive.
    const picked = choosePages({
      homeUrl: HOME,
      links: [{ url: "/pages/about-us" }, { url: "/searchlight-signs" }],
    });
    expect(picked).toHaveLength(3);
  });

  it("skips files, which render as nothing at all", () => {
    const picked = choosePages({ homeUrl: HOME, links: [{ url: "/price-list.pdf" }, { url: "/logo.png" }] });
    expect(picked).toHaveLength(1);
  });
});
