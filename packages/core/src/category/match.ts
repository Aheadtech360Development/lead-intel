/**
 * Sorting a business into a category the operator defined.
 *
 * Instagram publishes one category per account and no second level, so "t-shirts, within fashion"
 * cannot be fetched from anywhere — it has to be decided. This decides it from rules the operator
 * writes, and records **which rule decided**, because a category nobody can trace is a category
 * nobody should act on.
 *
 * Pure: no database, no network. The caller gathers the text, this reads it.
 */

/** Everything a rule may look at. Each is optional — most businesses have some and not others. */
export interface CategoryEvidence {
  businessName?: string | null;
  websiteText?: string | null;
  websiteDomain?: string | null;
  instagramBio?: string | null;
  instagramCategory?: string | null;
  instagramHandle?: string | null;
  metaAdsText?: string | null;
  instagramFollowers?: number | null;
}

export const CATEGORY_SOURCES = [
  "business_name",
  "website_text",
  "website_domain",
  "instagram_bio",
  "instagram_category",
  "instagram_handle",
  "meta_ads_text",
] as const;
export type CategorySource = (typeof CATEGORY_SOURCES)[number];

/** What each source is called on screen, so the rule editor never shows a column name. */
export const CATEGORY_SOURCE_LABELS: Record<CategorySource, string> = {
  business_name: "Their business name",
  website_text: "Text on their website",
  website_domain: "Their web address",
  instagram_bio: "Their Instagram bio",
  instagram_category: "The category Instagram lists them under",
  instagram_handle: "Their Instagram username",
  meta_ads_text: "The wording of their ads",
};

/** The sources that belong to the business's own website. */
export const WEBSITE_SOURCES: CategorySource[] = ["website_text", "website_domain"];
/** The sources that belong to their Instagram account. */
export const INSTAGRAM_SOURCES: CategorySource[] = ["instagram_bio", "instagram_category", "instagram_handle"];

export interface CategoryRule {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  priority: number;
  enabled: boolean;
  /** Empty means "look everywhere", which is what someone writing their first rule means. */
  sources: string[];
  anyOf: string[];
  noneOf: string[];
  /** Words looked for on their website only, whatever `sources` says. */
  websiteAnyOf: string[];
  /** Words looked for on their Instagram only, whatever `sources` says. */
  instagramAnyOf: string[];
  /**
   * How the filled-in groups combine.
   *
   * false — any one of them firing is enough. This is what a rule with a single list has always
   * meant, so every rule written before the groups existed keeps its behaviour.
   *
   * true — all of them must fire. This is the only way to express "sells embroidery on their site
   * **and** calls itself a clothing brand on Instagram", which is a different business from one
   * that merely mentions either word somewhere.
   */
  requireAll: boolean;
  minFollowers: number | null;
  maxFollowers: number | null;
}

/** Which group a hit came from, so the record can say *why* rather than only *what*. */
export type CategoryGroup = "anywhere" | "website" | "instagram" | "followers";

export interface CategoryHit {
  term: string;
  source: CategorySource;
  group: CategoryGroup;
}

export interface CategoryMatch {
  rule: CategoryRule;
  category: string;
  subcategory: string | null;
  /** The term that matched and where it was found — shown next to the category on the record. */
  matchedTerm: string;
  matchedIn: CategorySource;
  /**
   * Every group that fired, not only the first.
   *
   * A rule that required both a website word and an Instagram word is a claim about two things;
   * showing one of them next to the category would make a conjunction look like a coincidence.
   */
  hits: CategoryHit[];
}

function textFor(source: CategorySource, evidence: CategoryEvidence): string | null {
  switch (source) {
    case "business_name":
      return evidence.businessName ?? null;
    case "website_text":
      return evidence.websiteText ?? null;
    case "website_domain":
      return evidence.websiteDomain ?? null;
    case "instagram_bio":
      return evidence.instagramBio ?? null;
    case "instagram_category":
      return evidence.instagramCategory ?? null;
    case "instagram_handle":
      return evidence.instagramHandle ?? null;
    case "meta_ads_text":
      return evidence.metaAdsText ?? null;
  }
}

/**
 * A term matches when it sits at the **start or the end of a word**, not only when it is the
 * whole word.
 *
 * This is looser than whole-word matching on purpose, and the operator's own data is why. Three
 * real domains in their list are `dtfdallas.com`, `bestpricedtf.com` and `dtf-dallas.com`. All
 * three are DTF businesses. Whole-word matching finds only the third, because the other two run
 * the term straight into another word — which is exactly how business names are built.
 *
 * Matching a bare substring instead would go too far the other way: "dtf" would fire on any
 * accidental run of those three letters. Requiring a boundary on **one** side keeps
 * `bestpricedtf` and rejects `widtfoo`.
 *
 * The cost of the looseness is real and worth stating: a short term can still catch a longer word
 * that starts with it — "tee" matches "teeth". That is what the rule's exclusion list is for, and
 * why every match records the term and the text it was found in, so a wrong one is visible on the
 * record rather than hidden inside a category.
 *
 * A term containing a space or punctuation ("direct to film") is matched as a plain substring,
 * because a phrase already carries its own boundaries.
 */
function contains(haystack: string, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return false;
  const hay = haystack.toLowerCase();

  if (!/^[a-z0-9]+$/i.test(needle)) return hay.includes(needle);

  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Either the character before is not alphanumeric, or the character after is not.
  return new RegExp(`(?:(?:^|[^a-z0-9])${escaped})|(?:${escaped}(?:[^a-z0-9]|$))`, "i").test(hay);
}

/**
 * The first enabled rule that matches, in priority order.
 *
 * First-match-wins rather than best-match or all-matches, because the operator controls the order
 * and can see it. A scoring scheme would decide between two rules by arithmetic nobody asked for;
 * an ordered list decides by a number they set.
 */
export function matchCategory(rules: CategoryRule[], evidence: CategoryEvidence): CategoryMatch | null {
  const ordered = rules
    .filter((rule) => rule.enabled)
    .slice()
    .sort((a, b) => a.priority - b.priority);

  for (const rule of ordered) {
    // A follower gate that cannot be evaluated does not pass. A rule saying "at least 5,000
    // followers" must not fire on a business whose Instagram was never looked up — that would be
    // a claim about a number nobody has.
    if (rule.minFollowers !== null || rule.maxFollowers !== null) {
      const followers = evidence.instagramFollowers;
      if (followers === null || followers === undefined) continue;
      if (rule.minFollowers !== null && followers < rule.minFollowers) continue;
      if (rule.maxFollowers !== null && followers > rule.maxFollowers) continue;
    }

    const sources = (
      rule.sources.length > 0 ? rule.sources.filter(isCategorySource) : [...CATEGORY_SOURCES]
    ) as CategorySource[];

    // Exclusions are checked across every source this rule could read — the ones `sources` allows
    // plus both pinned sides — not only the source that matched. "screen printing" excluding
    // "equipment" should not fire for a business whose Instagram bio says screen printing and
    // whose website sells the machines.
    const everywhereThisRuleReads = new Set<CategorySource>([
      ...sources,
      ...(rule.websiteAnyOf.length > 0 ? WEBSITE_SOURCES : []),
      ...(rule.instagramAnyOf.length > 0 ? INSTAGRAM_SOURCES : []),
    ]);
    const excluded = rule.noneOf.some((term) =>
      [...everywhereThisRuleReads].some((source) => {
        const text = textFor(source, evidence);
        return text !== null && contains(text, term);
      }),
    );
    if (excluded) continue;

    // Each filled-in group, asked separately. An empty group is not a failed group — it is a
    // question this rule does not ask — so it is left out rather than counted either way.
    const groups: Array<{ group: CategoryGroup; terms: string[]; sources: CategorySource[] }> = [];
    if (rule.anyOf.length > 0) groups.push({ group: "anywhere", terms: rule.anyOf, sources });
    if (rule.websiteAnyOf.length > 0)
      groups.push({ group: "website", terms: rule.websiteAnyOf, sources: WEBSITE_SOURCES });
    if (rule.instagramAnyOf.length > 0)
      groups.push({ group: "instagram", terms: rule.instagramAnyOf, sources: INSTAGRAM_SOURCES });

    const gated = rule.minFollowers !== null || rule.maxFollowers !== null;

    // A rule with no words at all is only meaningful when a follower gate carries it — "anyone
    // over 10,000 followers". Without one it would match every business alive.
    if (groups.length === 0) {
      if (!gated) continue;
      return {
        rule,
        category: rule.category,
        subcategory: rule.subcategory,
        matchedTerm: "follower count",
        matchedIn: "instagram_bio",
        hits: [{ term: "follower count", source: "instagram_bio", group: "followers" }],
      };
    }

    const hits: CategoryHit[] = [];
    for (const g of groups) {
      const hit = firstHit(g.terms, g.sources, evidence, g.group);
      if (hit) hits.push(hit);
      // Fail fast: under requireAll a group that did not fire ends the rule. Note this is also
      // what happens when the source was never fetched — an Instagram group cannot match an
      // account nobody has looked up, and staying silent is the honest outcome. Treating unread
      // as "does not match our words" would be a claim about text we have never seen.
      else if (rule.requireAll) break;
    }

    const satisfied = rule.requireAll ? hits.length === groups.length : hits.length > 0;
    if (!satisfied) continue;

    const first = hits[0]!;
    if (gated) hits.push({ term: "follower count", source: "instagram_bio", group: "followers" });
    return {
      rule,
      category: rule.category,
      subcategory: rule.subcategory,
      matchedTerm: first.term,
      matchedIn: first.source,
      hits,
    };
  }

  return null;
}

/** The first of these terms found in any of these sources, or null if none of them are there. */
function firstHit(
  terms: string[],
  sources: CategorySource[],
  evidence: CategoryEvidence,
  group: CategoryGroup,
): CategoryHit | null {
  for (const source of sources) {
    const text = textFor(source, evidence);
    if (text === null || text.trim().length === 0) continue;
    const term = terms.find((t) => contains(text, t));
    if (term !== undefined) return { term, source, group };
  }
  return null;
}

export function isCategorySource(value: string): value is CategorySource {
  return (CATEGORY_SOURCES as readonly string[]).includes(value);
}

/**
 * A starter set, so the editor is never an empty screen with a blank form on it.
 *
 * Written for the niche the operator is actually working — screen printing, DTF transfers and
 * embroidery — because a generic example teaches nothing about how the fields interact. They are
 * suggestions the operator edits, not defaults the system relies on.
 */
export const EXAMPLE_CATEGORY_RULES: Omit<CategoryRule, "id" | "enabled">[] = [
  {
    name: "DTF transfers",
    category: "Printing",
    subcategory: "DTF transfers",
    priority: 10,
    sources: [],
    anyOf: ["dtf", "direct to film", "dtf transfer"],
    noneOf: ["dtf printer repair"],
    websiteAnyOf: [],
    instagramAnyOf: [],
    requireAll: false,
    minFollowers: null,
    maxFollowers: null,
  },
  {
    name: "Screen printing",
    category: "Printing",
    subcategory: "Screen printing",
    priority: 20,
    sources: [],
    anyOf: ["screen print", "screenprint", "silkscreen", "silk screen"],
    noneOf: ["equipment", "supplies only"],
    websiteAnyOf: [],
    instagramAnyOf: [],
    requireAll: false,
    minFollowers: null,
    maxFollowers: null,
  },
  {
    name: "Embroidery",
    category: "Printing",
    subcategory: "Embroidery",
    priority: 30,
    sources: [],
    anyOf: ["embroider", "embroidery", "monogram"],
    noneOf: [],
    websiteAnyOf: [],
    instagramAnyOf: [],
    requireAll: false,
    minFollowers: null,
    maxFollowers: null,
  },
  {
    name: "Apparel brand",
    category: "Fashion",
    subcategory: "Apparel brand",
    priority: 40,
    sources: [],
    anyOf: ["apparel", "clothing", "streetwear", "t-shirt", "tshirt", "tees"],
    noneOf: [],
    websiteAnyOf: [],
    instagramAnyOf: [],
    requireAll: false,
    minFollowers: null,
    maxFollowers: null,
  },
  /**
   * The example that exists to show the shape rather than to be kept.
   *
   * It is the one thing a single word list cannot say: the website has to sell printing, *and*
   * Instagram has to file them as a clothing or apparel brand. A shop matching only one of those
   * is a different business, and this rule declines it. It sits last on purpose — it is the most
   * specific and the least likely to be right for someone else's list.
   */
  {
    name: "Prints their own brand (website + Instagram)",
    category: "Fashion",
    subcategory: "Own-label apparel",
    priority: 50,
    sources: [],
    anyOf: [],
    noneOf: [],
    websiteAnyOf: ["shop", "collection", "our brand", "lookbook"],
    instagramAnyOf: ["clothing", "apparel", "brand", "fashion"],
    requireAll: true,
    minFollowers: null,
    maxFollowers: null,
  },
];
