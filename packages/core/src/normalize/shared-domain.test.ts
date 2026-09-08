import { describe, expect, it } from "vitest";
import { sharedPlatformDomain, nameMatchesChain } from "./shared-domain.js";

describe("sharedPlatformDomain — chains and platforms", () => {
  /** Every one of these came out of the live dataset, several of them above the Stage 5 gate. */
  it.each([
    ["local.targetoptical.com", "chain"],
    ["locations.jcpenneyoptical.com", "chain"],
    ["americasbest.com", "chain"],
    ["samsclub.com", "chain"],
    ["walmart.com", "chain"],
    ["costco.com", "chain"],
    ["locations.michaels.com", "chain"],
    ["local.lenscrafters.com", "chain"],
    ["optical.bjs.com", "chain"],
    ["stantonoptical.com", "chain"],
    ["fullypromoted.com", "chain"],
    ["booksy.com", "platform"],
    ["houseofkerlbraiding.booksy.com", "platform"],
    ["vagaro.com", "platform"],
    ["styleseat.com", "platform"],
    ["qgbraids.square.site", "platform"],
    ["heavenly-hands-crocheting.square.site", "platform"],
    ["lolamedina.as.me", "platform"],
    ["braidsbyivory1.glossgenius.com", "platform"],
    ["fyyc4h-rh.myshopify.com", "platform"],
    ["unitythreadsclub.company.site", "platform"],
    ["facebook.com", "platform"],
  ])("flags %s as a %s domain", (domain, kind) => {
    const verdict = sharedPlatformDomain(domain);
    expect(verdict, domain).not.toBeNull();
    expect(verdict?.kind).toBe(kind);
    expect(verdict?.reason.length).toBeGreaterThan(0);
  });
});

describe("sharedPlatformDomain — leaves real local businesses alone", () => {
  /**
   * The expensive direction. Flagging a genuine independent silences a real lead, and these are
   * all businesses the live run scored correctly — including two whose names contain a platform
   * word and one on a `.top` domain.
   */
  it.each([
    "aheadtech360.com",
    "tshirtsflorida.com",
    "fibercircleyarn.com",
    "bestoptionscreenprinting.com",
    "mastersofprints.co",
    "eliteflyers.com",
    "texasoptical.net",
    "thistlecreativereuse.com",
    "urbanspools.com",
    "craftyarncouncil.com",
    "stitchonthesquare.com",
    "squarefabrics.com",
    "targetprintshop.com",
    "americastopbusi.top",
  ])("does not flag %s", (domain) => {
    expect(sharedPlatformDomain(domain), domain).toBeNull();
  });

  it("returns null for nothing at all", () => {
    expect(sharedPlatformDomain(null)).toBeNull();
    expect(sharedPlatformDomain(undefined)).toBeNull();
    expect(sharedPlatformDomain("")).toBeNull();
    expect(sharedPlatformDomain("   ")).toBeNull();
  });
});

/**
 * The name check, and the line it must not cross.
 *
 * It exists because "Office Depot Print & Copy Services" reached Tier 1 with no website on its
 * listing — no domain, so nothing for the domain guard to match. It raises a flag and nothing more.
 */
describe("nameMatchesChain", () => {
  it("recognises a chain that leads with its brand", () => {
    expect(nameMatchesChain("Office Depot Print & Copy Services")).toBe("officedepot.com");
    expect(nameMatchesChain("Hobby Lobby")).toBe("hobbylobby.com");
    expect(nameMatchesChain("Target Optical")).toBe("targetoptical.com");
  });

  /**
   * The whole reason this only ever flags. Every one of these is a plausible independent business,
   * and excluding on this signal would silence them.
   */
  it("does not match an independent that merely mentions a chain later", () => {
    expect(nameMatchesChain("Braids Near Target")).toBeNull();
    expect(nameMatchesChain("Prints Next To Staples")).toBeNull();
  });

  it("handles punctuation and spacing the way a listing writes it", () => {
    expect(nameMatchesChain("OFFICE DEPOT")).toBe("officedepot.com");
    expect(nameMatchesChain("office-depot print")).toBe("officedepot.com");
  });

  it("returns null for an ordinary local business", () => {
    expect(nameMatchesChain("Kirra's Braids")).toBeNull();
    expect(nameMatchesChain("Braider Zee Beauty Supply")).toBeNull();
    expect(nameMatchesChain("")).toBeNull();
    expect(nameMatchesChain(null)).toBeNull();
  });
});
