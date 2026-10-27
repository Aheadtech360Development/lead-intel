import { CHECK_DEFINITIONS } from "../checks/registry.js";
import type { CheckResult } from "../checks/types.js";

/**
 * How much of a business has actually been looked at.
 *
 * This exists because of a report that was precise and entirely justified: *"jab humne kisi
 * business ko check nhi kia hua hota tab bhi uska score dikh raha hota"*. It is true, and the
 * numbers were startling — 196 of 559 businesses carried a score built from five checks or fewer,
 * and 48 of those sat at Problem 90, Priority 1, at the very top of the call list.
 *
 * None of that is a scoring bug. A business whose Google listing shows no website and hundreds of
 * reviews genuinely *is* the best lead on the list, and the demand rule is right to say so from
 * almost no evidence. The bug is that the screen showed "90" in exactly the same ink as a 90 built
 * from forty measurements, and an operator cannot tell a confident answer from a thin one by
 * looking at the number — because the number does not carry that.
 *
 * So this is the missing half of every score: what it was made of. Shown beside the figure, it
 * turns "90" into "90, from 3 checks" — which is still a good lead and now an honest one.
 */
export interface Checkedness {
  /** Checks that produced a real answer: fired or passed. */
  measured: number;
  /** Checks that were attempted and could not be answered — a source said so in words. */
  unmeasured: number;
  /** Every check in the catalogue, including the ones no connected source can answer yet. */
  catalogue: number;
  /** measured ÷ catalogue, 0-1. */
  share: number;
  /**
   * How thin this is, in one word, for the one place a colour has to be chosen.
   *
   * The bands are deliberately coarse: this is a warning about confidence, not a second score, and
   * a precise-looking percentage would invite exactly the false precision it exists to prevent.
   */
  band: "nothing" | "thin" | "partial" | "good";
  /** One sentence, written for the operator, never blank. */
  sentence: string;
}

/** Below this many answered checks, a score is a guess with a number on it. */
const THIN = 6;
/** At or above this, enough of the catalogue has been answered to argue from. */
const GOOD = 20;

export function checkedness(findings: Pick<CheckResult, "outcome">[]): Checkedness {
  const measured = findings.filter((f) => f.outcome === "fired" || f.outcome === "passed").length;
  const unmeasured = findings.filter((f) => f.outcome === "not_measured").length;
  const catalogue = CHECK_DEFINITIONS.length;
  const share = catalogue > 0 ? measured / catalogue : 0;

  const band: Checkedness["band"] =
    measured === 0 ? "nothing" : measured < THIN ? "thin" : measured < GOOD ? "partial" : "good";

  const sentence =
    band === "nothing"
      ? "Nothing has been checked on this business yet. Any score here comes from its Google listing alone."
      : band === "thin"
        ? `Only ${measured} of ${catalogue} checks have been answered, so this score rests on very little. Analysing their website is free.`
        : band === "partial"
          ? `${measured} of ${catalogue} checks answered. Enough to rank by, not enough to be sure of.`
          : `${measured} of ${catalogue} checks answered${unmeasured > 0 ? `, ${unmeasured} that no connected source can answer` : ""}.`;

  return { measured, unmeasured, catalogue, share, band, sentence };
}

/**
 * The same thing, from the `area_scores` already stored on a business record.
 *
 * The leads list has no findings to hand and must not fetch 51 rows per business to draw a column.
 * Every area score already carries its own `measuredCount`, so the sum across the six areas is
 * free — it is in a column the list is reading anyway. It counts area checks only, so it runs a
 * little below the figure above, which includes the N-family intent checks.
 */
export function checkednessFromAreas(areaScores: unknown): Checkedness {
  let measured = 0;
  if (areaScores && typeof areaScores === "object") {
    for (const area of Object.values(areaScores as Record<string, unknown>)) {
      if (area && typeof area === "object" && typeof (area as { measuredCount?: unknown }).measuredCount === "number") {
        measured += (area as { measuredCount: number }).measuredCount;
      }
    }
  }
  return checkedness(Array.from({ length: measured }, () => ({ outcome: "passed" as const })));
}
