import { describe, expect, it } from "vitest";
import { checkedness, checkednessFromAreas } from "./coverage.js";

const results = (fired: number, passed: number, unmeasured: number) => [
  ...Array.from({ length: fired }, () => ({ outcome: "fired" as const })),
  ...Array.from({ length: passed }, () => ({ outcome: "passed" as const })),
  ...Array.from({ length: unmeasured }, () => ({ outcome: "not_measured" as const })),
];

describe("checkedness", () => {
  it("calls a business nobody has looked at nothing, not zero", () => {
    const answer = checkedness(results(0, 0, 51));
    expect(answer.band).toBe("nothing");
    expect(answer.measured).toBe(0);
    expect(answer.sentence).toContain("Nothing has been checked");
  });

  /** The 48 live records sitting at Problem 90, Priority 1, on three answered checks. */
  it("marks a score built from almost nothing as thin, and says so", () => {
    const answer = checkedness(results(1, 2, 20));
    expect(answer.band).toBe("thin");
    expect(answer.sentence).toContain("rests on very little");
  });

  it("separates partial from good", () => {
    expect(checkedness(results(4, 8, 0)).band).toBe("partial");
    expect(checkedness(results(10, 25, 5)).band).toBe("good");
  });

  /** An unanswerable check is never counted as evidence, only reported alongside it. */
  it("never counts an unmeasured check as measured", () => {
    const answer = checkedness(results(2, 2, 40));
    expect(answer.measured).toBe(4);
    expect(answer.unmeasured).toBe(40);
  });
});

describe("checkednessFromAreas", () => {
  it("adds up what the stored area scores already know", () => {
    const areas = { WEB: { measuredCount: 9 }, SEO: { measuredCount: 10 }, REP: { measuredCount: 3 } };
    expect(checkednessFromAreas(areas).measured).toBe(22);
  });

  it("treats a missing or malformed column as nothing measured, never as a guess", () => {
    expect(checkednessFromAreas(null).band).toBe("nothing");
    expect(checkednessFromAreas({ WEB: "broken" }).measured).toBe(0);
  });
});
