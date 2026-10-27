import { createClient } from "@/lib/supabase/server";
import type { Viewer } from "@/lib/viewer";

/**
 * What a person may spend, what they have spent, and what is left.
 *
 * The product's position on money has not changed: nothing is ever bought without a screen that
 * states the price first. A budget is the second half of that — the administrator decides how much
 * a member may spend at all, and a purchase that would go past it is refused **before** anything is
 * bought, not apologised for afterwards.
 *
 * **Where the spent figure comes from, and why.** `provider_calls` is the authoritative ledger and
 * has no owner column: the worker writes it, and the worker runs as the service role with no user
 * session. The number already exists one level up — a task carries what it cost as it runs, and a
 * task knows who started it. So a person's spend is the sum of their own tasks. Every paid call
 * this product makes happens inside a task, so the two agree; the administrator's company-wide
 * total still comes from the ledger itself.
 */

export type BudgetPeriod = "once" | "weekly" | "monthly";

export type Budget = {
  /** What they may spend in this window. Zero means no allowance has been set. */
  amountCents: number;
  period: BudgetPeriod;
  /** When the current window began. */
  windowStart: Date;
  spentCents: number;
  leftCents: number;
  /** No row at all — nobody has decided what this person may spend. */
  unset: boolean;
  note: string | null;
};

/** Where the current window begins, for each kind of allowance. */
export function windowStart(period: BudgetPeriod, startsAt: Date, now = new Date()): Date {
  if (period === "once") return startsAt;
  if (period === "monthly") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  // Weekly: back to Monday, in UTC, so the window does not move with the reader's timezone.
  const day = now.getUTCDay(); // 0 = Sunday
  const since = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - since));
  return monday;
}

export const PERIOD_WORDS: Record<BudgetPeriod, string> = {
  once: "one allowance, not refilled",
  weekly: "every Monday",
  monthly: "the 1st of each month",
};

/**
 * The budget for one person.
 *
 * An administrator has none — they set them. `null` means "this viewer is not budgeted", which is
 * different from a member whose allowance is zero.
 */
export async function budgetFor(viewer: Viewer): Promise<Budget | null> {
  if (viewer.isAdmin) return null;

  const supabase = await createClient();
  const { data: row } = await supabase
    .from("member_budgets")
    .select("amount_cents, period, starts_at, note")
    .eq("user_id", viewer.id)
    .maybeSingle();

  const period = (row?.period as BudgetPeriod) ?? "monthly";
  const startsAt = row?.starts_at ? new Date(row.starts_at as string) : new Date();
  const from = windowStart(period, startsAt);

  const { data: jobs } = await supabase
    .from("job_runs")
    .select("cost_cents")
    .eq("created_by", viewer.id)
    .gte("started_at", from.toISOString())
    .limit(5000);

  // numeric(12,4) arrives as a string from PostgREST; adding it directly would concatenate.
  const spentCents = (jobs ?? []).reduce((sum, j) => sum + Number(j.cost_cents ?? 0), 0);
  const amountCents = Number(row?.amount_cents ?? 0);

  return {
    amountCents,
    period,
    windowStart: from,
    spentCents,
    leftCents: Math.max(0, amountCents - spentCents),
    unset: !row,
    note: (row?.note as string | null) ?? null,
  };
}

/**
 * Whether a purchase may go ahead, and what to say if it may not.
 *
 * Deliberately returns the words as well as the verdict: the two screens that ask this question
 * should give the same answer in the same sentence, and a boolean would let them drift.
 */
export function canAfford(budget: Budget | null, costCents: number): { ok: true } | { ok: false; why: string } {
  if (!budget) return { ok: true };

  /**
   * Two refusals, not one.
   *
   * No row means nobody has decided what this person may spend; an allowance of zero means
   * somebody decided it is nothing. They lead to the same place and they are not the same
   * sentence, and a member can only act on the difference if the screen states it.
   */
  if (budget.unset) {
    return {
      ok: false,
      why: "Nobody has set you a spending allowance yet, so paid data cannot be bought from this account. Ask the administrator — it takes them a moment, and it is the only thing standing in the way.",
    };
  }

  if (budget.amountCents === 0) {
    return {
      ok: false,
      why: "Your allowance is set to nothing, so paid data cannot be bought from this account. Everything free still works. If that is not intended, the administrator can change it in a moment.",
    };
  }

  if (costCents > budget.leftCents) {
    return {
      ok: false,
      why: `This would cost ${money(costCents)} and you have ${money(budget.leftCents)} left. Nothing was bought and nothing was started — the check happens before the purchase, not after it.`,
    };
  }

  return { ok: true };
}

/** Cents, in the product's own style: sub-cent amounts stay in cents because a third of a cent is not free. */
export function money(cents: number): string {
  if (cents >= 100) return `$${(cents / 100).toFixed(2)}`;
  if (cents === 0) return "nothing";
  return `${cents.toFixed(cents < 1 ? 2 : 1)}¢`;
}
