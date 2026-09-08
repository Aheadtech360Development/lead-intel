import { describe, expect, it } from "vitest";
import { buildCritiquePrompt, cannotCritique, parseCritique, type CritiqueInput } from "./critique.js";
import type { ChecklistResult, ChecklistRule } from "./checklist.js";
import { extractStructure } from "./structure.js";

function result(over: Partial<ChecklistRule> & { outcome?: ChecklistResult["outcome"] } = {}): ChecklistResult {
  const { outcome = "failed", ...ruleOver } = over;
  return {
    rule: {
      id: "r1",
      name: "Phone in the header",
      pageType: null,
      category: null,
      field: "header.phone",
      test: "present",
      value: null,
      weight: 20,
      enabled: true,
      says: "There is no tap-to-call number in the header.",
      ...ruleOver,
    },
    outcome,
    found: null,
    because: "it is missing",
  };
}

function input(over: Partial<CritiqueInput> = {}): CritiqueInput {
  return {
    businessName: "Crystal DTF",
    pageType: "home",
    url: "https://crystaldtf.com/",
    structure: extractStructure(`<header><a href="/x">Home</a></header><h1>DTF Transfers</h1><a href="/s">Submit</a>`),
    results: [result()],
    ...over,
  };
}

describe("cannotCritique", () => {
  it("refuses a page that never rendered", () => {
    expect(cannotCritique(input({ structure: null }))).toContain("did not render");
  });

  it("refuses when no rule applies, because there is nothing to add to", () => {
    expect(cannotCritique(input({ results: [] }))).toContain("nothing for a critique");
  });

  it("allows it when there is structure and at least one result", () => {
    expect(cannotCritique(input())).toBeNull();
  });
});

describe("buildCritiquePrompt", () => {
  it("gives the model the button wording, which is what it can judge", () => {
    const prompt = buildCritiquePrompt(input());
    expect(prompt).toContain("Submit");
  });

  /**
   * The instruction that stops the model restating the checklist. Repeating a failed check is the
   * one output with no value — the operator can already see those, directly above.
   */
  it("tells the model not to repeat the failed checks", () => {
    const prompt = buildCritiquePrompt(input());
    expect(prompt).toContain("do not repeat them");
    expect(prompt).toContain("There is no tap-to-call number in the header.");
  });

  it("names what could not be checked, so unmeasured is not read as absent", () => {
    const prompt = buildCritiquePrompt(input({ results: [result({ outcome: "unknown", name: "Scrolls sideways" })] }));
    expect(prompt).toContain("Could not be checked");
    expect(prompt).toContain("Do not treat these as faults");
  });

  it("lists what passed as well, so the judgement is not all negative", () => {
    const prompt = buildCritiquePrompt(input({ results: [result({ outcome: "passed", name: "Has a footer" })] }));
    expect(prompt).toContain("Checks it PASSED");
    expect(prompt).toContain("Has a footer");
  });

  it("says none rather than leaving a heading with nothing under it", () => {
    const prompt = buildCritiquePrompt(input({ results: [result({ outcome: "passed" })] }));
    expect(prompt).toContain("FAILED (0)");
  });
});

describe("parseCritique", () => {
  it("reads a well-formed answer", () => {
    const parsed = parseCritique({
      purpose: "The page wants visitors to order transfers, and says so in the first line.",
      judgement: "The only button says Submit, which asks for nothing in particular.",
      openWith: "Their main button says Submit rather than naming what happens next.",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.critique.openWith).toContain("Submit");
  });

  /** A critique that restates the page has given the operator the one thing they did not need. */
  it("refuses an answer with no judgement in it", () => {
    const parsed = parseCritique({ purpose: "This is the home page of a printing business.", judgement: "Fine." });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain("too thin");
  });

  it("refuses anything that is not an object", () => {
    expect(parseCritique(null).ok).toBe(false);
    expect(parseCritique("a critique").ok).toBe(false);
  });

  it("accepts an empty openWith, which means nothing here is worth leading with", () => {
    const parsed = parseCritique({
      purpose: "The page lists services but never asks for anything.",
      judgement: "Nothing on it moves a visitor towards contacting them.",
      openWith: "",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.critique.openWith).toBe("");
  });
});
