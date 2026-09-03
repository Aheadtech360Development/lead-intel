import { describe, expect, it } from "vitest";
import { buildExplainPrompt, cannotExplain, parseExplanation, type ExplainInput } from "./explain.js";

function input(over: Partial<ExplainInput> = {}): ExplainInput {
  return {
    businessName: "Crystal DTF",
    city: "Dallas",
    siteText: "We print DTF gang sheets and transfers, shipped next day across Texas.",
    firedChecks: [
      { checkId: "W5", evidence: "The site takes 8.2s to become usable on a phone.", points: 30 },
      { checkId: "D1", evidence: "No analytics tag was found on any page read.", points: 12 },
    ],
    route: "website rebuild",
    operatorCategory: "Printing > DTF transfers",
    ...over,
  };
}

describe("cannotExplain", () => {
  /**
   * The refusal that matters. With no site text and no fired checks the model has a name and a
   * town, and anything it writes from that is invention — which would then be read aloud on a call.
   */
  it("refuses when there is nothing to summarise", () => {
    const reason = cannotExplain(input({ siteText: null, firedChecks: [] }));
    expect(reason).not.toBeNull();
    expect(reason).toContain("invented");
  });

  it("refuses when the site text is too thin to say anything about", () => {
    expect(cannotExplain(input({ siteText: "Home", firedChecks: [] }))).not.toBeNull();
  });

  it("allows it when there are findings even without site text", () => {
    expect(cannotExplain(input({ siteText: null }))).toBeNull();
  });

  it("allows it when there is site text even with no findings", () => {
    expect(cannotExplain(input({ firedChecks: [] }))).toBeNull();
  });
});

describe("buildExplainPrompt", () => {
  it("carries the site text and every fired check with its evidence", () => {
    const prompt = buildExplainPrompt(input());
    expect(prompt).toContain("gang sheets");
    expect(prompt).toContain("[W5]");
    expect(prompt).toContain("8.2s");
    expect(prompt).toContain("[D1]");
  });

  it("orders the problems worst first", () => {
    const prompt = buildExplainPrompt(input());
    expect(prompt.indexOf("[W5]")).toBeLessThan(prompt.indexOf("[D1]"));
  });

  /** The instruction that stops a fabricated problem, stated in the material and not only in the system prompt. */
  it("says the fired checks are the only problems that may be mentioned", () => {
    expect(buildExplainPrompt(input())).toContain("ONLY problems you may mention");
  });

  it("tells the model to say so rather than guess when the site could not be read", () => {
    const prompt = buildExplainPrompt(input({ siteText: null }));
    expect(prompt).toContain("could not be read");
    expect(prompt).toContain("rather than guessing");
  });

  it("forbids inventing problems when nothing fired", () => {
    expect(buildExplainPrompt(input({ firedChecks: [] }))).toContain("Do not invent any");
  });

  it("asks for a category suggestion when the operator has none", () => {
    const prompt = buildExplainPrompt(input({ operatorCategory: null }));
    expect(prompt).toContain("no category for them yet");
  });
});

describe("parseExplanation", () => {
  it("reads a well-formed answer", () => {
    const parsed = parseExplanation({
      summary: "Crystal DTF prints gang sheets in Dallas and pushes next-day shipping hardest of all.",
      categoryVerdict: "agrees",
      categoryNote: "The site is entirely about DTF transfers.",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.explanation.categoryVerdict).toBe("agrees");
  });

  /** A stub summary occupies the place a briefing should be and says nothing, which reads as "nothing to say". */
  it("refuses a summary too short to be a briefing", () => {
    expect(parseExplanation({ summary: "A print shop.", categoryVerdict: "agrees" }).ok).toBe(false);
    expect(parseExplanation({ summary: "", categoryVerdict: "agrees" }).ok).toBe(false);
  });

  it("refuses anything that is not an object", () => {
    expect(parseExplanation(null).ok).toBe(false);
    expect(parseExplanation("a summary").ok).toBe(false);
  });

  it("falls back to unclear for a verdict it does not recognise", () => {
    const parsed = parseExplanation({
      summary: "Crystal DTF prints gang sheets in Dallas and ships them across Texas next day.",
      categoryVerdict: "probably fine",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.explanation.categoryVerdict).toBe("unclear");
  });

  it("tolerates a missing note without losing the summary", () => {
    const parsed = parseExplanation({
      summary: "Crystal DTF prints gang sheets in Dallas and ships them across Texas next day.",
      categoryVerdict: "agrees",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.explanation.categoryNote).toBe("");
  });
});
