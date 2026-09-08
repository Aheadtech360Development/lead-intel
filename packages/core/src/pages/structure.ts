import * as cheerio from "cheerio";

/**
 * Splitting a page into the parts a person sees.
 *
 * Until now a page was one long string of text, which is why no check could ever say anything about
 * the header or the footer specifically — the operator's original request. This finds the regions
 * and reports what is in each.
 *
 * **Absence is reported, never inferred.** A page with no footer gets `present: false`, not an
 * invented one assembled from whatever sat at the bottom. Every field below can say "not found",
 * because a checklist that cannot tell "they have no phone number in the header" from "we could not
 * find the header" will eventually tell an operator the first when it means the second.
 *
 * Pure: HTML in, facts out. The measurements that need a rendered page live in the renderer's
 * `measureLayout`, and the two are combined by the caller.
 */

/** Whatever a cheerio selection is in the installed version. Derived, so a cheerio upgrade
 *  cannot silently change what this file claims. */
type Selection = ReturnType<cheerio.CheerioAPI>;

export interface PageStructure {
  header: {
    present: boolean;
    navLinks: number;
    /** A `tel:` link inside the header — the fastest thing a visitor can act on. */
    phone: string | null;
    hasLogo: boolean;
  };
  hero: {
    /** The page's single most important sentence, or null when it has none. */
    h1: string | null;
    /** More than one h1 is a real fault: nothing on the page is then the main heading. */
    h1Count: number;
    /** The first paragraph after the h1 — usually the sentence that says what they do. */
    subheading: string | null;
  };
  reviews: {
    present: boolean;
    /** How many distinct review blocks were found. Zero with `present: true` never happens. */
    count: number;
    /** Reviews carrying a person's name read as real; anonymous ones do not. */
    named: number;
    /** A star rating rendered as text or as a schema value. */
    ratingShown: string | null;
  };
  /** Every call to action, with the words on it — the words are what the critique judges. */
  ctas: { text: string; region: "header" | "hero" | "body" | "footer" }[];
  forms: {
    count: number;
    /** Fields across all forms. A twelve-field enquiry form is a real reason nobody enquires. */
    fields: number;
    hasMessageBox: boolean;
    requiredFields: number;
  };
  /**
   * Every social account linked from anywhere on the page, with its address.
   *
   * **Page-wide, not footer-scoped, and that distinction was learned the hard way.** The first
   * version looked only inside the footer, because that is where these usually sit. On
   * a4graphic.com the footer was found on all five pages and every one reported no social links —
   * while the page plainly linked `instagram.com/a4_graphic_miami`, from a bar that is not the
   * footer. Headers, floating rails and "follow us" strips carry these just as often.
   *
   * `footer.social` below stays footer-scoped and unchanged: it answers a different question — "do
   * they bother putting these in the footer" — which is what a checklist rule asks. This answers
   * "which account", which is what an operator asks, because a follower count cannot be bought
   * without it.
   */
  socialLinks: { platform: string; url: string }[];

  footer: {
    present: boolean;
    hasAddress: boolean;
    hasHours: boolean;
    /** Platform links found in the footer, by platform name. */
    social: string[];

    /** The most recent copyright year, or null. A 2019 footer says the site was abandoned. */
    copyrightYear: number | null;
    navLinks: number;
  };
}

/**
 * Words that mean "act now" — including the weak ones, deliberately.
 *
 * "Submit", "Send" and "Click here" were missing from the first version, and that was
 * backwards. A generic button label is exactly the fault the critique exists to notice: a form
 * whose button says "Submit" asks for nothing in particular, and it is among the most common
 * weaknesses on a small business site. Filtering those out meant the extractor found only the
 * good calls to action and the model was never shown a bad one to judge.
 *
 * Kept in step with the same list in the renderer's layout probe.
 */
const CTA_WORDS =
  /\b(call|book|quote|contact|order|shop now|get started|schedule|enquire|inquire|buy|request|submit|send|apply|learn more|click here|read more|sign up|subscribe|download|reserve)\b/i;

const SOCIAL_HOSTS: { platform: string; pattern: RegExp }[] = [
  { platform: "instagram", pattern: /instagram\.com/i },
  { platform: "facebook", pattern: /facebook\.com/i },
  { platform: "tiktok", pattern: /tiktok\.com/i },
  { platform: "youtube", pattern: /youtube\.com|youtu\.be/i },
  { platform: "x", pattern: /twitter\.com|x\.com/i },
  { platform: "linkedin", pattern: /linkedin\.com/i },
];

export function extractStructure(html: string): PageStructure {
  const $ = cheerio.load(html);

  // Semantic elements first, then the class and id names sites used before those existed. Plenty of
  // the sites in this list are old enough to predate <header>, and refusing to look for `.header`
  // would report "no header" on a page that plainly has one.
  const header = pick($, "header, [role=banner]", ".header, #header, .site-header, .navbar, .top-bar");
  const footer = pick($, "footer, [role=contentinfo]", ".footer, #footer, .site-footer");

  const h1s = $("h1")
    .map((_, el) => text($(el)))
    .get()
    .filter((t) => t.length > 0);

  return {
    // The whole document, not one region. See the note on socialLinks in PageStructure.
    socialLinks: socialIn($.root()),

    header: {
      present: header !== null,
      navLinks: header ? header.find("a").length : 0,
      phone: header ? (header.find('a[href^="tel:"]').first().attr("href") ?? null) : null,
      hasLogo: header ? header.find("img, svg").length > 0 : false,
    },
    hero: {
      h1: h1s[0] ?? null,
      h1Count: h1s.length,
      subheading: firstParagraphAfterH1($),
    },
    reviews: extractReviews($),
    ctas: extractCtas($, header, footer),
    forms: extractForms($),
    footer: {
      present: footer !== null,
      // An <address> element, or a postcode-shaped string, or a schema address. Anything less is a
      // guess — a street name in prose is not an address block.
      hasAddress: footer
        ? footer.find("address").length > 0 || /\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(footer.text())
        : false,
      hasHours: footer ? /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b.{0,20}\d|opening hours|hours:/i.test(footer.text()) : false,
      social: footer ? socialIn(footer).map((l) => l.platform) : [],
      copyrightYear: footer ? latestCopyrightYear(footer.text()) : null,
      navLinks: footer ? footer.find("a").length : 0,
    },
  };
}

/** The first selector that matches anything, semantic before legacy. Null when neither does. */
function pick($: cheerio.CheerioAPI, semantic: string, legacy: string): Selection | null {
  const bySemantic = $(semantic).first();
  if (bySemantic.length > 0) return bySemantic;
  const byLegacy = $(legacy).first();
  return byLegacy.length > 0 ? (byLegacy) : null;
}

function text(node: Selection): string {
  return node.text().replace(/\s+/g, " ").trim();
}

/**
 * The sentence under the main heading.
 *
 * Usually the one that says what the business actually does, and the one a critique can judge for
 * clarity. Taken as the first non-trivial paragraph following the h1 in document order — anything
 * cleverer starts guessing at page structure that varies too much to model.
 */
function firstParagraphAfterH1($: cheerio.CheerioAPI): string | null {
  const h1 = $("h1").first();
  if (h1.length === 0) return null;

  const following = h1.nextAll("p, h2, .subtitle, .subheading").first();
  const candidate = text(following);
  if (candidate.length >= 15) return candidate.slice(0, 300);

  // The h1 is often wrapped, so the next paragraph is a sibling of an ancestor rather than of the
  // heading itself.
  const fromParent = h1.parent().nextAll("p, h2").first();
  const parentCandidate = text(fromParent);
  return parentCandidate.length >= 15 ? parentCandidate.slice(0, 300) : null;
}

function extractReviews($: cheerio.CheerioAPI): PageStructure["reviews"] {
  // Three independent signals, because review widgets share no markup: schema.org Review objects,
  // conventional class names, and the wording sites put above them.
  const schemaReviews = $('[itemtype*="Review" i], [itemprop="review"]').length;
  const classed = $('[class*="review" i], [class*="testimonial" i]').filter((_, el) => {
    const t = $(el).text().trim();
    // A container wrapping the whole section matches too; requiring some text of its own keeps the
    // count to actual reviews rather than the section around them.
    return t.length > 40 && t.length < 2000;
  }).length;

  const jsonLdRating = readJsonLdRating($);
  const textRating = /\b([1-5](\.\d)?)\s*(out of|\/)\s*5\b/i.exec($("body").text())?.[1] ?? null;

  const count = Math.max(schemaReviews, classed);
  const named = $('[itemprop="author"], [class*="review" i] [class*="name" i], [class*="testimonial" i] cite').length;

  return {
    present: count > 0,
    count,
    named,
    ratingShown: jsonLdRating ?? textRating,
  };
}

function readJsonLdRating($: cheerio.CheerioAPI): string | null {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed: unknown = JSON.parse($(el).text());
      const found = findRating(parsed);
      if (found) return found;
    } catch {
      // Malformed JSON-LD is extremely common and is not this function's problem.
    }
  }
  return null;
}

function findRating(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRating(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (obj.ratingValue !== undefined) return String(obj.ratingValue);
  for (const key of ["aggregateRating", "review", "@graph"]) {
    if (obj[key] !== undefined) {
      const found = findRating(obj[key]);
      if (found) return found;
    }
  }
  return null;
}

function extractCtas(
  $: cheerio.CheerioAPI,
  header: Selection | null,
  footer: Selection | null,
): PageStructure["ctas"] {
  const seen = new Set<string>();
  const out: PageStructure["ctas"] = [];

  $('a, button, input[type="submit"]').each((_, el) => {
    const node = $(el);
    const label = (node.attr("value") ?? node.text()).replace(/\s+/g, " ").trim();
    if (label.length === 0 || !CTA_WORDS.test(label)) return;

    /**
     * A question is never a call to action.
     *
     * Running this against crystaldtf.com pulled in "Can I order custom DTF transfers with my own
     * design?" — an FAQ accordion, matched on the word "order". It would have been handed to the
     * critique as one of the page's calls to action, and judged as a bad one, which is a criticism
     * of something that was never trying to be a CTA.
     *
     * Length is the same guard from the other direction: a real call to action is a handful of
     * words on a button. Anything past thirty characters is a sentence, and sentences are prose.
     */
    if (label.endsWith("?") || label.length > 30) return;

    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    // Region matters to the critique: a "Get a quote" in the header is doing a different job from
    // the same words buried in the footer, and only one of them is a call to action.
    const inHeader = header !== null && header.find(el as never).length > 0;
    const inFooter = footer !== null && footer.find(el as never).length > 0;
    const nearTop = $("h1").first().nextAll().find(el as never).length > 0;

    out.push({
      text: label,
      region: inHeader ? "header" : inFooter ? "footer" : nearTop ? "hero" : "body",
    });
  });

  return out.slice(0, 20);
}

function extractForms($: cheerio.CheerioAPI): PageStructure["forms"] {
  const forms = $("form");
  let fields = 0;
  let required = 0;
  let messageBox = false;

  forms.each((_, form) => {
    const inputs = $(form).find("input, textarea, select").filter((_, el) => {
      const type = ($(el).attr("type") ?? "").toLowerCase();
      // Hidden and submit inputs are not things a visitor fills in, and counting them would make
      // every form look longer than it is.
      return type !== "hidden" && type !== "submit" && type !== "button";
    });
    fields += inputs.length;
    required += inputs.filter((_, el) => $(el).attr("required") !== undefined).length;
    if ($(form).find("textarea").length > 0) messageBox = true;
  });

  return { count: forms.length, fields, hasMessageBox: messageBox, requiredFields: required };
}

function socialIn(node: Selection): { platform: string; url: string }[] {
  // First link per platform wins. A footer that lists Instagram twice is one account, and a page
  // that links a personal and a business account puts the business one first almost every time.
  const found = new Map<string, string>();
  node.find("a[href]").each((_, el) => {
    const href = (el as unknown as { attribs?: Record<string, string> }).attribs?.href ?? "";
    for (const { platform, pattern } of SOCIAL_HOSTS) {
      if (pattern.test(href) && !found.has(platform)) found.set(platform, href);
    }
  });
  return [...found].map(([platform, url]) => ({ platform, url }));
}

/**
 * The most recent year next to a copyright marker.
 *
 * The most recent, not the first: footers routinely read "© 2018-2026", and taking the first would
 * report a site as six years stale on the day it was updated.
 */
function latestCopyrightYear(text: string): number | null {
  const years: number[] = [];
  const pattern = /(?:©|&copy;|copyright)\D{0,20}((?:19|20)\d{2})(?:\s*[-–—]\s*((?:19|20)\d{2}))?/gi;
  for (const match of text.matchAll(pattern)) {
    if (match[1]) years.push(Number(match[1]));
    if (match[2]) years.push(Number(match[2]));
  }
  return years.length > 0 ? Math.max(...years) : null;
}
