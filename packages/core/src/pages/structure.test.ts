import { describe, expect, it } from "vitest";
import { extractStructure } from "./structure.js";

/** A modern site: semantic elements, schema, the lot. */
const MODERN = `
<html><body>
  <header class="site-header">
    <a href="/"><img src="/logo.svg" alt="Crystal DTF"></a>
    <nav><a href="/shop">Shop</a><a href="/about">About</a><a href="/contact">Contact</a></nav>
    <a href="tel:+12145550123">Call (214) 555-0123</a>
    <a class="btn" href="/quote">Get a quote</a>
  </header>
  <main>
    <h1>DTF transfers, printed in Dallas</h1>
    <p>Gang sheets shipped next day, with no minimum order and no setup fees.</p>
    <section class="testimonials">
      <div class="testimonial"><p>Fast turnaround and the colours are spot on. Ordered three times now.</p><cite>Marcus B.</cite></div>
      <div class="testimonial"><p>Best DTF supplier we have used in Texas, and we have tried several.</p><cite>Dana R.</cite></div>
    </section>
    <form>
      <input name="name" required><input name="email" type="email" required>
      <textarea name="message"></textarea>
      <input type="hidden" name="csrf"><button type="submit">Request a quote</button>
    </form>
  </main>
  <footer class="site-footer">
    <address>1200 Elm St, Dallas, TX 75270</address>
    <p>Mon-Fri 9-5</p>
    <a href="https://instagram.com/crystaldtf">Instagram</a>
    <a href="https://facebook.com/crystaldtf">Facebook</a>
    <a href="/terms">Terms</a>
    <p>&copy; 2019-2026 Crystal DTF</p>
  </footer>
  <script type="application/ld+json">
    {"@type":"LocalBusiness","aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8"}}
  </script>
</body></html>`;

/** An old site: no semantic elements at all, everything is a div with a class. */
const LEGACY = `
<html><body>
  <div id="header"><img src="logo.gif"><a href="index.html">Home</a><a href="services.html">Services</a></div>
  <h1>Welcome</h1>
  <div id="footer"><p>Copyright 2017 Some Printing Co</p></div>
</body></html>`;

describe("extractStructure", () => {
  describe("header", () => {
    it("finds a semantic header and what is in it", () => {
      const s = extractStructure(MODERN);
      expect(s.header.present).toBe(true);
      expect(s.header.phone).toBe("tel:+12145550123");
      expect(s.header.hasLogo).toBe(true);
      expect(s.header.navLinks).toBeGreaterThanOrEqual(3);
    });

    /** Plenty of sites in this list predate <header>. Refusing to look would report "no header". */
    it("falls back to legacy class and id names", () => {
      const s = extractStructure(LEGACY);
      expect(s.header.present).toBe(true);
      expect(s.header.hasLogo).toBe(true);
      expect(s.header.phone).toBeNull();
    });

    it("says absent rather than inventing one", () => {
      const s = extractStructure("<html><body><p>Just text</p></body></html>");
      expect(s.header.present).toBe(false);
      expect(s.header.navLinks).toBe(0);
    });
  });

  describe("hero", () => {
    it("takes the h1 and the sentence under it", () => {
      const s = extractStructure(MODERN);
      expect(s.hero.h1).toBe("DTF transfers, printed in Dallas");
      expect(s.hero.subheading).toContain("Gang sheets shipped next day");
      expect(s.hero.h1Count).toBe(1);
    });

    /** More than one h1 means nothing on the page is the main heading — a real, checkable fault. */
    it("counts multiple h1s rather than silently taking the first", () => {
      const s = extractStructure("<h1>One</h1><h1>Two</h1><h1>Three</h1>");
      expect(s.hero.h1Count).toBe(3);
      expect(s.hero.h1).toBe("One");
    });

    it("reports no h1 as null, not as an empty string", () => {
      expect(extractStructure("<p>No heading here</p>").hero.h1).toBeNull();
    });
  });

  describe("reviews", () => {
    it("finds testimonials and the names attached to them", () => {
      const s = extractStructure(MODERN);
      expect(s.reviews.present).toBe(true);
      expect(s.reviews.count).toBeGreaterThanOrEqual(2);
      expect(s.reviews.named).toBeGreaterThanOrEqual(2);
    });

    it("reads a rating out of JSON-LD", () => {
      expect(extractStructure(MODERN).reviews.ratingShown).toBe("4.8");
    });

    it("reads a rating written as text when there is no schema", () => {
      const s = extractStructure("<body><p>Rated 4.6 out of 5 by our customers</p></body>");
      expect(s.reviews.ratingShown).toBe("4.6");
    });

    it("reports none rather than zero-with-present", () => {
      const s = extractStructure(LEGACY);
      expect(s.reviews.present).toBe(false);
      expect(s.reviews.count).toBe(0);
    });
  });

  describe("calls to action", () => {
    it("records the words, which are what gets judged", () => {
      const ctas = extractStructure(MODERN).ctas;
      expect(ctas.map((c) => c.text)).toContain("Get a quote");
      expect(ctas.map((c) => c.text)).toContain("Request a quote");
    });

    it("says which region each is in, because a footer CTA is not a CTA", () => {
      const ctas = extractStructure(MODERN).ctas;
      expect(ctas.find((c) => c.text === "Get a quote")?.region).toBe("header");
    });

    it("does not count ordinary links as calls to action", () => {
      const ctas = extractStructure(MODERN).ctas;
      expect(ctas.map((c) => c.text)).not.toContain("Terms");
      expect(ctas.map((c) => c.text)).not.toContain("About");
    });
  });

  describe("forms", () => {
    it("counts only the fields a visitor fills in", () => {
      const f = extractStructure(MODERN).forms;
      expect(f.count).toBe(1);
      // name, email, message — the hidden csrf and the submit button are not fields.
      expect(f.fields).toBe(3);
      expect(f.hasMessageBox).toBe(true);
      expect(f.requiredFields).toBe(2);
    });

    it("reports no forms honestly", () => {
      expect(extractStructure(LEGACY).forms.count).toBe(0);
    });
  });

  describe("footer", () => {
    it("finds the address, hours and social links", () => {
      const f = extractStructure(MODERN).footer;
      expect(f.present).toBe(true);
      expect(f.hasAddress).toBe(true);
      expect(f.hasHours).toBe(true);
      expect(f.social.sort()).toEqual(["facebook", "instagram"]);
    });

    /**
     * "© 2019-2026" must read as 2026. Taking the first year would report a site updated this year
     * as seven years abandoned — and "their site looks abandoned" is something an operator says out
     * loud on a call.
     */
    it("takes the most recent year from a copyright range", () => {
      expect(extractStructure(MODERN).footer.copyrightYear).toBe(2026);
    });

    it("reads a plain single year too", () => {
      expect(extractStructure(LEGACY).footer.copyrightYear).toBe(2017);
    });

    it("returns null when there is no copyright at all", () => {
      const s = extractStructure("<footer><p>Some text</p></footer>");
      expect(s.footer.copyrightYear).toBeNull();
    });
  });

  it("does not throw on empty or broken markup", () => {
    expect(() => extractStructure("")).not.toThrow();
    expect(() => extractStructure("<div><p>unclosed")).not.toThrow();
  });
});

/**
 * Found by running this against real pages rather than fixtures.
 *
 * crystaldtf.com's FAQ accordion produced "Can I order custom DTF transfers with my own design?"
 * as a call to action, matched on the word "order". It would have reached the critique as one of
 * the page's CTAs and been judged a poor one — a criticism of something that was never a CTA.
 */
describe("what is not a call to action", () => {
  it("ignores questions, however many action words they contain", () => {
    const s = extractStructure(`<a href="#faq">Can I order custom DTF transfers with my own design?</a>`);
    expect(s.ctas).toHaveLength(0);
  });

  it("ignores sentences, which are prose rather than buttons", () => {
    const s = extractStructure(`<a href="/x">Call us today to book your free consultation and quote</a>`);
    expect(s.ctas).toHaveLength(0);
  });

  it("still keeps the short imperative ones", () => {
    const s = extractStructure(`<a href="/q">Get a quote</a><a href="/c">Call now</a><a href="/s">Shop now</a>`);
    expect(s.ctas.map((c) => c.text)).toEqual(["Get a quote", "Call now", "Shop now"]);
  });
});
