import type { CheckResult } from "../checks/types.js";

/**
 * A plain-language account of one business, written from findings that already exist.
 *
 * The operator's request was precise: *"AI isko poora sahi se explain kerde or neeche points bhi
 * show hon — ager AI ne sahi se explain nhi kia to mai points read kerloon."* That shape — prose on
 * top, evidence underneath, unchanged — is the only safe way to put a model in a sales tool, and it
 * is what this is built for.
 *
 * **The model is given findings, not freedom.** It receives the checks that actually fired, each
 * with the evidence sentence the deterministic check produced, plus a bounded digest of the site.
 * It is told, in the system prompt, that it may not add a fact that is not in front of it. That is
 * not a guarantee — no prompt is — which is exactly why the points stay on the page. If the summary
 * is wrong, the operator has the real thing one line below it.
 *
 * The stakes are concrete. This project already had a false "their social links are not connected"
 * reach a Priority 1 lead, caught by the operator rather than by any test. A model writing a
 * confident paragraph around a wrong finding is the same failure with better prose.
 */

export const EXPLAIN_BUSINESS_SYSTEM = `You write a short briefing about one small business for someone who is about to phone them to sell web and marketing services.

You will be given:
- the business name and town
- a digest of the visible words from their website
- the checks that FIRED, meaning a problem was actually detected, each with its evidence
- what the system recommends selling them

Write 3 to 5 sentences, in two short paragraphs:
1. What this business appears to be and what their website pushes hardest — the thing they clearly
   want customers to buy. Take this only from the website digest.
2. What is wrong with their online presence, taken only from the fired checks, and what that means
   for them in practical terms.

Hard rules:
- Use ONLY the material given. Never state a fact that is not in the digest or the findings.
- If the digest is missing or too thin to tell what they do, say so plainly in the first sentence
  rather than guessing. "Their website could not be read, so what they sell is unclear" is a
  correct and useful answer.
- Never mention a problem that is not in the fired checks. In particular, never say they lack
  something unless a check says so — the operator may repeat this on a phone call, and being wrong
  about a missing contact form or missing social links ends the call.
- No greeting, no sign-off, no bullet points, no headings. Plain sentences.
- Do not invent numbers. Use the figures given, or none.
- Write in plain British English at a level a busy person reads once.

Then, separately, give a short verdict on whether the operator's own category for this business
looks right, based on what the website actually emphasises.

Reply with JSON only:
{
  "summary": "the 3-5 sentences",
  "categoryVerdict": "agrees" | "disagrees" | "unclear",
  "categoryNote": "one sentence: if it disagrees, what the site actually looks like; otherwise why it fits, or why you cannot tell"
}`;

export interface ExplainInput {
  businessName: string;
  city: string | null;
  siteText: string | null;
  /** Only checks that fired. An unfired check is not evidence of anything. */
  firedChecks: Array<Pick<CheckResult, "checkId" | "evidence" | "points">>;
  route: string | null;
  operatorCategory: string | null;
}

export interface Explanation {
  summary: string;
  categoryVerdict: "agrees" | "disagrees" | "unclear";
  categoryNote: string;
}

/**
 * Why this business cannot usefully be explained, or null when it can.
 *
 * Checked before spending anything. A business whose site was never read and whose checks never
 * fired gives the model nothing but a name and a town, and what comes back from that is invention —
 * fluent, confident, and made up. Refusing costs nothing and is the honest answer.
 */
export function cannotExplain(input: ExplainInput): string | null {
  // Forty characters is roughly the line between a sentence and a navigation bar. "We print DTF
  // gang sheets and transfers" is 40-odd characters and says exactly what the business does; the
  // digests that are genuinely useless are the JavaScript-only pages that yield "Home About
  // Contact" or "Loading". A higher bar rejected real, usable text — which the test caught.
  const hasText = (input.siteText ?? "").trim().length >= 40;
  if (!hasText && input.firedChecks.length === 0) {
    return "Their website has not been read and no checks have fired, so there is nothing to summarise. A summary written from a name and a town would be invented.";
  }
  return null;
}

export function buildExplainPrompt(input: ExplainInput): string {
  const parts: string[] = [`Business: ${input.businessName}${input.city ? `, ${input.city}` : ""}`];

  parts.push(
    input.siteText && input.siteText.trim().length > 0
      ? `\nWhat their website says (a digest of the visible words, cut short):\n${input.siteText.trim()}`
      : `\nTheir website could not be read, so there is no text from it. Say so rather than guessing what they sell.`,
  );

  if (input.firedChecks.length > 0) {
    // Worst first, so the model's attention lands where the operator's should.
    const ordered = [...input.firedChecks].sort((a, b) => b.points - a.points);
    parts.push(
      `\nProblems detected (${ordered.length}). These are the ONLY problems you may mention:\n` +
        ordered.map((c) => `- [${c.checkId}] ${c.evidence}`).join("\n"),
    );
  } else {
    parts.push(`\nNo problems were detected. Do not invent any — say their presence looks sound.`);
  }

  if (input.route) parts.push(`\nThe system recommends selling them: ${input.route}`);
  parts.push(
    input.operatorCategory
      ? `\nThe operator currently files them under: ${input.operatorCategory}. Judge whether that matches what the website emphasises.`
      : `\nThe operator has no category for them yet. Say what category the website suggests, and set categoryVerdict to "unclear".`,
  );

  return parts.join("\n");
}

/** Reads the answer, refusing anything that is not a usable summary. */
export function parseExplanation(value: unknown): { ok: true; explanation: Explanation } | { ok: false; detail: string } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, detail: "The model did not return an object." };
  }
  const raw = value as Record<string, unknown>;
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";

  // A one-word summary is worse than none: it occupies the place where the operator expects a
  // briefing and says nothing, which reads as "nothing to say about this business".
  if (summary.length < 40) {
    return { ok: false, detail: "The model returned a summary too short to be useful." };
  }

  const verdict = raw.categoryVerdict;
  return {
    ok: true,
    explanation: {
      summary,
      categoryVerdict: verdict === "agrees" || verdict === "disagrees" ? verdict : "unclear",
      categoryNote: typeof raw.categoryNote === "string" ? raw.categoryNote.trim() : "",
    },
  };
}
