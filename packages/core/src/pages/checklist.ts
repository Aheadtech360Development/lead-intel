import type { PageStructure } from "./structure.js";
import type { PageType } from "./classify.js";

/**
 * The operator's own definition of what a good page looks like, and the machinery that checks it.
 *
 * Two decisions shape everything here.
 *
 * **The things a rule can ask about are a closed list, not free text.** A rule referring to
 * `header.phon` would type-check as a string, save cleanly, and then never fire — silently, for
 * ever. So the editor offers a menu built from `CHECKABLE_FIELDS` and a rule can only name
 * something that exists. The same list gives the UI its plain-language labels, so nobody has to
 * know that "does the header have a phone number" is `header.phone`.
 *
 * **A rule can answer "I do not know".** If a page never rendered, a rule about its layout has no
 * evidence — and reporting that as a failure would tell an operator a business's site is broken
 * when the truth is that we could not look at it. This project has made that mistake before, on a
 * real Priority 1 lead, and every part of it since is built to avoid repeating it.
 *
 * Pure: facts and rules in, verdicts out.
 */

/** Where a field's value comes from. Layout is absent unless the page actually rendered. */
export type FieldSource = "structure" | "layout";
export type FieldKind = "boolean" | "number" | "text" | "list";

export interface CheckableField {
  /** The stored key. Never shown to anyone. */
  id: string;
  source: FieldSource;
  kind: FieldKind;
  /** What the editor shows instead of the key. */
  label: string;
  /** One line of help, because "small tap targets" means nothing on its own. */
  hint: string;
}

/**
 * Everything a checklist rule may ask about.
 *
 * Grows when the extractors learn something new. Deliberately a hand-written list rather than a
 * reflection over the structure type: half of what the extractors collect is uninteresting to a
 * checklist, and a menu of forty fields nobody wants is worse than a menu of eighteen they do.
 */
export const CHECKABLE_FIELDS: CheckableField[] = [
  // ---- header
  { id: "header.present", source: "structure", kind: "boolean", label: "Has a header", hint: "A masthead or nav bar at the top." },
  { id: "header.phone", source: "structure", kind: "text", label: "Phone number in the header", hint: "A tap-to-call link where a visitor looks first." },
  { id: "header.navLinks", source: "structure", kind: "number", label: "Links in the header", hint: "Too few is thin; forty is a maze." },
  { id: "header.hasLogo", source: "structure", kind: "boolean", label: "Logo in the header", hint: "An image or SVG in the masthead." },

  // ---- hero
  { id: "hero.h1", source: "structure", kind: "text", label: "Main heading (h1)", hint: "The page's single most important line." },
  { id: "hero.h1Count", source: "structure", kind: "number", label: "How many main headings", hint: "Should be exactly one. Zero or several both mean nothing is the main heading." },
  { id: "hero.subheading", source: "structure", kind: "text", label: "Sentence under the heading", hint: "Usually the line that says what they actually do." },

  // ---- proof
  { id: "reviews.present", source: "structure", kind: "boolean", label: "Shows reviews", hint: "Testimonials or review widgets on the page." },
  { id: "reviews.count", source: "structure", kind: "number", label: "How many reviews shown", hint: "Two is a gesture; ten is proof." },
  { id: "reviews.named", source: "structure", kind: "number", label: "Reviews with a name attached", hint: "Anonymous praise reads as invented." },
  { id: "reviews.ratingShown", source: "structure", kind: "text", label: "Star rating on the page", hint: "A visible score, from schema or plain text." },

  // ---- action
  { id: "ctas.count", source: "structure", kind: "number", label: "How many calls to action", hint: "Buttons asking for the next step." },
  { id: "ctas.inHeader", source: "structure", kind: "number", label: "Calls to action in the header", hint: "The one a visitor sees without scrolling." },
  { id: "forms.count", source: "structure", kind: "number", label: "How many forms", hint: "Enquiry, quote or booking forms." },
  { id: "forms.fields", source: "structure", kind: "number", label: "Fields to fill in", hint: "A twelve-field form is a reason nobody enquires." },
  { id: "forms.hasMessageBox", source: "structure", kind: "boolean", label: "Form has a message box", hint: "Somewhere to say what they want." },

  // ---- footer
  { id: "footer.present", source: "structure", kind: "boolean", label: "Has a footer", hint: "" },
  { id: "footer.hasAddress", source: "structure", kind: "boolean", label: "Address in the footer", hint: "A real address is a local-search signal and a trust signal." },
  { id: "footer.hasHours", source: "structure", kind: "boolean", label: "Opening hours in the footer", hint: "" },
  { id: "footer.social", source: "structure", kind: "list", label: "Social links in the footer", hint: "Which platforms they link to." },
  { id: "footer.copyrightYear", source: "structure", kind: "number", label: "Copyright year", hint: "An old year is the clearest sign of an abandoned site." },

  // ---- layout, which only a rendered page can answer
  { id: "layout.scrollsSideways", source: "layout", kind: "boolean", label: "Scrolls sideways", hint: "The page is wider than the screen. On a phone this is the most visible fault there is." },
  { id: "layout.phoneAboveFold", source: "layout", kind: "boolean", label: "Phone visible without scrolling", hint: "" },
  { id: "layout.ctaAboveFold", source: "layout", kind: "text", label: "Call to action without scrolling", hint: "And what it says." },
  { id: "layout.tinyTextCount", source: "layout", kind: "number", label: "Blocks of tiny text", hint: "Text under 12px, unreadable on a phone." },
  { id: "layout.smallTapTargets", source: "layout", kind: "number", label: "Buttons too small to tap", hint: "Under 32px. A finger is about 40." },
  { id: "layout.brokenImages", source: "layout", kind: "number", label: "Broken images", hint: "Pictures the browser tried to load and could not." },
];

export const TESTS = ["present", "absent", "is_true", "is_false", "at_least", "at_most", "equals"] as const;
export type ChecklistTest = (typeof TESTS)[number];

export const TEST_LABELS: Record<ChecklistTest, string> = {
  present: "is there",
  absent: "is missing",
  is_true: "is true",
  is_false: "is false",
  at_least: "is at least",
  at_most: "is at most",
  equals: "is exactly",
};

export interface ChecklistRule {
  id: string;
  name: string;
  /** Null means every page type. */
  pageType: PageType | null;
  /** Null means every industry — that is where the universal rules live. */
  industry: string | null;
  field: string;
  test: ChecklistTest;
  /** Only read by at_least, at_most and equals. */
  value: number | null;
  /** How much this one matters, for the score. */
  weight: number;
  enabled: boolean;
  /** What to say when it fails. The sentence an operator reads, and may repeat on a call. */
  says: string;
}

export type ChecklistOutcome = "passed" | "failed" | "unknown";

export interface ChecklistResult {
  rule: ChecklistRule;
  outcome: ChecklistOutcome;
  /** What was actually found, for the record. Null when nothing could be read. */
  found: string | null;
  /** Why the outcome is what it is — including, when unknown, why nothing could be read. */
  because: string;
}

export interface PageFactsForChecklist {
  pageType: PageType;
  /** The industry of the business's ICP. Null when no ICP matched it yet. */
  industry: string | null;
  structure: PageStructure | null;
  /** Null when the page did not render, or when the layout probe failed. */
  layout: Record<string, unknown> | null;
}

/** Whether a rule is meant for this page at all. */
export function ruleApplies(rule: ChecklistRule, facts: PageFactsForChecklist): boolean {
  if (!rule.enabled) return false;
  if (rule.pageType !== null && rule.pageType !== facts.pageType) return false;
  // A rule with no industry is universal; one with an industry only applies to that industry. A
  // business in no ICP yet is therefore judged on the universal rules alone, which is right
  // — nobody has said what kind of business it is.
  if (rule.industry !== null && rule.industry !== facts.industry) return false;
  return true;
}

export function runChecklist(rules: ChecklistRule[], facts: PageFactsForChecklist): ChecklistResult[] {
  return rules.filter((rule) => ruleApplies(rule, facts)).map((rule) => evaluate(rule, facts));
}

function evaluate(rule: ChecklistRule, facts: PageFactsForChecklist): ChecklistResult {
  const field = CHECKABLE_FIELDS.find((f) => f.id === rule.field);
  if (!field) {
    // Only reachable if a field is removed from the catalogue while rules still name it. Reported
    // rather than silently skipped, so the rule can be fixed instead of quietly doing nothing.
    return { rule, outcome: "unknown", found: null, because: `This rule asks about "${rule.field}", which no longer exists.` };
  }

  const bag = field.source === "layout" ? facts.layout : (facts.structure as unknown as Record<string, unknown> | null);
  if (bag === null) {
    return {
      rule,
      outcome: "unknown",
      found: null,
      because:
        field.source === "layout"
          ? "The page did not render, so nothing about its layout could be measured."
          : "The page could not be read, so nothing about its contents is known.",
    };
  }

  const value = readPath(bag, rule.field.replace(/^(structure|layout)\./, ""));
  const found = describe(value);

  switch (rule.test) {
    case "present":
      return verdict(rule, isPresent(value), found, "it is there", "it is missing");
    case "absent":
      return verdict(rule, !isPresent(value), found, "it is missing, as required", "it is there");
    case "is_true":
      return verdict(rule, value === true, found, "it is true", "it is not true");
    case "is_false":
      return verdict(rule, value === false, found, "it is false", "it is not false");
    case "at_least":
    case "at_most":
    case "equals": {
      const number = toNumber(value);
      if (number === null || rule.value === null) {
        return { rule, outcome: "unknown", found, because: "There is no number here to compare." };
      }
      const ok =
        rule.test === "at_least" ? number >= rule.value : rule.test === "at_most" ? number <= rule.value : number === rule.value;
      return verdict(rule, ok, found, `${number} ${TEST_LABELS[rule.test]} ${rule.value}`, `${number} is not ${TEST_LABELS[rule.test]} ${rule.value}`);
    }
  }
}

function verdict(rule: ChecklistRule, ok: boolean, found: string | null, passWhy: string, failWhy: string): ChecklistResult {
  return { rule, outcome: ok ? "passed" : "failed", found, because: ok ? passWhy : failWhy };
}

/**
 * Reads a dotted path, treating a few shapes as the numbers a rule expects.
 *
 * `ctas.count` and `ctas.inHeader` are not fields on the structure — the structure holds a list.
 * Exposing them as counts is what lets a rule say "at least one call to action in the header"
 * without the operator having to understand that CTAs are stored as an array of objects.
 */
function readPath(bag: Record<string, unknown>, path: string): unknown {
  if (path === "ctas.count") return Array.isArray(bag.ctas) ? bag.ctas.length : null;
  if (path === "ctas.inHeader") {
    return Array.isArray(bag.ctas) ? bag.ctas.filter((c) => (c as { region?: string }).region === "header").length : null;
  }

  let current: unknown = bag;
  for (const part of path.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? null;
}

/**
 * "Present" means there is something real here.
 *
 * Zero is present — a page with zero reviews has a review count, and a rule asking whether the
 * count is present is not asking whether it is above zero. `false` is present for the same reason.
 * An empty string and an empty list are not: they are how the extractors say "nothing found".
 */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.length;
  if (typeof value === "boolean") return value ? 1 : 0;
  return null;
}

function describe(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value).slice(0, 120);
}

/**
 * A starting set, so the editor is never an empty screen.
 *
 * Three kinds, and the split matters. The universal ones carry no industry and no page type: they
 * are true of any page on any business's site, and they stay true when the operator moves into a
 * different trade. The per-page ones are still trade-agnostic — a contact page needs a form
 * whatever the business does. Only the last group assumes printing and apparel, and that is the
 * group the operator is expected to rewrite first.
 *
 * Weights are deliberately unequal. A page that scrolls sideways on a phone is not the same size
 * of problem as a missing logo, and a checklist where everything weighs ten produces a score that
 * says nothing.
 */
export const EXAMPLE_CHECKLIST_RULES: Omit<ChecklistRule, "id" | "enabled">[] = [
  // ---- true of any page, on any site
  {
    name: "Exactly one main heading",
    pageType: null,
    industry: null,
    field: "hero.h1Count",
    test: "equals",
    value: 1,
    weight: 15,
    says: "This page does not have exactly one main heading, so nothing on it reads as the page's subject — to a visitor skimming, or to Google.",
  },
  {
    name: "Does not scroll sideways",
    pageType: null,
    industry: null,
    field: "layout.scrollsSideways",
    test: "is_false",
    value: null,
    weight: 30,
    says: "The page is wider than the screen, so it scrolls sideways. On a phone this is the most visible fault a site can have.",
  },
  {
    name: "No broken images",
    pageType: null,
    industry: null,
    field: "layout.brokenImages",
    test: "at_most",
    value: 0,
    weight: 20,
    says: "Some images do not load, and a visitor sees the gaps.",
  },
  {
    name: "Tap targets big enough for a finger",
    pageType: null,
    industry: null,
    field: "layout.smallTapTargets",
    test: "at_most",
    // Twenty-five, not five. Five was the first guess and it failed every one of the first seven
    // real pages measured — a rule that fires on everything is a rule, not a finding, and it is
    // exactly what the save-time preview exists to catch. Ordinary Shopify and Wix themes carry
    // twenty-odd small icon links in the header and footer as a matter of course, so the number
    // that separates a careless page from a normal one is well above that.
    //
    // Still worth tuning against a real list. The preview on the Checklists screen shows what any
    // threshold would flag before it is saved.
    value: 25,
    weight: 12,
    says: "A lot of the buttons and links are too small to tap reliably on a phone.",
  },

  // ---- true of a page of this type, whatever the trade
  {
    name: "Phone in the header",
    pageType: "home",
    industry: null,
    field: "header.phone",
    test: "present",
    value: null,
    weight: 25,
    says: "There is no tap-to-call number in the header, so a visitor who wants to ring has to go looking.",
  },
  {
    name: "Something to click above the fold",
    pageType: "home",
    industry: null,
    field: "layout.ctaAboveFold",
    test: "present",
    value: null,
    weight: 20,
    says: "Nothing on the first screen asks the visitor to do anything.",
  },
  {
    name: "Address in the footer",
    pageType: "home",
    industry: null,
    field: "footer.hasAddress",
    test: "is_true",
    value: null,
    weight: 15,
    says: "No address in the footer. It is both a trust signal and a local-search one.",
  },
  {
    name: "Contact page has a form",
    pageType: "contact",
    industry: null,
    field: "forms.count",
    test: "at_least",
    value: 1,
    weight: 25,
    says: "The contact page has no form, so getting in touch means writing an email from scratch.",
  },
  {
    name: "Enquiry form is short",
    pageType: "contact",
    industry: null,
    field: "forms.fields",
    test: "at_most",
    value: 5,
    weight: 15,
    says: "The enquiry form asks for too much. Every extra field costs enquiries.",
  },

  // ---- printing and apparel. Rewrite this group first for a different trade.
  {
    name: "Home page shows reviews",
    pageType: "home",
    industry: "Printing",
    field: "reviews.present",
    test: "is_true",
    value: null,
    weight: 22,
    says: "No reviews anywhere on the home page. In a trade where quality is the whole question, that is the first thing a buyer looks for.",
  },
  {
    name: "Reviews carry names",
    pageType: "home",
    industry: "Printing",
    field: "reviews.named",
    test: "at_least",
    value: 1,
    weight: 10,
    says: "The reviews shown are anonymous, which reads as invented whether or not it is.",
  },
  {
    name: "Product pages prove the work",
    pageType: "products",
    industry: "Printing",
    field: "reviews.present",
    test: "is_true",
    value: null,
    weight: 12,
    says: "Nothing on the product page vouches for the quality of the printing.",
  },
];
