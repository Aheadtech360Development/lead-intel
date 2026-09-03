import type { createClient } from "@/lib/supabase/server";

/**
 * Which businesses an Instagram lookup would apply to.
 *
 * **One definition, called from both sides.** The Instagram screen uses it to label a button
 * ("get Instagram for the 162 that have never been looked up") and the confirm screen uses it to
 * decide what to price. Those two numbers have to be the same number, and the only reliable way to
 * make them the same is to ask the same function.
 *
 * This is not a hypothetical worry. Twice already in this codebase a screen and the thing behind it
 * disagreed about what "shown" meant while money was on the line: the CSV export filtered on
 * `gated=true`, a parameter the list has never sent, so every download quietly ignored the on-screen
 * filter; and the enrich screen ignored `f_from`, so a button reading "get paid data for all 121
 * shown" would have priced and bought for all 330. Both were two implementations of one idea.
 */

export interface InstagramScope {
  /** Restrict to businesses found by search, or to imported ones. Undefined means both. */
  from?: string | undefined;
  /** Restrict to one imported file. */
  batch?: string | undefined;
  /**
   * Drop the ones already looked up.
   *
   * Almost always what is wanted — buying a profile twice costs money to learn nothing. The ledger
   * refuses the duplicate purchase anyway, but a button offering to buy 162 when 40 of them are
   * already paid for is telling the operator something untrue before the ledger ever sees it.
   */
  onlyMissing: boolean;
}

/**
 * Businesses with an Instagram link, in scope, as ids.
 *
 * Having a link is the prerequisite: the lookup takes a handle, so a business whose website never
 * mentioned Instagram has nothing to look up and is not a candidate at any price. That is the same
 * rule `apps/jobs/src/enrich.ts` applies as a per-source prerequisite, stated here so the operator
 * sees the smaller number before spending rather than a refusal afterwards.
 */
export async function instagramCandidateIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scope: InstagramScope,
): Promise<string[]> {
  let businessQuery = supabase.from("businesses").select("id").eq("status", "active");
  if (scope.from) businessQuery = businessQuery.eq("origin", scope.from);
  if (scope.batch) businessQuery = businessQuery.eq("import_batch_id", scope.batch);

  const [{ data: inScope }, { data: linked }, { data: known }] = await Promise.all([
    businessQuery.limit(20000),
    supabase.from("field_metadata").select("business_id").eq("field_name", "instagram_url").limit(50000),
    // "Looked up" is the presence of a follower count, not a successful ledger row. A profile that
    // was bought and came back private has no follower count and should not be bought again — but
    // that is the ledger's job to refuse, and it does. Keying on the field keeps this function
    // about what is known rather than about what was paid for.
    supabase.from("field_metadata").select("business_id").eq("field_name", "instagram_followers").limit(50000),
  ]);

  const hasLink = new Set((linked ?? []).map((r) => r.business_id));
  const alreadyKnown = new Set((known ?? []).map((r) => r.business_id));

  return (inScope ?? [])
    .map((b) => b.id as string)
    .filter((id) => hasLink.has(id))
    .filter((id) => !scope.onlyMissing || !alreadyKnown.has(id));
}
