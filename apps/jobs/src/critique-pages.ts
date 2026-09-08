import {
  buildCritiquePrompt,
  cannotCritique,
  CRITIQUE_SYSTEM,
  parseCritique,
  runChecklist,
  type ChecklistRule,
  type PageStructure,
  type PageType,
} from "@lead-intel/core";
import { businesses, pageAudits, pageChecklists, type Database } from "@lead-intel/db";
import { callGemini, DEFAULT_GEMINI_MODEL, isFatal, parseJsonAnswer } from "@lead-intel/providers";
import { eq } from "drizzle-orm";
import { recordProviderCall } from "./provider-calls.js";

/**
 * Asking the model what the measurements could not answer, for every page of one site.
 *
 * Runs after the browser, never instead of it. The model is handed what was measured — the
 * headings, the button words, the rules that passed and failed — and asked only about quality. It
 * never sees the raw page, so it cannot form an opinion about something nobody measured, and the
 * prompt forbids it from repeating a failed check back as its own finding.
 *
 * **The checklist is run here too, and that is deliberate duplication.** The web app computes the
 * same verdicts on read, because rules change and a stored verdict goes stale. But a critique is
 * only as good as what it was given, so the model must be shown the verdicts as they stood at the
 * moment it was asked. Both callers use the same `runChecklist`, so they cannot drift.
 */

/** Gemini 2.5 Flash, per million tokens, in US dollars. */
const INPUT_PER_MILLION = 0.3;
const OUTPUT_PER_MILLION = 2.5;

/** Grows with each consecutive refusal: 20s, then 40s. A per-minute window clears inside that. */
const RATE_LIMIT_WAIT_MS = 20_000;

export interface CritiqueSummary {
  businessId: string;
  critiqued: number;
  skipped: number;
  failed: number;
  costCents: number;
  /** Set when the whole pass stopped early, with the reason. */
  stopped: string | null;
}

export async function critiquePages(db: Database, businessId: string): Promise<CritiqueSummary> {
  const summary: CritiqueSummary = {
    businessId,
    critiqued: 0,
    skipped: 0,
    failed: 0,
    costCents: 0,
    stopped: null,
  };

  const [business] = await db
    .select({ displayName: businesses.displayName, category: businesses.category })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) throw new Error(`business ${businessId} not found`);

  const audits = await db
    .select({
      id: pageAudits.id,
      url: pageAudits.url,
      pageType: pageAudits.pageType,
      structure: pageAudits.structure,
      layout: pageAudits.layout,
    })
    .from(pageAudits)
    .where(eq(pageAudits.businessId, businessId));

  if (audits.length === 0) {
    return { ...summary, stopped: "This business has no audited pages yet." };
  }

  const rules = await db.select().from(pageChecklists).where(eq(pageChecklists.enabled, true));
  const checklist: ChecklistRule[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    pageType: r.pageType as ChecklistRule["pageType"],
    category: r.category,
    field: r.field as ChecklistRule["field"],
    test: r.test as ChecklistRule["test"],
    value: r.value,
    weight: r.weight,
    enabled: r.enabled,
    says: r.says,
  }));

  // Consecutive, not cumulative: one 429 in the middle of an otherwise healthy pass is a blip and
  // the counter resets on the next success.
  let rateLimitedInARow = 0;

  for (const audit of audits) {
    const structure = (audit.structure ?? null) as PageStructure | null;
    const results = runChecklist(checklist, {
      pageType: audit.pageType as PageType,
      category: business.category ?? null,
      structure,
      layout: (audit.layout ?? null) as Record<string, unknown> | null,
    });

    const input = {
      businessName: business.displayName,
      pageType: audit.pageType as PageType,
      url: audit.url,
      structure,
      results,
    };

    // Checked before a single token is spent. A page with no structure gives the model a URL and a
    // page type, and what comes back from that is invention dressed as analysis.
    const refusal = cannotCritique(input);
    if (refusal) {
      await store(db, audit.id, { critique: null, detail: refusal });
      summary.skipped += 1;
      continue;
    }

    const result = await callGemini({
      apiKey: process.env.GEMINI_API_KEY,
      system: CRITIQUE_SYSTEM,
      user: buildCritiquePrompt(input),
      json: true,
      // Ninety words of prose plus the JSON around it. Generous rather than tight, because a
      // truncated answer costs the same as a complete one and is worth nothing.
      maxOutputTokens: 1200,
    });

    if (!result.ok) {
      await store(db, audit.id, {
        critique: null,
        detail: `The model could not be asked about this page: ${result.detail}`,
      });
      summary.failed += 1;

      /**
       * A bad key stops the pass; a bad page does not.
       *
       * The same distinction the Apify and Gemini adapters already draw. Without it, a site with
       * eight pages and an expired key makes eight identical failing requests, and a whole batch
       * makes thousands — slow, noisy, and a good way to get an account rate-limited for the
       * trouble.
       */
      if (isFatal(result.reason)) {
        return { ...summary, stopped: `Stopped after the first page: ${result.detail}` };
      }

      /**
       * A rate limit is waited out, not walked past.
       *
       * Gemini's free tier limits requests per minute, and a page-by-page audit of a whole list
       * fires roughly eight requests per site in a burst. Measured here: two audits of one site run
       * back to back, and four of seven pages came back 429 and were recorded as unjudgeable — the
       * feature quietly degrading to nothing at exactly the scale it is meant for.
       *
       * Waiting costs seconds. Giving up costs the judgement the audit exists to produce. After
       * three in a row the limit is not a blip and the rest of the pass would fail the same way, so
       * it stops and says so rather than grinding through several hundred more.
       */
      if (result.reason === "rate_limited") {
        rateLimitedInARow += 1;
        if (rateLimitedInARow >= 3) {
          return {
            ...summary,
            stopped:
              "Gemini is rate-limiting us, so the remaining pages were left unjudged. Everything " +
              "measured on them is unaffected. Run this again in a few minutes.",
          };
        }
        await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WAIT_MS * rateLimitedInARow));
      }
      continue;
    }

    const cents =
      ((result.inputTokens / 1_000_000) * INPUT_PER_MILLION +
        (result.outputTokens / 1_000_000) * OUTPUT_PER_MILLION) *
      100;
    summary.costCents += cents;

    // Written to the ledger per page, so the cost of this feature is a fact in the database rather
    // than an estimate in a document. Everything else that spends money in this product is
    // auditable that way; a model call is not an exception.
    await recordProviderCall(db, {
      businessId,
      provider: "gemini",
      // One endpoint name, so the spend screen groups these into a single readable row rather than
      // one per page. The page and the moment go in the idempotency key instead — see `unique`.
      endpoint: "critique-page",
      costCents: cents,
      status: "succeeded",
      // Every call is a real, separate charge: several pages per business, and paid again on a
      // re-audit. Without this the ledger records one of them and hides the rest.
      unique: `${audit.id}:${Date.now()}`,
    });

    const json = parseJsonAnswer<unknown>(result);
    if (!json.ok) {
      await store(db, audit.id, { critique: null, detail: `The model's answer could not be read: ${json.detail}` });
      summary.failed += 1;
      continue;
    }

    const parsed = parseCritique(json.value);
    if (!parsed.ok) {
      await store(db, audit.id, { critique: null, detail: parsed.detail });
      summary.failed += 1;
      continue;
    }

    await store(db, audit.id, { critique: parsed.critique, detail: null });
    summary.critiqued += 1;
    rateLimitedInARow = 0;
  }

  return summary;
}

/**
 * One of the two is always set.
 *
 * A page with neither a critique nor a reason is a blank space on the screen, and a blank space is
 * indistinguishable from a feature that quietly broke.
 */
async function store(
  db: Database,
  auditId: string,
  value: { critique: unknown; detail: string | null },
): Promise<void> {
  await db
    .update(pageAudits)
    .set({
      critique: value.critique,
      critiqueDetail: value.detail,
      critiqueModel: process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
      critiqueAt: new Date(),
    })
    .where(eq(pageAudits.id, auditId));
}
