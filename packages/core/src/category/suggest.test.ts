import { describe, expect, it } from "vitest";
import { matchCategory } from "./match.js";
import { buildSuggestRulePrompt, parseSuggestedRule, riskyTerms, suggestedRuleToDraft } from "./suggest.js";

/**
 * The model is unpredictable, so this — the code that receives its answer — must not be.
 *
 * Every test here is a shape the model has some chance of producing. The ones that matter most are
 * the near-misses: an answer that parses as JSON and is still nonsense is the failure that reaches
 * the operator looking like a working rule.
 */

const GOOD = {
  name: "Own-label apparel",
  category: "Fashion",
  subcategory: "Apparel brand",
  anyOf: [],
  websiteAnyOf: ["gang sheet", "we print"],
  instagramAnyOf: ["clothing brand"],
  noneOf: ["wholesale"],
  requireAll: true,
  minFollowers: null,
  maxFollowers: null,
  reasons: { "gang sheet": "trade term for bulk transfer sheets", "clothing brand": "Instagram's own label" },
  understood: "Brands that print their own clothing.",
};

describe("parseSuggestedRule", () => {
  it("reads a well-formed answer", () => {
    const parsed = parseSuggestedRule(GOOD);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rule.websiteAnyOf).toEqual(["gang sheet", "we print"]);
    expect(parsed.rule.requireAll).toBe(true);
    expect(parsed.rule.subcategory).toBe("Apparel brand");
  });

  it("refuses a rule with no words and no follower range", () => {
    const parsed = parseSuggestedRule({ ...GOOD, websiteAnyOf: [], instagramAnyOf: [], anyOf: [] });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain("never match");
  });

  it("refuses an answer with no category", () => {
    expect(parseSuggestedRule({ ...GOOD, category: "" }).ok).toBe(false);
    expect(parseSuggestedRule({ ...GOOD, category: 7 }).ok).toBe(false);
  });

  it("refuses anything that is not an object", () => {
    expect(parseSuggestedRule(null).ok).toBe(false);
    expect(parseSuggestedRule("a rule").ok).toBe(false);
    expect(parseSuggestedRule([1, 2]).ok).toBe(false);
  });

  /**
   * requireAll with one box behaves exactly like requireAll off, but the UI badges it as stricter.
   * Dropping the flag is the honest reading of an answer that cannot mean what it says.
   */
  it("drops requireAll when only one box is filled", () => {
    const parsed = parseSuggestedRule({ ...GOOD, instagramAnyOf: [], requireAll: true });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rule.requireAll).toBe(false);
  });

  it("throws away non-strings, blanks and duplicates inside a list", () => {
    const parsed = parseSuggestedRule({ ...GOOD, websiteAnyOf: ["dtf", "", "  ", 42, "DTF", null, "gang sheet"] });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rule.websiteAnyOf).toEqual(["dtf", "gang sheet"]);
  });

  it("survives a missing or malformed reasons map rather than failing the whole answer", () => {
    const parsed = parseSuggestedRule({ ...GOOD, reasons: "because" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rule.reasons).toEqual({});
  });

  it("treats a zero or negative follower gate as no gate", () => {
    const parsed = parseSuggestedRule({ ...GOOD, minFollowers: 0, maxFollowers: -5 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rule.minFollowers).toBeNull();
    expect(parsed.rule.maxFollowers).toBeNull();
  });

  it("accepts a follower-only rule, which is a real thing to want", () => {
    const parsed = parseSuggestedRule({
      ...GOOD,
      anyOf: [],
      websiteAnyOf: [],
      instagramAnyOf: [],
      minFollowers: 25000,
    });
    expect(parsed.ok).toBe(true);
  });
});

/** A draft is only useful if the real matcher accepts it. This is the join between the two. */
describe("suggestedRuleToDraft", () => {
  it("produces something matchCategory can run unchanged", () => {
    const parsed = parseSuggestedRule(GOOD);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const draft = suggestedRuleToDraft(parsed.rule, 10);
    expect(draft.priority).toBe(10);

    const hit = matchCategory([draft], {
      websiteText: "we print gang sheet transfers daily",
      instagramCategory: "Clothing brand",
    });
    expect(hit?.category).toBe("Fashion");

    // requireAll survives the round trip: the website half alone must not be enough.
    expect(matchCategory([draft], { websiteText: "we print gang sheet transfers daily" })).toBeNull();
  });
});

describe("riskyTerms", () => {
  it("flags words every business uses", () => {
    const flagged = riskyTerms({ anyOf: ["custom", "shop"], websiteAnyOf: [], instagramAnyOf: [] });
    expect(flagged.map((f) => f.term)).toEqual(["custom", "shop"]);
  });

  it("flags very short terms, which match inside longer words", () => {
    const flagged = riskyTerms({ anyOf: [], websiteAnyOf: ["tee"], instagramAnyOf: [] });
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.why).toContain("longer unrelated words");
  });

  it("leaves specific phrases alone", () => {
    expect(riskyTerms({ anyOf: [], websiteAnyOf: ["gang sheet", "direct to film"], instagramAnyOf: [] })).toEqual([]);
  });
});

describe("buildSuggestRulePrompt", () => {
  it("carries the description and the existing categories", () => {
    const prompt = buildSuggestRulePrompt({
      description: "brands that print their own clothes",
      existingRules: [{ name: "DTF transfers", category: "Printing", subcategory: "DTF transfers" }],
    });
    expect(prompt).toContain("print their own clothes");
    expect(prompt).toContain("DTF transfers");
    expect(prompt).toContain("do not duplicate");
  });

  it("includes real wording from the operator's own list when given it", () => {
    const prompt = buildSuggestRulePrompt({
      description: "anything",
      existingRules: [],
      sampleSiteText: ["We do DTF gang sheets and screen printing in Dallas"],
    });
    expect(prompt).toContain("gang sheets");
  });

  it("omits the sample section entirely when there is none, rather than heading an empty list", () => {
    const prompt = buildSuggestRulePrompt({ description: "anything", existingRules: [], sampleSiteText: [] });
    expect(prompt).not.toContain("describe themselves");
  });
});
