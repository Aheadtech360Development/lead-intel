/**
 * Working out what a page is for.
 *
 * Everything downstream depends on this. A checklist for a services page applied to a blog post
 * produces confident nonsense, so a wrong answer here is worse than no answer — which is why
 * `other` exists and is used freely.
 *
 * **Three signals, deliberately.** A URL alone lies often enough to matter: measuring the operator's
 * own list found 187 of 240 sites using the word "shop" while only 26 have a cart, because a print
 * shop calls itself a shop. So the path is read alongside the words on the link that pointed here
 * and the page's own headings, and agreement between them is what raises confidence.
 *
 * Pure: strings in, a verdict out.
 */

export const PAGE_TYPES = [
  "home",
  "services",
  "products",
  "pricing",
  "about",
  "contact",
  "reviews",
  "blog",
  "other",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];

export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  home: "Home page",
  services: "What they do",
  products: "Things they sell",
  pricing: "Prices",
  about: "About them",
  contact: "Contact or booking",
  reviews: "Reviews and testimonials",
  blog: "Blog or news",
  other: "Something else",
};

export interface PageEvidence {
  url: string;
  /** The words on the link that led here — often clearer than the path. */
  linkText?: string | null;
  title?: string | null;
  headings?: string[];
  /** Visible text, used only to break ties the other signals leave open. */
  text?: string | null;
}

export interface PageClassification {
  type: PageType;
  /**
   * How much to trust it.
   *
   * `certain` is reserved for the home page, which is the one case with no ambiguity at all.
   * A checklist may want to skip anything below `likely` rather than judge a page it guessed at.
   */
  confidence: "certain" | "likely" | "guess";
  /** What decided it, in words, so a wrong classification can be traced rather than argued with. */
  because: string;
}

/**
 * Patterns matched against a path, a link's words, or a heading. Most specific first — `/pricing`
 * before `/services`, so `/services/pricing` lands on prices.
 *
 * Separators are `[-_\s]?` rather than `-?` because the same phrase arrives punctuated three
 * different ways: `/what-we-do` in a path, `what we do` in link text, `What We Do` in a heading. The
 * first version of this only allowed hyphens, and silently failed on every heading — caught by the
 * test that feeds it "What our customers say".
 */
const SEP = "[-_\\s]?";
const PATH_PATTERNS: { type: PageType; pattern: RegExp; name: string }[] = [
  { type: "pricing", pattern: /\b(pricing|prices|rates|cost|quote|estimate)\b/i, name: "pricing" },
  {
    type: "contact",
    pattern: new RegExp(`\\b(contact|book|booking|appointment|schedule|get${SEP}in${SEP}touch|reach${SEP}us)\\b`, "i"),
    name: "contact",
  },
  {
    type: "reviews",
    pattern: new RegExp(
      `\\b(reviews?|testimonials?|feedback|what${SEP}(our${SEP})?(clients?|customers?)${SEP}say)\\b`,
      "i",
    ),
    name: "reviews",
  },
  { type: "blog", pattern: /\b(blog|news|articles?|posts?|journal|updates?)\b/i, name: "blog" },
  {
    type: "about",
    pattern: new RegExp(`\\b(about|our${SEP}story|who${SEP}we${SEP}are|team|meet${SEP}the)\\b`, "i"),
    name: "about",
  },
  { type: "products", pattern: /\b(products?|shop|store|catalog(ue)?|collections?|merch)\b/i, name: "products" },
  {
    type: "services",
    pattern: new RegExp(`\\b(services?|what${SEP}we${SEP}do|offerings?|capabilities|solutions)\\b`, "i"),
    name: "services",
  },
];

/**
 * Words that mean a page sells individual items rather than describing work.
 *
 * The distinction the operator's list demands: only 26 of 240 sites have a cart, so `/shop` usually
 * means "here is what we do", not "add to basket". These are the words that separate the two, and
 * they only ever appear on a page that genuinely transacts.
 */
const COMMERCE_WORDS = /\b(add to (cart|bag|basket)|buy now|checkout|in stock|out of stock|sku\b|£|\$\d)/i;

export function classifyPage(evidence: PageEvidence): PageClassification {
  const path = safePath(evidence.url);

  /**
   * The root is the one page with no ambiguity — but only when the address was a real one.
   *
   * `new URL("https://!!!")` parses, and its pathname is "/", so garbage in the URL field came back
   * as a confident "home page". A test caught it. An unparseable address is a fact about our data,
   * not a page type, and calling it the home page would put a checklist for the most important page
   * on the site against something that is not a page at all.
   */
  if (path === null) {
    return { type: "other", confidence: "guess", because: `"${evidence.url}" is not a usable web address.` };
  }

  if (path === "" || path === "/" || /^\/(index|home)(\.[a-z]+)?$/i.test(path)) {
    return { type: "home", confidence: "certain", because: "It is the site's root address." };
  }

  const linkText = (evidence.linkText ?? "").trim();
  const headingText = [evidence.title ?? "", ...(evidence.headings ?? [])].join(" ").trim();

  const fromPath = PATH_PATTERNS.find((p) => p.pattern.test(path));
  const fromLink = linkText ? PATH_PATTERNS.find((p) => p.pattern.test(linkText)) : undefined;
  const fromHeading = headingText ? PATH_PATTERNS.find((p) => p.pattern.test(headingText)) : undefined;

  // Two signals agreeing is the strongest ordinary evidence available, and it is what separates a
  // real classification from a lucky word in a URL slug.
  const agreed = [fromPath, fromLink, fromHeading].filter(Boolean) as { type: PageType; name: string }[];
  const counts = new Map<PageType, number>();
  for (const a of agreed) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);

  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) {
    return { type: "other", confidence: "guess", because: "Nothing in the address, the link or the headings said what this page is." };
  }

  let [type, votes] = best;

  /**
   * The products/services correction, which is the whole reason content is read at all.
   *
   * A page at `/shop` with no cart, no prices and no stock language is a services page wearing a
   * shop's clothes — the common case in this list, not the exception. Demoting it matters because
   * the product checklist asks about baskets and delivery, and a print shop's services page fails
   * every one of those questions for no reason at all.
   */
  if (type === "products" && !COMMERCE_WORDS.test(evidence.text ?? "")) {
    type = "services";
    return {
      type,
      confidence: "guess",
      because: `The address says "shop" or "products", but there is no cart, price or stock wording on the page — so this reads as a services page.`,
    };
  }

  const source = fromPath ? "the address" : fromLink ? "the link that led here" : "the page's own headings";
  return {
    type,
    confidence: votes >= 2 ? "likely" : "guess",
    because:
      votes >= 2
        ? `${votes} of the address, the link text and the headings agree this is a ${PAGE_TYPE_LABELS[type].toLowerCase()}.`
        : `Only ${source} suggests this is a ${PAGE_TYPE_LABELS[type].toLowerCase()}.`,
  };
}

/**
 * The path alone, lowercased, or null when the address is not usable.
 *
 * Null rather than a fallback string, because the caller has to tell "this page is at the root"
 * apart from "this is not an address". `new URL` is more forgiving than it looks — it accepts
 * `https://!!!` and reports a pathname of "/" — so the hostname is checked for at least one dot
 * and one letter before the path is trusted.
 */
function safePath(url: string): string | null {
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    if (!/[a-z]/i.test(parsed.hostname) || !parsed.hostname.includes(".")) return null;
    return parsed.pathname.toLowerCase();
  } catch {
    return null;
  }
}
