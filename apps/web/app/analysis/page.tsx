import { AREA_COVERAGE_FLOOR, AREA_WEIGHTS, SERVICE_AREAS, type ServiceArea } from "@lead-intel/shared";
import { CHECK_DEFINITIONS } from "@lead-intel/core";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer, leadScope } from "@/lib/viewer";
import { signOut } from "../actions";
import { analyseUnscored } from "../records/analyse-actions";
import { AREA_EXPLAIN, AREA_LABELS, AppShell, Badge, InfoBox, Meter, PANEL, Panel, SectionHeading, StatCard, TD, Th } from "../ui";

/**
 * What has been read across the whole list, and where it ran out of road.
 *
 * The analysis existed only inside a single lead: you could see that *this* business was scored on
 * nineteen answers, and nothing in the product would tell you that nine others were in the same
 * state. So three questions had no screen — *how much can each area actually answer · which leads
 * are standing on almost nothing · what could not be read at all* — and all three are answerable
 * from figures already stored.
 *
 * **Nothing here is recomputed.** `businesses.area_scores` is written by the scorer and already
 * carries each area's coverage, the points that were measured and whether it cleared the floor;
 * this page reads that column rather than pulling twenty-eight thousand findings to count them
 * again. The per-check detail stays where it belongs, on the lead.
 */

interface AreaScoreRow {
  area: string;
  score: number | null;
  firedPoints: number;
  measuredPoints: number;
  possiblePoints: number;
  coverage: number;
  enoughData: boolean;
}

function readAreaScores(value: unknown): Record<string, AreaScoreRow> {
  if (value === null || typeof value !== "object") return {};
  return value as Record<string, AreaScoreRow>;
}

/** What each failed read means in words a salesperson can act on. */
const FAILURE_WORDS: Record<string, { label: string; what: string }> = {
  timeout: {
    label: "Timed out",
    what: "The page did not answer within 35 seconds. Usually a slow host — worth one more try.",
  },
  unreachable: {
    label: "Could not be reached",
    what: "The address did not resolve. Often the website on the record is the wrong one.",
  },
  http_error: {
    label: "The site refused us",
    what: "It answered with an error. Opening it in a real browser usually gets in.",
  },
  browser_failed: {
    label: "The browser gave up",
    what: "The page loaded something it could not finish.",
  },
  blocked: {
    label: "We were blocked",
    what: "Their robots rules or a bot wall turned the crawler away.",
  },
};

export default async function AnalysisPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");

  const supabase = await createClient();
  const scope = leadScope(viewer);

  let query = supabase
    .from("businesses")
    .select("id, display_name, city, state, problem_score, tier, website_status, area_scores, scored_at, origin")
    .eq("status", "active")
    .limit(20000);
  if (scope) query = query.eq(scope.column, scope.value);
  const { data: rows } = await query;

  const businesses = rows ?? [];
  const ids = new Set(businesses.map((b) => b.id));

  // 374 rows today, and bounded by the number of pages ever opened — small enough to read whole.
  const { data: pageRows } = await supabase.from("page_audits").select("business_id, outcome, url").limit(20000);

  /**
   * Which of these have a Google listing at all.
   *
   * It is not a column on the business: identity keys are a table, because a business can be
   * recognised by several things and a listing id is only one of them. A lead that has no
   * `place_id` row is one a spreadsheet brought in, and six checks have nothing to answer them.
   */
  const { data: keyRows } = await supabase
    .from("identity_keys")
    .select("business_id")
    .eq("key_type", "place_id")
    .limit(20000);
  const hasListing = new Set((keyRows ?? []).map((k) => k.business_id as string));
  const pages = (pageRows ?? []).filter((p) => ids.has(p.business_id as string));

  const analysed = businesses.filter((b) => b.scored_at !== null);
  const neverAnalysed = businesses.filter((b) => b.scored_at === null);

  /**
   * Coverage per area, across every lead that has been scored.
   *
   * Points rather than checks: a check that cannot be answered takes its points out of the
   * denominator too, which is exactly how the scorer decides whether an area may count at all.
   */
  const areaTotals = new Map<string, { measured: number; possible: number; scored: number; floored: number }>();
  for (const area of SERVICE_AREAS) areaTotals.set(area, { measured: 0, possible: 0, scored: 0, floored: 0 });

  const thin: { id: string; name: string; where: string; areasScored: number; problem: number | null; why: string }[] = [];

  for (const business of analysed) {
    const areas = readAreaScores(business.area_scores);
    let enough = 0;
    for (const area of SERVICE_AREAS) {
      const row = areas[area];
      const totals = areaTotals.get(area)!;
      if (!row) continue;
      totals.measured += row.measuredPoints ?? 0;
      totals.possible += row.possiblePoints ?? 0;
      if (row.enoughData) {
        totals.floored += 1;
        enough += 1;
      }
      totals.scored += 1;
    }
    if (enough <= 1) {
      thin.push({
        id: business.id as string,
        name: business.display_name as string,
        where: [business.city, business.state].filter(Boolean).join(" "),
        areasScored: enough,
        problem: business.problem_score as number | null,
        why: !hasListing.has(business.id as string)
          ? "No Google listing — the reviews and search checks have no source"
          : business.website_status === "no_website" || business.website_status === "social_only"
            ? "No website to read"
            : "Too little came back from their site",
      });
    }
  }

  thin.sort((a, b) => a.areasScored - b.areasScored || (b.problem ?? 0) - (a.problem ?? 0));

  const failures = new Map<string, number>();
  for (const page of pages) {
    const outcome = String(page.outcome ?? "");
    if (outcome === "ok" || outcome === "") continue;
    failures.set(outcome, (failures.get(outcome) ?? 0) + 1);
  }
  const failedPages = [...failures.entries()].sort((a, b) => b[1] - a[1]);
  const failedTotal = failedPages.reduce((sum, [, n]) => sum + n, 0);

  /** The registry, counted rather than typed out. */
  const byArea = new Map<string, { checks: number; points: number }>();
  for (const definition of CHECK_DEFINITIONS) {
    const key = definition.area ?? "intent";
    const row = byArea.get(key) ?? { checks: 0, points: 0 };
    row.checks += 1;
    row.points += definition.points;
    byArea.set(key, row);
  }
  const unanswerable = CHECK_DEFINITIONS.filter((d) => d.costClass === "BEST_EFFORT").length;

  const mine = viewer.isAdmin ? "the list" : "your leads";

  return (
    <AppShell
      current="analysis"
      email={viewer.email}
      signOutAction={signOut}
      title="Website analysis"
      what={`What has been read across ${mine}, how much of it could be answered, and where it ran out of road. Everything on this screen is free to run again.`}
      actions={
        neverAnalysed.length > 0 ? (
          <form action={analyseUnscored}>
            <button className="btn" type="submit">
              Analyse the {neverAnalysed.length} never looked at
            </button>
          </form>
        ) : null
      }
    >
      <>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
          <StatCard
            value={analysed.length}
            label="Analysed"
            explain={`Of ${businesses.length}. Analysing is free and can be run again as often as you like.`}
            href="/records?view=everything"
          />
          <StatCard
            value={neverAnalysed.length}
            label="Never looked at"
            explain="No check has run against these, so they have no score at all — which is not the same as a low one."
            href="/records?view=unscored"
            tone={neverAnalysed.length > 0 ? "warn" : "plain"}
          />
          <StatCard
            value={thin.length}
            label="Scored on too little"
            explain="One area or none cleared the coverage floor. The score is standing on very little."
            tone={thin.length > 0 ? "warn" : "good"}
          />
          <StatCard
            value={failedTotal}
            label="Pages that could not be read"
            explain={`Of ${pages.length} opened. Every check that needed one of them is marked not measured with the reason.`}
          />
        </div>

        <Panel
          title="How much each area can answer"
          hint={`Across the ${analysed.length} scored leads, by points rather than by checks — a question nobody can answer leaves the sum entirely, which is how the scorer treats it too.`}
        >
          <div style={{ padding: "14px 16px", display: "grid", gap: 12 }}>
            {SERVICE_AREAS.map((area) => {
              const totals = areaTotals.get(area)!;
              const coverage = totals.possible > 0 ? totals.measured / totals.possible : 0;
              const belowFloor = coverage < AREA_COVERAGE_FLOOR;
              return (
                <div key={area} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 1.1fr) minmax(0, 2fr) auto", gap: 14, alignItems: "center" }}>
                  <div style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 13.5, color: "var(--ink)" }}>{AREA_LABELS[area] ?? area}</b>
                    <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                      weight {AREA_WEIGHTS[area as ServiceArea].toFixed(2)} · {totals.floored} of {analysed.length} leads scored on it
                    </div>
                  </div>
                  <Meter value={Math.round(coverage * 100)} max={100} tone={belowFloor ? "problem" : "neutral"} />
                  <b className="mono" style={{ fontSize: 13, color: "var(--ink)" }}>
                    {Math.round(coverage * 100)}%
                  </b>
                </div>
              );
            })}

            <InfoBox title={`The line is ${Math.round(AREA_COVERAGE_FLOOR * 100)}%`} tone="warn">
              An area has to clear it before it is allowed into the Problem score at all. Below it, the area returns
              nothing rather than a number it cannot support — so a low bar here does not mean those businesses are
              fine, it means nothing has been asked. Buying the Google listing is what moves reviews and search.{" "}
              <Link href="/records/enrich">Buy listing data</Link>.
            </InfoBox>
          </div>
        </Panel>

        <SectionHeading
          title={thin.length > 0 ? `${thin.length} scored on too little` : "Nothing is scored on too little"}
          hint="One area or none cleared the floor. A thin score is not a good score and not a bad one — it is a score standing on very little."
        />
        <div style={PANEL}>
          {thin.length === 0 ? (
            <div style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--ink-2)" }}>
              Every scored lead has at least two areas with enough behind them.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="data" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <Th label="Business" />
                    <Th label="Areas scored" explain="Of the six. An area needs 40% of its points answered before it counts." width={120} />
                    <Th label="What is missing" />
                    <Th label="Problem" width={90} />
                    <Th label="" width={56} />
                  </tr>
                </thead>
                <tbody>
                  {thin.slice(0, 25).map((row) => (
                    <tr key={row.id}>
                      <td style={TD}>
                        <b style={{ color: "var(--ink)" }}>{row.name}</b>
                        <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{row.where || "—"}</div>
                      </td>
                      <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>
                        <b style={{ color: "var(--ink)" }}>{row.areasScored}</b>
                        <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}> / 6</span>
                      </td>
                      <td style={{ ...TD, fontSize: 12.5, color: "var(--ink-2)" }}>{row.why}</td>
                      <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>
                        {row.problem === null ? (
                          <Badge tone="plain">No score</Badge>
                        ) : (
                          <b style={{ color: "var(--ink)" }}>{row.problem.toFixed(1)}</b>
                        )}
                      </td>
                      <td style={TD}>
                        <Link href={`/records/${row.id}?tab=checks`} className="btn ghost sm">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {thin.length > 25 ? (
            <div style={{ padding: "11px 16px", borderTop: "1px solid var(--line)", fontSize: 12.5, color: "var(--ink-2)" }}>
              Showing 25 of {thin.length}.
            </div>
          ) : null}
        </div>

        <div className="split" style={{ marginTop: 18 }}>
          <Panel title="Pages that could not be read" hint="Every check that needed one of these is marked not measured with the reason — never failed, never passed.">
            {failedPages.length === 0 ? (
              <div style={{ padding: "16px 18px", fontSize: 13.5, color: "var(--ink-2)" }}>
                Every page that was opened came back.
              </div>
            ) : (
              <div className="list">
                {failedPages.map(([outcome, count]) => {
                  const words = FAILURE_WORDS[outcome] ?? { label: outcome, what: "The read did not complete." };
                  return (
                    <div key={outcome}>
                      <Badge tone="warn">{count}</Badge>
                      <div>
                        <b style={{ color: "var(--ink)", fontSize: 13 }}>{words.label}</b>
                        <div style={{ fontSize: 12, color: "var(--ink-2)" }}>{words.what}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel
            title={`What the ${CHECK_DEFINITIONS.length} checks cover`}
            hint="Read from the same registry the scorer uses, so this page cannot drift from what actually runs."
          >
            <div style={{ overflowX: "auto" }}>
              <table className="data" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    <Th label="Area" />
                    <Th label="Checks" width={80} />
                    <Th label="Points" width={80} />
                    <Th label="Weight" width={80} />
                  </tr>
                </thead>
                <tbody>
                  {SERVICE_AREAS.map((area) => {
                    const row = byArea.get(area);
                    if (!row) return null;
                    return (
                      <tr key={area}>
                        <td style={TD}>
                          <b style={{ color: "var(--ink)" }}>{AREA_LABELS[area] ?? area}</b>
                          <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>{AREA_EXPLAIN[area] ?? ""}</div>
                        </td>
                        <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{row.checks}</td>
                        <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{row.points}</td>
                        <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{AREA_WEIGHTS[area as ServiceArea].toFixed(2)}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td style={TD}>
                      <b style={{ color: "var(--ink)" }}>Signs they already spend money</b>
                      <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>the Signals score — no weight here</div>
                    </td>
                    <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{byArea.get("intent")?.checks ?? 0}</td>
                    <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{byArea.get("intent")?.points ?? 0}</td>
                    <td style={{ ...TD, fontSize: 12.5, color: "var(--ink-2)" }}>separate</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--line)" }}>
              <InfoBox title="Some of these cannot be answered by anything connected" tone="warn">
                {unanswerable} are marked best-effort in the registry, and more are blocked by what the sources will
                sell: Google returns no individual reviews, no review dates, no photo counts and no claimed status at
                any price; rank needs a provider nobody has connected; social post dates have no source at all. Each
                one says so on the record with its reason instead of quietly counting as a pass.{" "}
                <Link href="/rules">How it works</Link>.
              </InfoBox>
            </div>
          </Panel>
        </div>
      </>
    </AppShell>
  );
}
