import type { ChecklistResult } from "./checklist.js";
import type { PageType } from "./classify.js";
import type { PageStructure } from "./structure.js";

/**
 * The model's read on a page the checklists have already measured.
 *
 * The division of labour is the whole design. **Code answers "is it there".** A call to action
 * either exists or it does not, and a rule settles that for free, identically, every time. **The
 * model answers "is it any good".** A page can have a call to action reading "Submit" and pass
 * every rule while still asking nothing of the visitor, and no amount of counting elements catches
 * that.
 *
 * So the model is handed the measurements — never the raw page to form its own opinion of — and
 * asked only about quality. It cannot report a missing header, because the checklist already
 * knows whether there is one, and a model contradicting a measurement is a model to be ignored.
 *
 * The prompt and the parsing live here, away from the network call, for the reason everything in
 * this package does: they can be tested. A model's output is unpredictable; the code receiving it
 * must not be.
 */

export const CRITIQUE_SYSTEM = `You are looking at one page of a small business's website, on behalf of someone deciding whether to phone them and offer to rebuild it.

You will be given what was measured on the page: its regions, its headings, the words on its buttons, and the checklist rules it passed and failed. You may also be given a screenshot.

Your job is the part measurement cannot do: judge whether the page WORKS, not whether things exist.

Answer three things:
1. What this page is trying to get the visitor to do, and whether a stranger would understand that in five seconds.
2. The single most useful thing to say about its quality that the measurements do not already say. Wording, clarity, ordering, emphasis — the judgement calls.
3. One sentence you would actually say out loud to the owner on the phone, in plain words.

Hard rules:
- Use ONLY what you are given. Never state a fact about the page that is not in the measurements.
- Your answer to 2 must NOT be about whether something is present or absent. Every presence and absence in the list above has already been counted, and repeating one back is the one answer with no value. Judge what is there: do the words work, is the order right, does the emphasis sit on the thing that matters, would this persuade anyone.
- Never contradict a measurement. If the measurements say there is a header, there is a header.
- For 3, no jargon. Never say "SEO", "search engine", "hierarchy", "user experience", or "conversion" — the person on the other end runs a print shop, not a marketing team. If the best you can manage is a failed check reworded, return an empty string instead. An empty answer is honest; a restatement wastes the call.
- If the measurements are too thin to judge, say so plainly. "There is not enough here to tell" is a correct and useful answer.
- No greeting, no sign-off, no bullet points. Plain sentences, British English, at most 90 words in total.

Reply with JSON only:
{
  "purpose": "one sentence: what the page asks the visitor to do, and whether that is obvious",
  "judgement": "one or two sentences: the quality point the measurements miss",
  "openWith": "one sentence in plain speech, or empty string if nothing here is worth opening with"
}`;

export interface CritiqueInput {
  businessName: string;
  pageType: PageType;
  url: string;
  structure: PageStructure | null;
  results: ChecklistResult[];
}

export interface PageCritique {
  purpose: string;
  judgement: string;
  openWith: string;
}

/**
 * Why this page cannot usefully be judged, or null when it can.
 *
 * Checked before spending anything. A page with no structure and no checklist results gives the
 * model a URL and a page type, and what comes back from that is invention dressed as analysis.
 */
export function cannotCritique(input: CritiqueInput): string | null {
  if (input.structure === null) {
    return "This page did not render, so there is nothing measured to judge.";
  }
  if (input.results.length === 0) {
    return "No checklist rule applies to this page, so there is nothing for a critique to add to.";
  }
  return null;
}

export function buildCritiquePrompt(input: CritiqueInput): string {
  const s = input.structure;
  const parts: string[] = [
    `Business: ${input.businessName}`,
    `Page: ${input.pageType} — ${input.url}`,
  ];

  if (s) {
    parts.push(
      "\nWhat was measured on this page:",
      `- Main heading: ${s.hero.h1 ? `"${s.hero.h1}"` : "none"}${s.hero.h1Count > 1 ? ` (there are ${s.hero.h1Count})` : ""}`,
      `- Sentence under it: ${s.hero.subheading ? `"${s.hero.subheading}"` : "none"}`,
      `- Header: ${s.header.present ? `${s.header.navLinks} links, phone ${s.header.phone ? "present" : "absent"}` : "none found"}`,
      // The words on the buttons are the single most useful thing here: they are what the model can
      // judge and the checklist cannot.
      `- Buttons and links asking for action: ${s.ctas.length > 0 ? s.ctas.map((c) => `"${c.text}" (in the ${c.region})`).join(", ") : "none"}`,
      `- Forms: ${s.forms.count === 0 ? "none" : `${s.forms.count}, ${s.forms.fields} fields, message box ${s.forms.hasMessageBox ? "yes" : "no"}`}`,
      `- Reviews on the page: ${s.reviews.present ? `${s.reviews.count}, ${s.reviews.named} with a name` : "none"}`,
      `- Footer: ${s.footer.present ? `address ${s.footer.hasAddress ? "yes" : "no"}, hours ${s.footer.hasHours ? "yes" : "no"}, copyright ${s.footer.copyrightYear ?? "not stated"}` : "none found"}`,
    );
  }

  const failed = input.results.filter((r) => r.outcome === "failed");
  const passed = input.results.filter((r) => r.outcome === "passed");

  parts.push(
    `\nChecks it FAILED (${failed.length}) — the operator can already see these, so do not repeat them:`,
    failed.length > 0 ? failed.map((r) => `- ${r.rule.says}`).join("\n") : "- none",
    `\nChecks it PASSED (${passed.length}): ${passed.length > 0 ? passed.map((r) => r.rule.name).join(", ") : "none"}`,
  );

  const unknown = input.results.filter((r) => r.outcome === "unknown");
  if (unknown.length > 0) {
    // Named so the model does not treat an unmeasured thing as an absent one — the same distinction
    // the rest of the system keeps.
    parts.push(
      `\nCould not be checked (${unknown.length}): ${unknown.map((r) => r.rule.name).join(", ")}. Do not treat these as faults; nobody measured them.`,
    );
  }

  return parts.join("\n");
}

/** Reads the answer, refusing anything that is not a usable critique. */
export function parseCritique(value: unknown): { ok: true; critique: PageCritique } | { ok: false; detail: string } {
  if (typeof value !== "object" || value === null) {
    return { ok: false, detail: "The model did not return an object." };
  }
  const raw = value as Record<string, unknown>;
  const purpose = text(raw.purpose);
  const judgement = text(raw.judgement);

  // Both halves are the point. A critique with a purpose and no judgement has restated the page
  // back to the operator, which is the one thing they did not need.
  if (purpose.length < 15 || judgement.length < 15) {
    return { ok: false, detail: "The model's answer was too thin to be a judgement." };
  }

  return { ok: true, critique: { purpose, judgement, openWith: text(raw.openWith) } };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
