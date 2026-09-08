import { providerCalls, type Database } from "@lead-intel/db";
import { eq } from "drizzle-orm";

/**
 * Writes the cost ledger entry for one paid call, **before** the call is made.
 *
 * The order is the whole point, and it was learned the expensive way: the first version of the
 * listing lookup wrote its entry *after* the call, with `onConflictDoNothing`. A crash between the
 * request and the write left no record, and the next run paid the provider again for data already
 * on the record. Reserving the row first means a re-run finds it and stops.
 *
 * Returns `"already_bought"` when this exact purchase is already recorded as succeeded, so the
 * caller can return without spending. Every other outcome is written back afterwards by calling
 * this again with a `status`.
 */
export async function recordProviderCall(
  db: Database,
  params: {
    businessId: string;
    provider: string;
    endpoint: string;
    /** Cents, fractional. The column is numeric(12,4) precisely so 0.26 is not stored as zero. */
    costCents: number;
    status?: "succeeded" | "failed";
    /**
     * Why it failed. `provider_calls` has no column for free text — `error_code` is an enum of
     * known codes — so this is accepted and deliberately not stored rather than silently dropped
     * into a field that would distort it. The failure detail lives on the business's own record,
     * where an operator will actually look for it.
     */
    detail?: string | null;
    /**
     * Makes this call its own entry rather than one that can be recognised again later.
     *
     * Idempotency is right for a *purchase*: buying a business's Google listing twice should not
     * happen, and the key is what prevents it. It is wrong for a cost that is genuinely incurred
     * again each time, and the page critique is one — re-auditing a site really does pay the model
     * again, and there are several pages per business.
     *
     * Two things went wrong without this. Both product pages of one site shared the key
     * `critique-page:products:<business>`, so the second page's cost overwrote the first instead of
     * adding to it; and every re-audit overwrote the lot. The ledger, whose whole purpose is that
     * the spend figure is counted rather than estimated, was quietly under-reporting.
     */
    unique?: string;
  },
): Promise<"reserved" | "already_bought" | "updated"> {
  const idempotencyKey = params.unique
    ? `${params.endpoint}:${params.businessId}:${params.unique}`
    : `${params.endpoint}:${params.businessId}`;

  const [existing] = await db
    .select({ status: providerCalls.status })
    .from(providerCalls)
    .where(eq(providerCalls.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existing?.status === "succeeded" && params.status === undefined) {
    return "already_bought";
  }

  await db
    .insert(providerCalls)
    .values({
      idempotencyKey,
      businessId: params.businessId,
      provider: params.provider,
      endpoint: params.endpoint,
      status: params.status ?? "succeeded",
      // Drizzle's numeric column takes a string, so the value survives the round trip exactly
      // rather than passing through a float on the way.
      costCents: String(params.costCents),
      calledAt: new Date(),
    })
    .onConflictDoUpdate({
      target: providerCalls.idempotencyKey,
      set: {
        status: params.status ?? "succeeded",
        costCents: String(params.costCents),
        calledAt: new Date(),
      },
    });

  return params.status === undefined ? "reserved" : "updated";
}
