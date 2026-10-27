import { createClient } from "@/lib/supabase/server";
import { money, PERIOD_WORDS, windowStart, type BudgetPeriod } from "@/lib/budget";
import { PANEL, SectionHeading, TD, Th } from "../ui";
import { setBudget } from "./actions";

/**
 * Who may spend what — the administrator's half of the budget.
 *
 * It lives on the spend screen rather than on a people screen because that is the question it
 * answers: an administrator looking at what the team costs is one row away from deciding what each
 * person may cost. There is no people screen yet either, and inventing one to hold a single form
 * would be the wrong shape.
 *
 * Only rendered for an administrator, and the write is refused server-side as well — the form
 * being absent is a convenience, not the control.
 */
export async function TeamBudgets() {
  const supabase = await createClient();

  const [{ data: roles }, { data: budgets }, { data: jobs }] = await Promise.all([
    supabase.from("user_roles").select("user_id, role").order("role"),
    supabase.from("member_budgets").select("user_id, amount_cents, period, starts_at, note"),
    supabase.from("job_runs").select("created_by, cost_cents, started_at").limit(20000),
  ]);

  const byUser = new Map((budgets ?? []).map((b) => [b.user_id as string, b]));

  const members = (roles ?? []).filter((r) => r.role !== "admin");

  const spentFor = (userId: string, period: BudgetPeriod, startsAt: Date) => {
    const from = windowStart(period, startsAt);
    return (jobs ?? [])
      .filter((j) => j.created_by === userId && new Date(j.started_at as string) >= from)
      .reduce((sum, j) => sum + Number(j.cost_cents ?? 0), 0);
  };

  return (
    <>
      <SectionHeading
        title="What each person may spend"
        hint="A member may buy paid data up to the amount you set here, and not a cent past it. Spend is counted from the tasks they start."
      />
      <div style={{ ...PANEL, marginBottom: 18 }}>
        {members.length === 0 ? (
          <p style={{ margin: 0, padding: "16px 18px", fontSize: 14.5, color: "var(--ink-2)" }}>
            There are no members yet — only you. A member is an account with a row in{" "}
            <code>user_roles</code> saying <code>member</code>; nothing in this product can grant
            itself the role.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14.5 }}>
            <thead>
              <tr>
                <Th label="Person" />
                <Th label="Allowance" width={150} />
                <Th label="Resets" width={150} />
                <Th label="Spent this window" width={160} />
                <Th label="" width={240} />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => {
                const userId = m.user_id as string;
                const row = byUser.get(userId);
                const period = (row?.period as BudgetPeriod) ?? "monthly";
                const startsAt = row?.starts_at ? new Date(row.starts_at as string) : new Date();
                const amount = Number(row?.amount_cents ?? 0);
                const spent = spentFor(userId, period, startsAt);
                return (
                  <tr key={userId}>
                    <td style={TD}>
                      <code style={{ fontSize: 13 }}>{userId.slice(0, 8)}…</code>
                      <div style={{ fontSize: 13, color: "var(--ink-2)" }}>member</div>
                    </td>
                    <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>
                      {row ? money(amount) : <span style={{ color: "var(--warn-ink)" }}>none set</span>}
                    </td>
                    <td style={{ ...TD, fontSize: 13.5, color: "var(--ink-2)" }}>{row ? PERIOD_WORDS[period] : "—"}</td>
                    <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>
                      {money(spent)}
                      {row && amount > 0 ? (
                        <span style={{ fontSize: 13, color: "var(--ink-2)" }}> of {money(amount)}</span>
                      ) : null}
                    </td>
                    <td style={TD}>
                      <form action={setBudget} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        <input type="hidden" name="user_id" value={userId} />
                        <label style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
                          $
                          <input
                            name="dollars"
                            type="number"
                            step="0.01"
                            min="0"
                            defaultValue={(amount / 100).toFixed(2)}
                            style={{ width: 86, marginLeft: 4 }}
                            aria-label="Allowance in dollars"
                          />
                        </label>
                        <select name="period" defaultValue={period} aria-label="How often it resets">
                          <option value="monthly">monthly</option>
                          <option value="weekly">weekly</option>
                          <option value="once">once</option>
                        </select>
                        <button className="btn-2 btn" type="submit" style={{ fontSize: 14 }}>
                          Save
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p style={{ margin: 0, padding: "12px 18px", borderTop: "1px solid var(--line)", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
          An allowance of <strong>nothing</strong> is not the same as no allowance: zero means they may buy nothing,
          and no row means nobody has decided yet. Both refuse a purchase, and both say which it is on the member&rsquo;s
          own screen.
        </p>
      </div>
    </>
  );
}
