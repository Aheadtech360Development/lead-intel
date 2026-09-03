import { describe, expect, it } from "vitest";
import { matchCategory, type CategoryEvidence, type CategoryRule } from "./match.js";

function rule(over: Partial<CategoryRule> = {}): CategoryRule {
  return {
    id: "r1",
    name: "DTF",
    category: "Printing",
    subcategory: "DTF transfers",
    priority: 10,
    enabled: true,
    sources: [],
    anyOf: ["dtf"],
    noneOf: [],
    websiteAnyOf: [],
    instagramAnyOf: [],
    requireAll: false,
    minFollowers: null,
    maxFollowers: null,
    ...over,
  };
}

const NOTHING: CategoryEvidence = {};

describe("matchCategory", () => {
  it("matches a term and says which one, and where", () => {
    const found = matchCategory([rule()], { instagramBio: "DTF transfers shipped next day" });
    expect(found?.category).toBe("Printing");
    expect(found?.subcategory).toBe("DTF transfers");
    expect(found?.matchedTerm).toBe("dtf");
    expect(found?.matchedIn).toBe("instagram_bio");
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(matchCategory([rule()], { instagramBio: "We cut vinyl signs" })).toBeNull();
    expect(matchCategory([rule()], NOTHING)).toBeNull();
  });

  it("ignores disabled rules", () => {
    expect(matchCategory([rule({ enabled: false })], { instagramBio: "dtf" })).toBeNull();
  });

  /** The order is the operator's, and it is the whole way two overlapping rules are resolved. */
  it("takes the first rule in priority order, not the first in the list", () => {
    const specific = rule({ id: "specific", priority: 5, subcategory: "DTF transfers", anyOf: ["dtf"] });
    const general = rule({ id: "general", priority: 1, subcategory: "Apparel", anyOf: ["shirt"] });
    const found = matchCategory([specific, general], { businessName: "DTF Shirt Co" });
    expect(found?.rule.id).toBe("general");
  });

  describe("word boundaries", () => {
    it("matches a short term inside a domain, where punctuation is the boundary", () => {
      // Verbatim from the operator's data — these are real businesses in the list.
      for (const domain of ["dtfdallas.com", "dtf-dallas.com", "bestpricedtf.com"]) {
        const found = matchCategory([rule()], { websiteDomain: domain });
        expect(found?.matchedTerm, domain).toBe("dtf");
      }
    });

    it("does not match a term buried inside an unrelated word", () => {
      expect(matchCategory([rule()], { websiteText: "we widtfoo everything" })).toBeNull();
    });

    it("matches a multi-word phrase as written", () => {
      const found = matchCategory([rule({ anyOf: ["direct to film"] })], {
        websiteText: "Our direct to film transfers are ready in 24 hours.",
      });
      expect(found?.matchedTerm).toBe("direct to film");
    });
  });

  describe("exclusions", () => {
    it("blocks a rule when an excluded term appears anywhere it looks", () => {
      const r = rule({ anyOf: ["screen print"], noneOf: ["equipment"] });
      const found = matchCategory([r], {
        instagramBio: "screen printing supplies",
        websiteText: "We sell screen printing equipment and presses.",
      });
      expect(found).toBeNull();
    });

    it("still matches when the excluded term is absent", () => {
      const r = rule({ anyOf: ["screen print"], noneOf: ["equipment"] });
      expect(matchCategory([r], { instagramBio: "custom screen printing since 1998" })?.category).toBe("Printing");
    });
  });

  describe("follower gates", () => {
    /**
     * The rule that matters most here. "At least 5,000 followers" must not fire on a business
     * whose Instagram has never been looked up — the answer is unknown, and treating unknown as
     * passing would put businesses in a category on the strength of a number nobody has.
     */
    it("does not fire when the follower count is unknown", () => {
      const r = rule({ minFollowers: 5000, anyOf: ["dtf"] });
      expect(matchCategory([r], { instagramBio: "dtf transfers" })).toBeNull();
      expect(matchCategory([r], { instagramBio: "dtf transfers", instagramFollowers: null })).toBeNull();
    });

    it("applies the floor and the ceiling", () => {
      const r = rule({ minFollowers: 1000, maxFollowers: 50000, anyOf: ["dtf"] });
      expect(matchCategory([r], { instagramBio: "dtf", instagramFollowers: 12000 })?.category).toBe("Printing");
      expect(matchCategory([r], { instagramBio: "dtf", instagramFollowers: 400 })).toBeNull();
      expect(matchCategory([r], { instagramBio: "dtf", instagramFollowers: 90000 })).toBeNull();
    });

    it("allows a rule that is only a follower gate", () => {
      const r = rule({ anyOf: [], minFollowers: 10000, category: "Fashion", subcategory: "Large following" });
      expect(matchCategory([r], { instagramFollowers: 40000 })?.subcategory).toBe("Large following");
    });

    /** A rule with no terms and no gate matches everything, which is never what anyone meant. */
    it("ignores a rule with no conditions at all", () => {
      expect(matchCategory([rule({ anyOf: [], noneOf: [] })], { instagramBio: "anything" })).toBeNull();
    });
  });

  describe("sources", () => {
    it("looks only where the rule says to", () => {
      const r = rule({ sources: ["instagram_bio"] });
      expect(matchCategory([r], { instagramBio: "dtf transfers" })?.matchedIn).toBe("instagram_bio");
      expect(matchCategory([r], { websiteText: "dtf transfers" })).toBeNull();
    });

    it("looks everywhere when the rule names no sources", () => {
      expect(matchCategory([rule()], { metaAdsText: "Order your DTF gang sheets today" })?.matchedIn).toBe(
        "meta_ads_text",
      );
    });
  });

  /**
   * The groups exist to relate one source to another. Everything here is about the difference
   * between "these words appear somewhere" and "this is true of their site AND that is true of
   * their Instagram" — which is the whole reason a single word list was not enough.
   */
  describe("website and Instagram groups", () => {
    const both = rule({
      anyOf: [],
      websiteAnyOf: ["embroidery"],
      instagramAnyOf: ["clothing brand"],
      requireAll: true,
    });

    it("fires only when both sides are true", () => {
      const found = matchCategory([both], {
        websiteText: "custom embroidery since 1998",
        instagramCategory: "Clothing brand",
      });
      expect(found?.category).toBe("Printing");
      expect(found?.hits.map((h) => h.group)).toEqual(["website", "instagram"]);
    });

    it("declines when only the website side is true", () => {
      expect(
        matchCategory([both], { websiteText: "custom embroidery since 1998", instagramCategory: "Local business" }),
      ).toBeNull();
    });

    it("declines when only the Instagram side is true", () => {
      expect(matchCategory([both], { websiteText: "we cut vinyl signs", instagramCategory: "Clothing brand" })).toBeNull();
    });

    /**
     * The third state, again. A require-all rule about an Instagram account nobody has bought must
     * stay silent — not fire because the website half was enough, and not be recorded as a business
     * that failed the Instagram test. Nobody has looked.
     */
    it("stays silent when the Instagram side was never fetched", () => {
      expect(matchCategory([both], { websiteText: "custom embroidery since 1998" })).toBeNull();
    });

    it("a website group never reads the Instagram bio, and the reverse", () => {
      const websiteOnly = rule({ anyOf: [], websiteAnyOf: ["dtf"] });
      expect(matchCategory([websiteOnly], { instagramBio: "dtf transfers" })).toBeNull();
      expect(matchCategory([websiteOnly], { websiteDomain: "dtfdallas.com" })?.matchedIn).toBe("website_domain");

      const instagramOnly = rule({ anyOf: [], instagramAnyOf: ["dtf"] });
      expect(matchCategory([instagramOnly], { websiteText: "dtf transfers" })).toBeNull();
      expect(matchCategory([instagramOnly], { instagramHandle: "dtf_dallas" })?.matchedIn).toBe("instagram_handle");
    });

    it("without requireAll, either side firing is enough", () => {
      const either = rule({ anyOf: [], websiteAnyOf: ["embroidery"], instagramAnyOf: ["clothing brand"] });
      expect(matchCategory([either], { websiteText: "embroidery" })?.hits).toHaveLength(1);
      expect(matchCategory([either], { instagramCategory: "Clothing brand" })?.hits).toHaveLength(1);
    });

    it("excludes on the pinned sides too, not only the sources list", () => {
      const r = rule({ anyOf: [], websiteAnyOf: ["embroidery"], noneOf: ["equipment"] });
      expect(matchCategory([r], { websiteText: "embroidery equipment for sale" })).toBeNull();
    });

    it("counts a follower gate as its own hit so the record says the range applied", () => {
      const r = rule({ minFollowers: 1000 });
      const found = matchCategory([r], { instagramBio: "dtf transfers", instagramFollowers: 4200 });
      expect(found?.hits.map((h) => h.group)).toEqual(["anywhere", "followers"]);
    });
  });
});
