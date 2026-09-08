import type { Page } from "playwright";
import type { LayoutFacts } from "./types.js";

/**
 * Measures the page as the visitor's browser laid it out.
 *
 * Everything here is a question the HTML cannot answer. Markup says a phone number exists; only a
 * rendered page says whether it is visible before scrolling. Markup says an image is there; only
 * the browser knows it rendered at zero by zero because the file 404s. This is the reason the whole
 * plan chose a browser over plain HTTP, so it is worth taking properly.
 *
 * The function body runs **inside the page**, so it can use no imports and nothing from this
 * module's scope. It must also survive hostile pages: a site that overrides `Array.prototype` or
 * throws from a getter should cost us this measurement, not the whole render.
 */
export async function measureLayout(page: Page): Promise<LayoutFacts | null> {
  try {
    return await page.evaluate(() => {
      const viewportWidth = window.innerWidth;
      const fold = window.innerHeight;

      const visible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
      };

      // "Above the fold" is measured from the top of the document, not the current scroll position:
      // the page has just loaded and has not been scrolled, but reading it this way makes the
      // measurement independent of that assumption.
      const aboveFold = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        return visible(el) && rect.top < fold;
      };

      const phoneLink = [...document.querySelectorAll('a[href^="tel:"]')].find(aboveFold) ?? null;

      // A call to action is a link or button whose words ask for the next step. Matching on the
      // words rather than the styling, because every site styles them differently and they all
      // write roughly the same six phrases.
      // Includes the weak labels on purpose — see CTA_WORDS in packages/core/src/pages/
      // structure.ts. A generic button is the fault worth reporting, and filtering it out
      // would hide exactly what needs judging.
      const CTA_WORDS = /\b(call|book|quote|contact|order|shop now|get started|schedule|enquire|inquire|buy|request|submit|send|apply|learn more|click here|read more|sign up|subscribe|download|reserve)\b/i;
      const ctaEl =
        [...document.querySelectorAll('a, button, input[type="submit"]')].find((el) => {
          const text = (el.textContent ?? (el as HTMLInputElement).value ?? "").trim();
          return text.length > 0 && text.length < 60 && CTA_WORDS.test(text) && aboveFold(el);
        }) ?? null;

      let tinyTextCount = 0;
      let smallTapTargets = 0;
      // Capped: a page with 40,000 nodes should cost a bounded amount of time, and the counts are
      // only ever read as "some" or "a lot".
      const elements = [...document.querySelectorAll("body *")].slice(0, 4000);

      for (const el of elements) {
        try {
          const own = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 3);
          if (own) {
            const size = parseFloat(window.getComputedStyle(el).fontSize);
            if (Number.isFinite(size) && size < 12 && visible(el)) tinyTextCount += 1;
          }
          if (el.tagName === "A" || el.tagName === "BUTTON") {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && (rect.width < 32 || rect.height < 32)) smallTapTargets += 1;
          }
        } catch {
          // One awkward element must not cost the whole measurement.
        }
      }

      /**
       * Broken images, and the trap in counting them.
       *
       * The obvious test — `complete && naturalWidth === 0` — counts every lazy-loaded image that
       * has not scrolled into view yet. On a Shopify theme that is most of the page: the first
       * version of this reported **184 broken images** on crystaldtf.com, a real Priority 1 lead,
       * where almost none were broken. Saying that on a call would be the same mistake as the
       * false "your social links are not connected" that this project has already made once.
       *
       * `currentSrc` is the discriminator. The browser only sets it once it has actually chosen a
       * source and tried to fetch it, so an image with no `currentSrc` was never asked for and
       * cannot be broken. What is left is an image the browser tried to load and could not.
       */
      const brokenImages = [...document.querySelectorAll("img")].filter(
        (img) => img.currentSrc !== "" && img.complete && img.naturalWidth === 0,
      ).length;

      const landmark = (tag: string, ...roles: string[]): boolean => {
        if (document.querySelector(tag)) return true;
        return roles.some((r) => document.querySelector(`[role="${r}"], .${r}, #${r}`) !== null);
      };

      return {
        viewportWidth,
        documentHeight: Math.round(document.documentElement.scrollHeight),
        // A few pixels of overflow is a rounding artefact, not a broken layout.
        scrollsSideways: document.documentElement.scrollWidth > viewportWidth + 4,
        hasHeader: landmark("header", "banner", "header"),
        hasFooter: landmark("footer", "contentinfo", "footer"),
        phoneAboveFold: phoneLink !== null,
        ctaAboveFold: ctaEl ? (ctaEl.textContent ?? "").trim().slice(0, 60) : null,
        tinyTextCount,
        smallTapTargets,
        brokenImages,
      };
    });
  } catch {
    // Returned as null, never thrown. A page that defeats the measurement still has readable HTML,
    // and losing the whole render over a layout probe would be the wrong trade.
    return null;
  }
}
