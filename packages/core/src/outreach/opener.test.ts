import { describe, expect, it } from "vitest";
import { fired, notMeasured, passed } from "../checks/result.js";
import type { CheckResult } from "../checks/types.js";
import { buildOpeners } from "./opener.js";

function build(route: Parameters<typeof buildOpeners>[0]["route"], findings: CheckResult[], city: string | null = "miami") {
  return buildOpeners({ businessName: "Acme Printing", city, route, findings });
}

describe("buildOpeners — §8.3's rule", () => {
  /**
   * §8.3, verbatim: "Every suggested opening line names the finding it came from. If it cannot,
   * none is generated." There is deliberately no template of last resort — an operator reading a
   * confident sentence built on nothing is a worse outcome than an operator reading no sentence.
   */
  it("generates nothing when the routed area has no finding", () => {
    const result = build("advertising", [passed("D1", "tracking is installed"), notMeasured("D2", "not read")]);
    expect(result.openers).toEqual([]);
    expect(result.reason).not.toBeNull();
  });

  it("generates nothing when there is no route", () => {
    const result = build(null, [fired("D1", "no tracking at all")]);
    expect(result.openers).toEqual([]);
    expect(result.reason).toMatch(/no recommended service/i);
  });

  it("always names the finding behind the line", () => {
    const result = build("advertising", [fired("D1", "The site carries no tracking of any kind.")]);
    expect(result.openers).toHaveLength(2);
    for (const opener of result.openers) {
      expect(opener.checkId).toBe("D1");
      expect(opener.evidence).toBe("The site carries no tracking of any kind.");
      expect(opener.text.length).toBeGreaterThan(20);
    }
    expect(result.reason).toBeNull();
  });

  it("produces one line for a call and one for a message", () => {
    const result = build("contactability", [fired("K1", "No phone number anywhere on the site.")]);
    expect(result.openers.map((o) => o.channel).sort()).toEqual(["call", "message"]);
    expect(result.openers[0]?.text).not.toBe(result.openers[1]?.text);
  });
});

describe("buildOpeners — which finding it draws from", () => {
  /**
   * Routing has already decided what is being sold. An opener about tracking pixels on a call
   * meant to sell a website rebuild would undercut the conversation it is opening.
   */
  it("draws from the routed area, not the highest-scoring finding overall", () => {
    const result = build("contactability", [
      fired("D1", "no tracking"), // 35 points, higher — but ADS, not the routed area
      fired("K1", "no phone number"), // 30 points, CON
    ]);
    expect(result.openers[0]?.checkId).toBe("K1");
  });

  it("picks the heaviest finding within that area", () => {
    const result = build("contactability", [fired("K5", "no hours"), fired("K1", "no phone number"), fired("K8", "no cta")]);
    expect(result.openers[0]?.checkId).toBe("K1"); // 30 > 15
  });

  /** Not every check is worth saying out loud. A finding with no line simply is not used. */
  it("falls through to a finding that has a line rather than inventing one", () => {
    const result = build("web_development", [fired("W12", "half the images have no alt text"), fired("W6", "slow on mobile")]);
    expect(result.openers[0]?.checkId).toBe("W6");
  });

  it("says so when the only findings have no line written for them", () => {
    const result = build("web_development", [fired("W11", "no favicon"), fired("W12", "no alt text")]);
    expect(result.openers).toEqual([]);
    expect(result.reason).toMatch(/no opening line/i);
  });
});

describe("buildOpeners — the words themselves", () => {
  it("names the business", () => {
    const result = build("advertising", [fired("D1", "no tracking")]);
    for (const opener of result.openers) expect(opener.text).toContain("Acme Printing");
  });

  it("uses the city when it is known, and leaves it out cleanly when it is not", () => {
    const withCity = build("social_media", [fired("O2", "no facebook")], "fort worth");
    expect(withCity.openers.some((o) => o.text.includes("Fort Worth"))).toBe(true);

    const withoutCity = build("social_media", [fired("O2", "no facebook")], null);
    for (const opener of withoutCity.openers) {
      expect(opener.text).not.toMatch(/\bin\s*[.,]|\bin\s*$|undefined|null/);
    }
  });

  /**
   * An opener that oversells is worse than no opener: the operator has to walk it back live, on
   * the call, having already claimed it.
   */
  it("never promises a result or a number", () => {
    const routes = ["web_development", "local_seo", "reputation", "contactability", "social_media", "advertising"] as const;
    const samples: CheckResult[][] = [
      [fired("W1", "x")], [fired("W6", "x")], [fired("K1", "x")], [fired("S1", "x")],
      [fired("R1", "x")], [fired("O1", "x")], [fired("D1", "x")],
    ];
    for (const route of routes) {
      for (const findings of samples) {
        for (const opener of build(route, findings).openers) {
          expect(opener.text).not.toMatch(/guarantee|double|triple|\d+\s*%|\bROI\b|top of google|#1|number one/i);
        }
      }
    }
  });
});

describe("buildOpeners — not the same script five times in a row", () => {
  /**
   * "No social links at all" fires on most of this dataset, so the heaviest-finding rule gave five
   * businesses in a row the identical opener. That is how a caller starts sounding like a robot.
   */
  it("prefers a finding not used on the last few calls", () => {
    const findings = [fired("O1", "no social links"), fired("O2", "no facebook")];
    const fresh = build("social_media", findings);
    expect(fresh.openers[0]?.checkId).toBe("O1"); // heaviest, when nothing was used recently

    const varied = buildOpeners({
      businessName: "Acme Printing",
      city: "miami",
      route: "social_media",
      findings,
      recentlyUsedCheckIds: ["O1", "O1", "O1"],
    });
    expect(varied.openers[0]?.checkId).toBe("O2");
  });

  /** It is a tie-break among findings that all genuinely fired — never a reason to invent one. */
  it("still uses the overused finding when it is the only one there is", () => {
    const only = buildOpeners({
      businessName: "Acme Printing",
      city: "miami",
      route: "social_media",
      findings: [fired("O1", "no social links")],
      recentlyUsedCheckIds: ["O1", "O1", "O1"],
    });
    expect(only.openers[0]?.checkId).toBe("O1");
  });
});
