import {
  runChecklist,
  type PageCritique,
  type ChecklistResult,
  type ChecklistRule,
  type PageStructure,
  type PageType,
} from "@lead-intel/core";
import type { createClient } from "@/lib/supabase/server";

/**
 * The audited pages of one business, judged against the operator's current checklists.
 *
 * **Computed on read, never stored.** A stored verdict is a verdict from whenever the rules last
 * happened to run: edit a rule and every record silently disagrees with the editor until something
 * re-runs. Running the checklist here costs a few milliseconds over facts that are already in
 * memory, and the answer is always the one the current rules give.
 *
 * The page structure *is* stored, because producing it needs a browser. That is the split: measure
 * once, judge every time.
 */

/** Kept in step with SCREENSHOT_TYPES in apps/jobs/src/audit-site.ts, which decides what to store. */
const SCREENSHOT_TYPES = new Set(["home", "products"]);

export interface PageScorecard {
  url: string;
  pageType: PageType;
  typeConfidence: string;
  typeBecause: string | null;
  outcome: string;
  detail: string | null;
  structure: PageStructure | null;
  layout: Record<string, unknown> | null;
  results: ChecklistResult[];
  /** What the model judged, or null. Never both null with `critiqueDetail`. */
  critique: PageCritique | null;
  critiqueDetail: string | null;
  /** A link the browser can load for a while, or null when there is no picture. */
  screenshotUrl: string | null;
  /**
   * True when this is a page a screenshot was *meant* to be kept for.
   *
   * Home and product pages only - the rest are shown to the model and discarded on purpose. Without
   * this the screen cannot tell "we never wanted a picture of this page" apart from "we wanted one
   * and could not store it", and the operator is left looking for something that was never coming.
   */
  screenshotExpected: boolean;
  /** Out of 100, or null when too little was measured to say anything. */
  score: number | null;
  failed: number;
  passed: number;
  unknown: number;
}

export async function loadScorecards(
  supabase: Awaited<ReturnType<typeof createClient>>,
  businessId: string,
  category: string | null,
): Promise<PageScorecard[]> {
  const [{ data: audits }, { data: rules }] = await Promise.all([
    supabase
      .from("page_audits")
      .select(
        "url, page_type, type_confidence, type_because, outcome, detail, structure, layout, screenshot_path, critique, critique_detail",
      )
      .eq("business_id", businessId)
      .order("rendered_at"),
    supabase.from("page_checklists").select("*").eq("enabled", true),
  ]);

  const checklist: ChecklistRule[] = (rules ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    pageType: r.page_type,
    category: r.category,
    field: r.field,
    test: r.test,
    value: r.value,
    weight: r.weight,
    enabled: r.enabled,
    says: r.says,
  }));

  /**
   * Signed links, in parallel, and never stored.
   *
   * The bucket is private — a screenshot of a stranger's website sitting on a public URL is not
   * something to leave lying around. A signed link is minted when a record is opened and expires an
   * hour later, so a link that leaks stops working on its own. Storing them would defeat that
   * entirely and would also break: they expire, the paths do not.
   */
  return await Promise.all(
    (audits ?? []).map(async (audit) => {
    const structure = (audit.structure ?? null) as PageStructure | null;
    const layout = (audit.layout ?? null) as Record<string, unknown> | null;

    const results = runChecklist(checklist, {
      pageType: audit.page_type as PageType,
      category,
      structure,
      layout,
    });

    const failed = results.filter((r) => r.outcome === "failed");
    const passed = results.filter((r) => r.outcome === "passed");
    const unknown = results.filter((r) => r.outcome === "unknown");

    /**
     * Scored on what was actually judged, not on every rule that exists.
     *
     * A rule that could not be evaluated is left out of both halves of the fraction. Counting an
     * unknown as a failure would score a page down for a measurement nobody took; counting it as a
     * pass would score it up for the same reason. Neither is a fact about the page.
     */
    const judged = [...failed, ...passed];
    const possible = judged.reduce((sum, r) => sum + r.rule.weight, 0);
    const lost = failed.reduce((sum, r) => sum + r.rule.weight, 0);

    const screenshotUrl = audit.screenshot_path
      ? ((await supabase.storage.from("page-screenshots").createSignedUrl(audit.screenshot_path, 3600)).data
          ?.signedUrl ?? null)
      : null;

    return {
      url: audit.url,
      pageType: audit.page_type as PageType,
      typeConfidence: audit.type_confidence,
      typeBecause: audit.type_because,
      outcome: audit.outcome,
      detail: audit.detail,
      structure,
      layout,
      results,
      // Null rather than 100 when nothing could be judged — an unread page is not a perfect one.
      score: possible > 0 ? Math.round(((possible - lost) / possible) * 100) : null,
      failed: failed.length,
      passed: passed.length,
      unknown: unknown.length,
      screenshotExpected: SCREENSHOT_TYPES.has(audit.page_type),
      critique: (audit.critique ?? null) as PageCritique | null,
      critiqueDetail: audit.critique_detail ?? null,
      screenshotUrl,
    };
    }),
  );
}
