"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/viewer";

/**
 * Sets what one member may spend.
 *
 * Guarded twice: `requireAdmin` here, and `member_budgets`' own row-level policies, which only let
 * an administrator write the table at all. The first gives a member who somehow posted this form a
 * sentence instead of a stack trace; the second is what makes it true for a request that never
 * goes through this app.
 *
 * Dollars in, cents out. The form asks for dollars because that is how somebody thinks about an
 * allowance; everything inside this product counts in cents, because the prices are fractions of
 * one and rounding to dollars would make a third of a cent free.
 */
export async function setBudget(formData: FormData): Promise<void> {
  const admin = await requireAdmin("/spend");

  const userId = String(formData.get("user_id") ?? "").trim();
  const dollars = Number(formData.get("dollars") ?? 0);
  const period = String(formData.get("period") ?? "monthly");

  if (!userId) return;
  if (!Number.isFinite(dollars) || dollars < 0) return;
  if (period !== "once" && period !== "weekly" && period !== "monthly") return;

  const supabase = await createClient();

  await supabase.from("member_budgets").upsert(
    {
      user_id: userId,
      amount_cents: Math.round(dollars * 100),
      period,
      // `starts_at` only matters for a one-off allowance, where it is the day it was granted.
      // A weekly or monthly window is worked out from the calendar, not from this.
      starts_at: new Date().toISOString(),
      created_by: admin.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  revalidatePath("/spend");
}
