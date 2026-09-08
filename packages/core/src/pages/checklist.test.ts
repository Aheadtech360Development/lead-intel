import { describe, expect, it } from "vitest";
import { CHECKABLE_FIELDS, runChecklist, type ChecklistRule, type PageFactsForChecklist } from "./checklist.js";
import { extractStructure } from "./structure.js";

function rule(over: Partial<ChecklistRule> = {}): ChecklistRule {
  return {
    id: "r1",
    name: "Phone in the header",
    pageType: null,
    category: null,
    field: "header.phone",
    test: "present",
    value: null,
    weight: 10,
    enabled: true,
    says: "There is no phone number in the header.",
    ...over,
  };
}

const PAGE = `
<header><a href="tel:+12145550123">Call us</a><a href="/quote">Get a quote</a></header>
<h1>DTF transfers in Dallas</h1>
<div class="testimonial"><p>Great service, fast turnaround, would order again from these folks.</p><cite>Marcus B.</cite></div>
<form><input name="a"><input name="b"><textarea name="msg"></textarea></form>
<footer><p>&copy; 2026</p></footer>`;

function facts(over: Partial<PageFactsForChecklist> = {}): PageFactsForChecklist {
  return {
    pageType: "home",
    category: "Printing",
    structure: extractStructure(PAGE),
    layout: { scrollsSideways: false, smallTapTargets: 40, brokenImages: 0, phoneAboveFold: true },
    ...over,
  };
}

describe("runChecklist", () => {
  it("passes a rule the page satisfies", () => {
    const [result] = runChecklist([rule()], facts());
    expect(result?.outcome).toBe("passed");
    expect(result?.found).toContain("tel:");
  });

  it("fails a rule the page does not", () => {
    const [result] = runChecklist([rule()], facts({ structure: extractStructure("<header><a href='/x'>Home</a></header>") }));
    expect(result?.outcome).toBe("failed");
    expect(result?.found).toBeNull();
  });

  /**
   * The distinction the whole product rests on. A page that never rendered has no layout, and
   * reporting that as a failure would tell an operator the site scrolls sideways when the truth is
   * nobody looked. This project has already put one false "your social links are broken" in front
   * of a real Priority 1 lead.
   */
  describe("not knowing", () => {
    it("says unknown, not failed, when the page never rendered", () => {
      const [result] = runChecklist([rule({ field: "layout.scrollsSideways", test: "is_false" })], facts({ layout: null }));
      expect(result?.outcome).toBe("unknown");
      expect(result?.because).toContain("did not render");
    });

    it("says unknown when the page could not be read at all", () => {
      const [result] = runChecklist([rule()], facts({ structure: null }));
      expect(result?.outcome).toBe("unknown");
      expect(result?.because).toContain("could not be read");
    });

    it("says unknown rather than failed when a rule names a field that no longer exists", () => {
      const [result] = runChecklist([rule({ field: "header.phon" })], facts());
      expect(result?.outcome).toBe("unknown");
      expect(result?.because).toContain("no longer exists");
    });

    it("says unknown when a number test has nothing numeric to compare", () => {
      const [result] = runChecklist([rule({ field: "hero.h1", test: "at_least", value: 2 })], facts());
      expect(result?.outcome).toBe("unknown");
    });
  });

  describe("which rules apply", () => {
    it("skips a rule meant for a different page type", () => {
      expect(runChecklist([rule({ pageType: "contact" })], facts({ pageType: "home" }))).toHaveLength(0);
      expect(runChecklist([rule({ pageType: "home" })], facts({ pageType: "home" }))).toHaveLength(1);
    });

    it("skips a rule meant for a different category", () => {
      expect(runChecklist([rule({ category: "Fashion" })], facts({ category: "Printing" }))).toHaveLength(0);
    });

    /** A rule with no category is universal — that is where "every page needs one h1" lives. */
    it("applies a rule with no category to everything", () => {
      expect(runChecklist([rule({ category: null })], facts({ category: "Fashion" }))).toHaveLength(1);
      expect(runChecklist([rule({ category: null })], facts({ category: null }))).toHaveLength(1);
    });

    it("skips a rule that is turned off", () => {
      expect(runChecklist([rule({ enabled: false })], facts())).toHaveLength(0);
    });
  });

  describe("the tests", () => {
    it("counts things", () => {
      const [tooMany] = runChecklist([rule({ field: "forms.fields", test: "at_most", value: 2 })], facts());
      expect(tooMany?.outcome).toBe("failed");
      expect(tooMany?.because).toContain("3 is not");

      const [enough] = runChecklist([rule({ field: "forms.fields", test: "at_least", value: 3 })], facts());
      expect(enough?.outcome).toBe("passed");
    });

    it("reads booleans both ways", () => {
      const [ok] = runChecklist([rule({ field: "layout.scrollsSideways", test: "is_false" })], facts());
      expect(ok?.outcome).toBe("passed");

      const [bad] = runChecklist([rule({ field: "layout.scrollsSideways", test: "is_true" })], facts());
      expect(bad?.outcome).toBe("failed");
    });

    it("exposes calls to action as counts, which is how a rule wants them", () => {
      const [any] = runChecklist([rule({ field: "ctas.count", test: "at_least", value: 1 })], facts());
      expect(any?.outcome).toBe("passed");

      const [inHeader] = runChecklist([rule({ field: "ctas.inHeader", test: "at_least", value: 1 })], facts());
      expect(inHeader?.outcome).toBe("passed");
    });

    /**
     * Zero is a value, not an absence. A page with zero reviews has a review count; a rule asking
     * whether the count is present is not asking whether anybody reviewed them.
     */
    it("treats zero and false as present", () => {
      const [zero] = runChecklist(
        [rule({ field: "reviews.count", test: "present" })],
        facts({ structure: extractStructure("<p>nothing</p>") }),
      );
      expect(zero?.outcome).toBe("passed");
    });

    it("treats an empty list as absent", () => {
      const [empty] = runChecklist([rule({ field: "footer.social", test: "absent" })], facts());
      expect(empty?.outcome).toBe("passed");
    });
  });

  it("every catalogued field can be read without throwing", () => {
    for (const field of CHECKABLE_FIELDS) {
      const results = runChecklist([rule({ field: field.id, test: "present" })], facts());
      expect(results).toHaveLength(1);
      expect(["passed", "failed", "unknown"]).toContain(results[0]?.outcome);
    }
  });
});
