import {
  GATE_PROBLEM_SCORE,
  PRESENCE_OVERRIDE_PROBLEM_SCORE,
  TIER_INTENT_THRESHOLD,
  TIER_PROBLEM_THRESHOLD,
} from "@lead-intel/shared";
import { DEFAULT_DEMAND_THRESHOLDS } from "@lead-intel/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer, leadScope } from "@/lib/viewer";
import { signOut } from "../actions";
import { AppShell, Badge, InfoBox, Panel, TD, Th, TierBadge, TIER_MEANING } from "../ui";

/**
 * How a lead ends up Priority 1, 2, 3 or 4 — read-only, for the person being sorted by it.
 *
 * A member's day is ordered by these rules and there was no screen that said what they are. The
 * numbers are read from the same constants the scorer uses (`TIER_PROBLEM_THRESHOLD`,
 * `TIER_INTENT_THRESHOLD`, `GATE_PROBLEM_SCORE`, the demand thresholds), so this page cannot
 * quietly disagree with the product it describes.
 *
 * **Read-only on purpose.** Under the agreed model a member reads the rules and the administrator
 * writes them, so there is nothing to edit here for anybody — the ordered, admin-written rule list
 * is specified and not built (`specs/multi-user/spec.md` §7), and this page says so rather than
 * drawing a builder that does nothing.
 */
export default async function PriorityRulesPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const supabase = await createClient();
  const scope = leadScope(viewer);

  let query = supabase.from("businesses").select("id, tier").eq("status", "active").limit(20000);
  if (scope) query = query.eq(scope.column, scope.value);
  const { data: rows } = await query;

  const counts = new Map<number | null, number>();
  for (const row of rows ?? []) {
    const tier = (row.tier as number | null) ?? null;
    counts.set(tier, (counts.get(tier) ?? 0) + 1);
  }
  const count = (tier: number | null) => counts.get(tier) ?? 0;
  const whose = viewer.isAdmin ? "" : " of yours";

  const cell = (tier: 1 | 2 | 3 | 4, heading: string) => (
    <td style={{ ...TD, verticalAlign: "top" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
        <TierBadge tier={tier} />
        <b style={{ color: "var(--ink)", fontSize: 13.5 }}>{heading}</b>
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{TIER_MEANING[tier]}</div>
      <Link href={`/records?tier=${tier}&view=everything`} style={{ fontSize: 12.5, display: "inline-block", marginTop: 6 }}>
        {count(tier)}
        {whose} →
      </Link>
    </td>
  );

  return (
    <AppShell
      current="prules"
      email={viewer.email}
      signOutAction={signOut}
      title="Priority rules"
      what="How a lead ends up Priority 1, 2, 3 or 4. Nobody types a priority in — it is worked out from the two scores every time a business is re-scored."
    >
      <>
        <InfoBox title="You can read these, not change them" tone="info">
          {viewer.isAdmin
            ? "These are the rules as the product runs them today. The ordered, written-by-hand rule list is specified and not built yet."
            : "The administrator sets these for the whole team, so one lead means the same thing to everybody. If a rule is wrong for the leads you are working, that is worth saying — it is a small change at their end."}
        </InfoBox>

        <Panel
          title="What is live today"
          hint={`Two numbers decide it: how much is wrong (Problem) and whether they already spend money (Signals). The line is ${TIER_PROBLEM_THRESHOLD} and ${TIER_INTENT_THRESHOLD}.`}
          right={<Badge tone="good">In use</Badge>}
        >
          <div style={{ overflowX: "auto" }}>
            <table className="data" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
              <thead>
                <tr>
                  <Th label="" width={190} />
                  <Th label={`Signals ${TIER_INTENT_THRESHOLD} or more`} explain="There is proof they already pay for things — a tracking pixel, recent work on the site, a paid tool, ads." />
                  <Th label={`Signals under ${TIER_INTENT_THRESHOLD}`} explain="Nothing we can see says they spend money on getting found." />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th style={{ ...TD, textAlign: "left", background: "var(--surface-2)", verticalAlign: "top" }}>
                    <b style={{ color: "var(--ink)", fontSize: 13.5 }}>Problem {TIER_PROBLEM_THRESHOLD} or more</b>
                    <div style={{ fontSize: 12, color: "var(--ink-2)" }}>a lot is wrong with them</div>
                  </th>
                  {cell(1, "Call these first")}
                  {cell(3, "Worth a call, harder sell")}
                </tr>
                <tr>
                  <th style={{ ...TD, textAlign: "left", background: "var(--surface-2)", verticalAlign: "top" }}>
                    <b style={{ color: "var(--ink)", fontSize: 13.5 }}>Problem under {TIER_PROBLEM_THRESHOLD}</b>
                    <div style={{ fontSize: 12, color: "var(--ink-2)" }}>little is wrong</div>
                  </th>
                  {cell(2, "Spends, little to fix")}
                  {cell(4, "Lowest")}
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ padding: "13px 16px", borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink-2)" }}>
            {count(null)}
            {whose} have no priority at all, because nothing has been analysed on them yet. That is not a fifth rank —
            it is the absence of one. <Link href="/records?view=unscored">See them</Link>.
          </div>
        </Panel>

        <Panel title="Two rules that beat the table" hint="Both are about having nowhere to send a customer, which outranks everything else.">
          <div style={{ padding: "14px 16px", display: "grid", gap: 14 }}>
            <div>
              <b style={{ color: "var(--ink)", fontSize: 13.5 }}>No website at all</b>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
                A business with no website, a dead one, or only a social page takes a Problem score of at least{" "}
                <b className="mono" style={{ color: "var(--ink)" }}>
                  {PRESENCE_OVERRIDE_PROBLEM_SCORE}
                </b>{" "}
                and is routed to web development — and that now includes a business whose Google listing carries no
                website link at all. Having nowhere to send a customer is the finding.
              </p>
            </div>
            <div>
              <b style={{ color: "var(--ink)", fontSize: 13.5 }}>Proven demand, unreadable site</b>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>
                A business whose site could not be read but which clearly has customers — at least{" "}
                <b className="mono" style={{ color: "var(--ink)" }}>
                  {DEFAULT_DEMAND_THRESHOLDS.minReviews}
                </b>{" "}
                reviews, a rating of{" "}
                <b className="mono" style={{ color: "var(--ink)" }}>
                  {DEFAULT_DEMAND_THRESHOLDS.minRating}
                </b>{" "}
                or better, or{" "}
                <b className="mono" style={{ color: "var(--ink)" }}>
                  {DEFAULT_DEMAND_THRESHOLDS.minFollowers.toLocaleString("en-GB")}
                </b>{" "}
                followers — is treated as Problem {PRESENCE_OVERRIDE_PROBLEM_SCORE}, Priority 1, and flagged for a
                person to look at. Chains are deliberately left out of this.
              </p>
            </div>
          </div>
        </Panel>

        <Panel
          title="What &ldquo;worth calling&rdquo; means"
          hint="The gate the leads list filters on, and the test for whether paid data is worth buying."
        >
          <p style={{ margin: 0, padding: "14px 16px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
            A Problem score of{" "}
            <b className="mono" style={{ color: "var(--ink)" }}>
              {GATE_PROBLEM_SCORE}
            </b>{" "}
            or more, and not a shared or chain domain. A franchise outlet with a head-office website is not a business
            that can buy a website from you, so it never passes however bad the site is.
          </p>
        </Panel>

        <Panel title="What is coming" hint="Agreed, specified and not built." right={<Badge tone="plain">Not built yet</Badge>}>
          <p style={{ margin: 0, padding: "14px 16px", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
            The table above becomes an ordered list of rules the administrator writes, read top to bottom, first match
            wins, with eleven kinds of condition including numeric ranges — so &ldquo;big following, no website&rdquo;
            can be a Priority 1 in its own right. One thing stays true whatever is built:{" "}
            <b style={{ color: "var(--ink)" }}>an unknown fact never passes a condition</b>. A rule that needs five
            thousand followers will not take a business whose Instagram has never been looked up, and the rule will say
            how many businesses it is quietly leaving out. <Link href="/rules">How it works</Link> explains the rest of
            the product the same way.
          </p>
        </Panel>
      </>
    </AppShell>
  );
}
