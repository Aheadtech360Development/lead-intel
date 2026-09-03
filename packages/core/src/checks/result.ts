import { checkDefinition } from "./registry.js";
import type { CheckResult } from "./types.js";

/**
 * The four ways a check may end, as four constructors.
 *
 * Every check in this module returns through one of these rather than building a `CheckResult`
 * by hand, which is what makes §6.1's accounting rule impossible to get wrong in a check:
 * `points` and `maxPoints` are derived from the outcome and the registry, never chosen at the
 * call site. A check cannot accidentally leave attainable points on the table for a measurement
 * it never made, and it cannot award itself more than the spec allows.
 *
 * The database carries the same rule as a CHECK constraint (findings_points_match_outcome), so
 * a row that broke it would be rejected rather than silently scored. Two layers, deliberately:
 * these constructors are the reason it never happens, and the constraint is the proof.
 */

function base(id: string) {
  const definition = checkDefinition(id);
  return {
    checkId: definition.id,
    family: definition.family,
    area: definition.area,
    costClass: definition.costClass,
  };
}

/** The deficiency is real. `points` defaults to the check's full value; tiered checks pass less. */
export function fired(
  id: string,
  evidence: string,
  options: { points?: number; detail?: Record<string, unknown> } = {},
): CheckResult {
  const definition = checkDefinition(id);
  const points = options.points ?? definition.points;
  if (points <= 0 || points > definition.points) {
    throw new Error(
      `${id} fired for ${points} points, outside its 1..${definition.points} range — a check may never award itself more than the spec allows`,
    );
  }
  return {
    ...base(id),
    outcome: "fired",
    points,
    maxPoints: definition.points,
    evidence,
    ...(options.detail ? { detail: options.detail } : {}),
  };
}

/** The check ran and found no problem. Contributes to the attainable total, earns nothing. */
export function passed(id: string, evidence: string, detail?: Record<string, unknown>): CheckResult {
  return {
    ...base(id),
    outcome: "passed",
    points: 0,
    maxPoints: checkDefinition(id).points,
    evidence,
    ...(detail ? { detail } : {}),
  };
}

/**
 * We could not tell. Spec §13's central rule lives here: this contributes to *neither* side of
 * the area score, so a site we failed to read neither gains nor loses points for it. The
 * `evidence` string should say what stopped us, because an operator reading "not measured" with
 * no reason will assume the worst — or worse, assume the best.
 */
export function notMeasured(id: string, evidence: string, detail?: Record<string, unknown>): CheckResult {
  return {
    ...base(id),
    outcome: "not_measured",
    points: 0,
    maxPoints: 0,
    evidence,
    ...(detail ? { detail } : {}),
  };
}

/** The check does not apply to this business at all. Also excluded from both sides. */
export function notApplicable(id: string, evidence: string, detail?: Record<string, unknown>): CheckResult {
  return {
    ...base(id),
    outcome: "not_applicable",
    points: 0,
    maxPoints: 0,
    evidence,
    ...(detail ? { detail } : {}),
  };
}
