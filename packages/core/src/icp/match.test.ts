import { describe, expect, it } from "vitest";
import { matchIcp, type IcpEvidence, type Icp } from "./match.js";

function rule(over: Partial<Icp> = {}): Icp {
  return {
    id: "r1",
    name: "DTF transfers",
    industry: "Printing",
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
    searchTerms: [],
    requiresWebsite: false,
    minReviews: null,
    places: [],
    ...over,
  };
}

const NOTHING: IcpEvidence = {};

describe("matchIcp", () => {
  it("matches a term and says which one, and where", () => {
    const found = matchIcp([rule()], { instagramBio: "DTF transfers shipped next day" });
    expect(found?.industry).toBe("Printing");
    expect(found?.name).toBe("DTF transfers");
    expect(found?.matchedTerm).toBe("dtf");
    expect(found?.matchedIn).toBe("instagram_bio");
  });

  it("returns null rather than guessing when nothing matches", () => {
    expect(matchIcp([rule()], { instagramBio: "We cut vinyl signs" })).toBeNull();
    expect(matchIcp([rule()], NOTHING)).toBeNull();
  });

  it("ignores disabled rules", () => {
    expect(matchIcp([rule({ enabled: false })], { instagramBio: "dtf" })).toBeNull();
  });

  /** The order is the operator's, and it is the whole way two overlapping rules are resolved. */
  it("takes the first rule in priority order, not the first in the list", () => {
    const specific = rule({ id: "specific", priority: 5, name: "DTF transfers", anyOf: ["dtf"] });
    const general = rule({ id: "general", priority: 1, name: "Apparel", anyOf: ["shirt"] });
    const found = matchIcp([specific, general], { businessName: "DTF Shirt Co" });
    expect(found?.icp.id).toBe("general");
  });

  /**
   * The three conditions an ICP can ask about besides followers.
   *
   * Every one of them refuses when the answer is unknown. The operator's list is full of
   * businesses whose website was never reached and whose listing was never bought, and putting one
   * of those into an ICP would be inventing the fact the ICP asked for.
   */
  describe("conditions", () => {
    it("requires a working website when the ICP asks for one", () => {
      const r = rule({ requiresWebsite: true });
      expect(matchIcp([r], { instagramBio: "dtf", hasWebsite: true })?.name).toBe("DTF transfers");
      expect(matchIcp([r], { instagramBio: "dtf", hasWebsite: false })).toBeNull();
      expect(matchIcp([r], { instagramBio: "dtf" }), "never looked").toBeNull();
    });

    it("counts reviews, and refuses a business whose listing was never looked up", () => {
      const r = rule({ minReviews: 20 });
      expect(matchIcp([r], { instagramBio: "dtf", reviewCount: 41 })?.name).toBe("DTF transfers");
      expect(matchIcp([r], { instagramBio: "dtf", reviewCount: 3 })).toBeNull();
      expect(matchIcp([r], { instagramBio: "dtf" }), "never looked").toBeNull();
    });

    it("limits an ICP to places, matching either half of where a business is", () => {
      const r = rule({ places: ["Texas", "Miami"] });
      expect(matchIcp([r], { instagramBio: "dtf", city: "Austin", state: "Texas" })?.name).toBe("DTF transfers");
      expect(matchIcp([r], { instagramBio: "dtf", city: "Miami", state: "FL" })?.name).toBe("DTF transfers");
      expect(matchIcp([r], { instagramBio: "dtf", city: "Denver", state: "CO" })).toBeNull();
      expect(matchIcp([r], { instagramBio: "dtf" }), "no location stored").toBeNull();
    });

    it("lets a condition carry an ICP that has no words at all", () => {
      const r = rule({ anyOf: [], minReviews: 50, places: ["TX"] });
      const found = matchIcp([r], { city: "Dallas", state: "TX", reviewCount: 120 });
      expect(found?.name).toBe("DTF transfers");
      expect(found?.matchedTerm).toBe("50+ Google reviews, in TX");
    });

    it("says which conditions it applied next to a word that matched", () => {
      const r = rule({ requiresWebsite: true, minReviews: 10 });
      const found = matchIcp([r], { instagramBio: "dtf", hasWebsite: true, reviewCount: 12 });
      expect(found?.hits.map((h) => h.group)).toContain("conditions");
      expect(found?.hits.at(-1)?.term).toBe("has a working website, 10+ Google reviews");
    });
  });

  describe("word boundaries", () => {
    it("matches a short term inside a domain, where punctuation is the boundary", () => {
      // Verbatim from the operator's data — these are real businesses in the list.
      for (const domain of ["dtfdallas.com", "dtf-dallas.com", "bestpricedtf.com"]) {
        const found = matchIcp([rule()], { websiteDomain: domain });
        expect(found?.matchedTerm, domain).toBe("dtf");
      }
    });

    it("does not match a term buried inside an unrelated word", () => {
      expect(matchIcp([rule()], { websiteText: "we widtfoo everything" })).toBeNull();
    });

    it("matches a multi-word phrase as written", () => {
      const found = matchIcp([rule({ anyOf: ["direct to film"] })], {
        websiteText: "Our direct to film transfers are ready in 24 hours.",
      });
      expect(found?.matchedTerm).toBe("direct to film");
    });
  });

  describe("exclusions", () => {
    it("blocks a rule when an excluded term appears anywhere it looks", () => {
      const r = rule({ anyOf: ["screen print"], noneOf: ["equipment"] });
      const found = matchIcp([r], {
        instagramBio: "screen printing supplies",
        websiteText: "We sell screen printing equipment and presses.",
      });
      expect(found).toBeNull();
    });

    it("still matches when the excluded term is absent", () => {
      const r = rule({ anyOf: ["screen print"], noneOf: ["equipment"] });
      expect(matchIcp([r], { instagramBio: "custom screen printing since 1998" })?.industry).toBe("Printing");
    });
  });

  describe("follower gates", () => {
    /**
     * The rule that matters most here. "At least 5,000 followers" must not fire on a business
     * whose Instagram has never been looked up — the answer is unknown, and treating unknown as
     * passing would put businesses in an ICP on the strength of a number nobody has.
     */
    it("does not fire when the follower count is unknown", () => {
      const r = rule({ minFollowers: 5000, anyOf: ["dtf"] });
      expect(matchIcp([r], { instagramBio: "dtf transfers" })).toBeNull();
      expect(matchIcp([r], { instagramBio: "dtf transfers", instagramFollowers: null })).toBeNull();
    });

    it("applies the floor and the ceiling", () => {
      const r = rule({ minFollowers: 1000, maxFollowers: 50000, anyOf: ["dtf"] });
      expect(matchIcp([r], { instagramBio: "dtf", instagramFollowers: 12000 })?.industry).toBe("Printing");
      expect(matchIcp([r], { instagramBio: "dtf", instagramFollowers: 400 })).toBeNull();
      expect(matchIcp([r], { instagramBio: "dtf", instagramFollowers: 90000 })).toBeNull();
    });

    it("allows a rule that is only a follower gate", () => {
      const r = rule({ anyOf: [], minFollowers: 10000, industry: "Fashion", name: "Large following" });
      expect(matchIcp([r], { instagramFollowers: 40000 })?.name).toBe("Large following");
    });

    /** A rule with no terms and no gate matches everything, which is never what anyone meant. */
    it("ignores a rule with no conditions at all", () => {
      expect(matchIcp([rule({ anyOf: [], noneOf: [] })], { instagramBio: "anything" })).toBeNull();
    });
  });

  describe("sources", () => {
    it("looks only where the rule says to", () => {
      const r = rule({ sources: ["instagram_bio"] });
      expect(matchIcp([r], { instagramBio: "dtf transfers" })?.matchedIn).toBe("instagram_bio");
      expect(matchIcp([r], { websiteText: "dtf transfers" })).toBeNull();
    });

    it("looks everywhere when the rule names no sources", () => {
      expect(matchIcp([rule()], { metaAdsText: "Order your DTF gang sheets today" })?.matchedIn).toBe(
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
      const found = matchIcp([both], {
        websiteText: "custom embroidery since 1998",
        instagramCategory: "Clothing brand",
      });
      expect(found?.industry).toBe("Printing");
      expect(found?.hits.map((h) => h.group)).toEqual(["website", "instagram"]);
    });

    it("declines when only the website side is true", () => {
      expect(
        matchIcp([both], { websiteText: "custom embroidery since 1998", instagramCategory: "Local business" }),
      ).toBeNull();
    });

    it("declines when only the Instagram side is true", () => {
      expect(matchIcp([both], { websiteText: "we cut vinyl signs", instagramCategory: "Clothing brand" })).toBeNull();
    });

    /**
     * The third state, again. A require-all rule about an Instagram account nobody has bought must
     * stay silent — not fire because the website half was enough, and not be recorded as a business
     * that failed the Instagram test. Nobody has looked.
     */
    it("stays silent when the Instagram side was never fetched", () => {
      expect(matchIcp([both], { websiteText: "custom embroidery since 1998" })).toBeNull();
    });

    it("a website group never reads the Instagram bio, and the reverse", () => {
      const websiteOnly = rule({ anyOf: [], websiteAnyOf: ["dtf"] });
      expect(matchIcp([websiteOnly], { instagramBio: "dtf transfers" })).toBeNull();
      expect(matchIcp([websiteOnly], { websiteDomain: "dtfdallas.com" })?.matchedIn).toBe("website_domain");

      const instagramOnly = rule({ anyOf: [], instagramAnyOf: ["dtf"] });
      expect(matchIcp([instagramOnly], { websiteText: "dtf transfers" })).toBeNull();
      expect(matchIcp([instagramOnly], { instagramHandle: "dtf_dallas" })?.matchedIn).toBe("instagram_handle");
    });

    it("without requireAll, either side firing is enough", () => {
      const either = rule({ anyOf: [], websiteAnyOf: ["embroidery"], instagramAnyOf: ["clothing brand"] });
      expect(matchIcp([either], { websiteText: "embroidery" })?.hits).toHaveLength(1);
      expect(matchIcp([either], { instagramCategory: "Clothing brand" })?.hits).toHaveLength(1);
    });

    it("excludes on the pinned sides too, not only the sources list", () => {
      const r = rule({ anyOf: [], websiteAnyOf: ["embroidery"], noneOf: ["equipment"] });
      expect(matchIcp([r], { websiteText: "embroidery equipment for sale" })).toBeNull();
    });

    it("counts a follower gate as its own hit so the record says the range applied", () => {
      const r = rule({ minFollowers: 1000 });
      const found = matchIcp([r], { instagramBio: "dtf transfers", instagramFollowers: 4200 });
      expect(found?.hits.map((h) => h.group)).toEqual(["anywhere", "followers"]);
    });
  });
});
