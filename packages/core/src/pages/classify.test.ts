import { describe, expect, it } from "vitest";
import { classifyPage } from "./classify.js";

describe("classifyPage", () => {
  it("knows the home page for certain", () => {
    for (const url of ["https://x.com", "https://x.com/", "https://x.com/index.html", "https://x.com/home"]) {
      const found = classifyPage({ url });
      expect(found.type).toBe("home");
      expect(found.confidence).toBe("certain");
    }
  });

  it("reads the obvious page types from the address", () => {
    expect(classifyPage({ url: "https://x.com/contact-us" }).type).toBe("contact");
    expect(classifyPage({ url: "https://x.com/about" }).type).toBe("about");
    expect(classifyPage({ url: "https://x.com/pricing" }).type).toBe("pricing");
    expect(classifyPage({ url: "https://x.com/blog/how-to-print" }).type).toBe("blog");
    expect(classifyPage({ url: "https://x.com/testimonials" }).type).toBe("reviews");
  });

  it("puts pricing ahead of services when a path could be either", () => {
    // /services/pricing is a prices page, and the checklist for one asks different questions.
    expect(classifyPage({ url: "https://x.com/services/pricing" }).type).toBe("pricing");
  });

  it("uses the link text when the address says nothing", () => {
    const found = classifyPage({ url: "https://x.com/p/2847", linkText: "Book an appointment" });
    expect(found.type).toBe("contact");
    expect(found.because).toContain("link");
  });

  it("uses the page's own headings as a third opinion", () => {
    const found = classifyPage({ url: "https://x.com/p/2847", headings: ["What our customers say"] });
    expect(found.type).toBe("reviews");
  });

  it("is more confident when two signals agree than when one does", () => {
    const one = classifyPage({ url: "https://x.com/about" });
    const two = classifyPage({ url: "https://x.com/about", linkText: "About us" });
    expect(one.confidence).toBe("guess");
    expect(two.confidence).toBe("likely");
    expect(two.because).toContain("agree");
  });

  /**
   * The correction the operator's own data demanded. Of 240 sites with readable text, 187 use the
   * word "shop" and only 26 have a cart — a print shop calls itself a shop. Sending those to the
   * product checklist would fail them on baskets and delivery they were never going to have.
   */
  describe("shop pages that are not shops", () => {
    it("demotes /shop to services when nothing on the page transacts", () => {
      const found = classifyPage({
        url: "https://dtfdallas.com/shop",
        text: "We print DTF transfers and gang sheets for businesses across Texas. Call for a quote.",
      });
      expect(found.type).toBe("services");
      expect(found.because).toContain("no cart, price or stock wording");
    });

    it("keeps it as products when the page really does sell", () => {
      const found = classifyPage({
        url: "https://x.com/shop",
        text: "Gang sheet 22x60 — $18.99. Add to cart. In stock, ships same day.",
      });
      expect(found.type).toBe("products");
    });

    it("accepts any one commerce signal, not all of them", () => {
      expect(classifyPage({ url: "https://x.com/products", text: "Add to basket" }).type).toBe("products");
      expect(classifyPage({ url: "https://x.com/products", text: "Proceed to checkout" }).type).toBe("products");
      expect(classifyPage({ url: "https://x.com/products", text: "Currently out of stock" }).type).toBe("products");
    });
  });

  /** `other` is a real answer. Guessing a type for an unknown page is how a checklist invents faults. */
  it("says other rather than guessing", () => {
    const found = classifyPage({ url: "https://x.com/x7f2a9" });
    expect(found.type).toBe("other");
    expect(found.because).toContain("Nothing in the address");
  });

  it("does not throw on a URL it cannot parse", () => {
    expect(() => classifyPage({ url: "not a url at all" })).not.toThrow();
    expect(classifyPage({ url: "!!!" }).type).toBe("other");
  });

  it("matches whole words, so a slug cannot smuggle a type in", () => {
    // "abouts" would be a false match for /about under a naive substring test.
    expect(classifyPage({ url: "https://x.com/roundabouts" }).type).toBe("other");
    expect(classifyPage({ url: "https://x.com/newsletter" }).type).toBe("other");
  });
});
