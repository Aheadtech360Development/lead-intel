import { CATEGORY_SOURCES, type CategoryRule } from "./match.js";

/**
 * Turning a sentence the operator typed into a draft rule.
 *
 * The prompt and the parsing live here, away from the network call, for the reason everything in
 * this package is here: they can be tested. A model's answer is unpredictable, so the code that
 * receives it is exactly the code that must not be.
 *
 * **This produces a draft and nothing else.** It is rendered into the form for the operator to
 * edit, and the preview then shows what it would actually catch before anything is saved. The
 * operator's own worry — *"agar ghalti se koi lafz daal diya to rule bekaar ho jayega"* — is
 * answered by those two steps, not by trusting the model.
 */

export interface SuggestedRule {
  name: string;
  category: string;
  subcategory: string | null;
  anyOf: string[];
  websiteAnyOf: string[];
  instagramAnyOf: string[];
  noneOf: string[];
  requireAll: boolean;
  minFollowers: number | null;
  maxFollowers: number | null;
  /**
   * Why each term was chosen, one line each.
   *
   * Required rather than nice-to-have. A word list somebody else wrote is unmaintainable: three
   * weeks later "gang sheet" is in the rule and nobody knows whether it belongs. Keyed by the term
   * so the UI can show the reason beside the word it explains.
   */
  reasons: Record<string, string>;
  /** The model's own account of what it understood, so a misreading is visible immediately. */
  understood: string;
}

export const SUGGEST_RULE_SYSTEM = `You help a lead-generation operator turn a description into a keyword rule.

The rule sorts small businesses into the operator's own category. It matches by looking for literal
words in text the system already holds. It cannot reason, follow links, or infer — it only finds
words. Your job is to choose the words.

Three separate places to look:
- "websiteAnyOf": words to look for on the business's own website (page text and web address).
- "instagramAnyOf": words to look for on their Instagram (bio, username, the category Instagram
  publishes for the account).
- "anyOf": words to look for anywhere at all, including the business name.

Put a term in the narrowest box that fits. A term about what they sell usually belongs on the
website. A term describing what kind of account they are usually belongs on Instagram.

"requireAll": set true only when the description genuinely requires two different things to be true
at once (for example "sells printing on their site AND presents as a clothing brand on Instagram").
It needs at least two boxes filled to mean anything. Default false.

"noneOf": words that should rule a business out. Suppliers, equipment sellers, repair services and
wholesalers commonly use the same vocabulary as the businesses the operator wants, so exclusions
matter as much as inclusions.

Rules for choosing terms:
- Prefer specific multi-word phrases over single common words. "gang sheet" is useful; "shop" and
  "custom" and "quality" match almost every business and make the rule worthless.
- Include obvious spelling variants as separate terms ("t-shirt", "tshirt", "tee shirt";
  "direct to film", "direct-to-film").
- A single word matches when it sits at the start or end of a word, so "dtf" finds "dtfdallas" and
  "bestpricedtf". Short words are therefore risky: "tee" also finds "teeth".
- 3 to 8 terms per box is usually right. More than that and the rule stops being specific.
- Never invent a follower range unless the description mentions follower counts or audience size.

Reply with JSON only, matching exactly this shape:
{
  "name": "short name for the operator, 2-5 words",
  "category": "the broad bucket, one or two words",
  "subcategory": "the narrower label, or null",
  "anyOf": [], "websiteAnyOf": [], "instagramAnyOf": [], "noneOf": [],
  "requireAll": false,
  "minFollowers": null, "maxFollowers": null,
  "reasons": { "term": "one short line saying why this term was chosen" },
  "understood": "one sentence restating what you understood the operator to want"
}

Every term you put in any box must appear as a key in "reasons".`;

/** The operator's description, plus what already exists so the model does not duplicate it. */
export function buildSuggestRulePrompt(params: {
  description: string;
  existingRules: Array<{ name: string; category: string; subcategory: string | null }>;
  /** A few real examples of what this operator's businesses actually say. */
  sampleSiteText?: string[];
}): string {
  const lines: string[] = [`What the operator wants:\n${params.description.trim()}`];

  if (params.existingRules.length > 0) {
    lines.push(
      `\nCategories they already have (do not duplicate these; pick a distinct one unless the description clearly means an existing one):\n` +
        params.existingRules
          .map((r) => `- ${r.name}: ${r.category}${r.subcategory ? ` > ${r.subcategory}` : ""}`)
          .join("\n"),
    );
  }

  // Real wording from their own list, so the terms are drawn from how these businesses actually
  // write rather than from how the trade is described in general. Without this the model proposes
  // textbook vocabulary that nobody's website uses.
  if (params.sampleSiteText && params.sampleSiteText.length > 0) {
    lines.push(
      `\nHere is how some real businesses in their list describe themselves. Prefer wording that appears in text like this:\n` +
        params.sampleSiteText.map((t) => `- ${t.slice(0, 300)}`).join("\n"),
    );
  }

  return lines.join("\n");
}

/**
 * Reads the model's answer into a draft, discarding anything malformed.
 *
 * Every field is checked rather than trusted. The failure this guards against is not a model that
 * refuses — that is visible — but one that returns a number where a list belongs, or a term that is
 * an empty string, and produces a rule that looks fine and matches nothing.
 */
export function parseSuggestedRule(value: unknown): { ok: true; rule: SuggestedRule } | { ok: false; detail: string } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, detail: "The model did not return an object." };
  }
  const raw = value as Record<string, unknown>;

  const anyOf = stringList(raw.anyOf);
  const websiteAnyOf = stringList(raw.websiteAnyOf);
  const instagramAnyOf = stringList(raw.instagramAnyOf);
  const noneOf = stringList(raw.noneOf);
  const minFollowers = positiveInt(raw.minFollowers);
  const maxFollowers = positiveInt(raw.maxFollowers);

  const filled = [anyOf, websiteAnyOf, instagramAnyOf].filter((g) => g.length > 0).length;
  if (filled === 0 && minFollowers === null && maxFollowers === null) {
    return { ok: false, detail: "The model produced a rule with no words in it, which would never match anything." };
  }

  const category = text(raw.category);
  if (!category) {
    return { ok: false, detail: "The model did not name a category." };
  }

  // A conjunction of one is not a conjunction. The model is told this, and it still occasionally
  // sets the flag on a single-box rule; silently keeping it would show the operator a "must match
  // every box" badge on a rule that behaves like an ordinary one.
  const requireAll = raw.requireAll === true && filled >= 2;

  return {
    ok: true,
    rule: {
      name: text(raw.name) || `${category} rule`,
      category,
      subcategory: text(raw.subcategory) || null,
      anyOf,
      websiteAnyOf,
      instagramAnyOf,
      noneOf,
      requireAll,
      minFollowers,
      maxFollowers,
      reasons: reasonMap(raw.reasons),
      understood: text(raw.understood) || "",
    },
  };
}

/**
 * Terms a careful operator would want flagged.
 *
 * Advisory, computed here rather than asked of the model — a model asked to criticise its own
 * output tends to agree with itself. These are the two mechanical properties that make a term
 * useless, and both are checkable without any judgement: too short to be distinctive, or a word so
 * generic that every business in any trade uses it.
 */
const TOO_GENERIC = new Set([
  "custom", "quality", "best", "shop", "store", "service", "services", "business", "professional",
  "affordable", "local", "online", "order", "orders", "products", "design", "designs", "print",
  "printing", "company", "brand", "new", "we", "us", "your",
]);

export function riskyTerms(rule: Pick<SuggestedRule, "anyOf" | "websiteAnyOf" | "instagramAnyOf">): Array<{
  term: string;
  why: string;
}> {
  const all = [...rule.anyOf, ...rule.websiteAnyOf, ...rule.instagramAnyOf];
  const flagged: Array<{ term: string; why: string }> = [];
  for (const term of all) {
    const t = term.trim().toLowerCase();
    if (TOO_GENERIC.has(t)) {
      flagged.push({ term, why: "almost every business uses this word — it will match far too many" });
    } else if (/^[a-z0-9]{1,3}$/.test(t)) {
      flagged.push({ term, why: "very short, so it will also match inside longer unrelated words" });
    }
  }
  return flagged;
}

/** The draft as the rule form and the preview both expect it. */
export function suggestedRuleToDraft(suggested: SuggestedRule, priority: number): CategoryRule {
  return {
    id: "draft",
    name: suggested.name,
    category: suggested.category,
    subcategory: suggested.subcategory,
    priority,
    enabled: true,
    sources: [],
    anyOf: suggested.anyOf,
    noneOf: suggested.noneOf,
    websiteAnyOf: suggested.websiteAnyOf,
    instagramAnyOf: suggested.instagramAnyOf,
    requireAll: suggested.requireAll,
    minFollowers: suggested.minFollowers,
    maxFollowers: suggested.maxFollowers,
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    // Deduplicated case-insensitively: "DTF" and "dtf" are one term to the matcher, and showing
    // both would suggest the rule does more than it does.
    const key = trimmed.toLowerCase();
    if (trimmed.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function positiveInt(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function reasonMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim().length > 0) out[k] = v.trim();
  }
  return out;
}

/** Kept for callers that want to show which sources a suggestion could have narrowed to. */
export const SUGGESTABLE_SOURCES = CATEGORY_SOURCES;
