import { BUSINESS_ORIGIN_LABELS, BUSINESS_ORIGINS, type BusinessOrigin } from "@lead-intel/shared";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewer, leadScope } from "@/lib/viewer";
import { signOut } from "../actions";
import { analyseUnscored } from "../records/analyse-actions";
import { AppShell, NextAction, ROUTE_LABELS, SectionHeading, WEBSITE_LABELS } from "../ui";

/**
 * The overview: what you have, where it came from, what it cost, and what to do next.
 *
 * It exists because the leads list was doing two jobs badly — six stat cards, three bar charts and
 * two rows of filter chips sat *above* the rows an operator was meant to work through, and none of
 * it could be understood. The charts were the giveaway: they were also filters, so a page that
 * looked like a summary behaved like a control panel.
 *
 * Splitting them gives each half one job. This page answers "how is the whole thing going"; the
 * leads list answers "who do I call". Neither has to be read to use the other.
 */

export default async function DashboardPage() {
  const supabase = await createClient();
  const viewer = await getViewer();

  /** A member's dashboard counts their own leads. Nobody else's figure appears on it. */
  const scope = viewer ? leadScope(viewer) : null;
  const claims = viewer ? { sub: viewer.id, email: viewer.email } : null;

  const [
    { data: all },
    { data: analysedRows },
    { data: spendRows },
    { data: outcomeRows },
    { data: batchRows },
    { data: socialRows },
    { data: listingKeys },
  ] =
    await Promise.all([
      (() => {
        let q = supabase
          .from("businesses")
          .select("id, tier, problem_score, route, website_status, passed_gate, claim_status, origin, icp_name")
          .eq("status", "active");
        if (scope) q = q.eq(scope.column, scope.value);
        return q;
      })(),
      supabase.from("field_metadata").select("business_id").eq("field_name", "website_status_reason").limit(20000),
      (() => {
        let q = supabase.from("provider_calls").select("endpoint, cost_cents").limit(20000);
        if (viewer && !viewer.isAdmin) q = q.eq("created_by", viewer.id);
        return q;
      })(),
      supabase.from("outcomes").select("id, meeting_date, business_id").limit(20000),
      supabase.from("import_batches").select("id, filename, row_count").eq("status", "imported"),
      supabase
        .from("field_metadata")
        .select("business_id, field_name")
        .in("field_name", ["instagram_url", "instagram_handle", "meta_ads_checked_at", "contact_email"])
        .limit(20000),
      // A Google listing id is a row in identity_keys, not a column on the business. Last in the
      // list because the destructuring above reads these in order.
      supabase.from("identity_keys").select("business_id").eq("key_type", "place_id").limit(20000),
    ]);

  const rows = all ?? [];

  /**
   * The leak this caught, and why the filtering happens here.
   *
   * `field_metadata`, `outcomes` and `identity_keys` are pulled whole — they are keyed by business,
   * not by person, and PostgREST cannot filter them by "businesses this member owns" without a
   * join. Left as they were, a member's dashboard read *"95 Instagram accounts not looked up"* and
   * *"email found on 298 sites"* — the whole company's numbers, on a screen that promises theirs.
   * So every one of them is cut down to this viewer's own businesses before a single figure is
   * counted.
   */
  const mineOnly = <T extends { business_id?: unknown }>(list: T[] | null): T[] => {
    const data = list ?? [];
    if (!scope) return data;
    const ids = new Set(rows.map((r) => r.id as string));
    return data.filter((row) => ids.has(row.business_id as string));
  };

  const hasListing = new Set(mineOnly(listingKeys).map((k) => k.business_id as string));
  const analysed = new Set(mineOnly(analysedRows).map((r) => r.business_id));
  const neverAnalysed = rows.filter((b) => !analysed.has(b.id));
  const worthCalling = rows.filter((b) => b.passed_gate);
  const claimed = rows.filter((b) => b.claim_status !== "unclaimed");
  const callsLogged = mineOnly(outcomeRows).length;
  const tier1 = rows.filter((b) => b.tier === 1);

  /**
   * The two lines the design asks for that the product could already answer and never did.
   *
   * A business that came from a spreadsheet has no Google listing id, and nothing can work one out
   * from a name — so six checks, and 36% of the Problem score's weight, have no source at all
   * until the listing is bought. That is not a broken analysis; it is a question nobody has asked.
   */
  const importedWithoutListing = rows.filter((b) => b.origin !== "search" && !hasListing.has(b.id));
  const dueBack = mineOnly(outcomeRows).filter((o) => o.meeting_date !== null);

  const has = (field: string) => new Set(mineOnly(socialRows).filter((r) => r.field_name === field).map((r) => r.business_id));
  const igLinked = has("instagram_url");
  const igBought = has("instagram_handle");
  const adsChecked = has("meta_ads_checked_at");
  const withEmail = has("contact_email");

  // `cost_cents` is numeric, which PostgREST serialises as a string — adding it directly would
  // concatenate rather than sum, and the total would read as one very long number.
  const spentCents = (spendRows ?? []).reduce((sum, r) => sum + Number(r.cost_cents ?? 0), 0);
  const spendByEndpoint = new Map<string, { calls: number; cents: number }>();
  for (const call of spendRows ?? []) {
    const key = call.endpoint ?? "unknown";
    const existing = spendByEndpoint.get(key) ?? { calls: 0, cents: 0 };
    existing.calls += 1;
    existing.cents += Number(call.cost_cents ?? 0);
    spendByEndpoint.set(key, existing);
  }

  const count = (predicate: (b: (typeof rows)[number]) => boolean) => rows.filter(predicate).length;

  const routeCounts = Object.keys(ROUTE_LABELS)
    .map((r) => ({ route: r, count: count((b) => b.route === r) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const websiteCounts = Object.keys(WEBSITE_LABELS)
    .map((w) => ({ website: w, count: count((b) => b.website_status === w && analysed.has(b.id)) }))
    .filter((w) => w.count > 0)
    .sort((a, b) => b.count - a.count);
  const originCounts = BUSINESS_ORIGINS.map((o) => ({ origin: o, count: count((b) => b.origin === o) })).filter(
    (o) => o.count > 0,
  );

  const categories = new Map<string, number>();
  for (const b of rows) {
    if (!b.icp_name) continue;
    const key = String(b.icp_name);
    categories.set(key, (categories.get(key) ?? 0) + 1);
  }

  const inIcp = count((b) => b.icp_name !== null);
  const scored = count((b) => b.tier !== null);

  /**
   * What was spent, by who billed it rather than by internal endpoint name.
   *
   * The old table listed "critique-page:about  1 call  $0.00" as its own line, six times over — the
   * ledger's names, shown to an operator who thinks in providers. Grouped here into the companies
   * that actually send an invoice, which is the only grouping a cost is useful in.
   */
  const byProvider = new Map<string, { cents: number; calls: number; what: string }>();
  for (const [endpoint, v] of spendByEndpoint) {
    const provider = endpoint.startsWith("critique-page")
      ? "Google AI Studio (Gemini)"
      : endpoint.startsWith("apify.")
        ? "Apify"
        : endpoint.startsWith("searchText") || endpoint.startsWith("places.")
          ? "Google Places API"
          : endpoint.startsWith("pagespeed")
            ? "Google PageSpeed"
            : (ENDPOINT_LABELS[endpoint] ?? endpoint);
    const what =
      provider === "Google AI Studio (Gemini)"
        ? "reading website pages"
        : provider === "Apify"
          ? "Instagram profiles and ads"
          : provider === "Google Places API"
            ? "searches and listing details"
            : provider === "Google PageSpeed"
              ? "speed tests"
              : "";
    const existing = byProvider.get(provider) ?? { cents: 0, calls: 0, what };
    existing.cents += v.cents;
    existing.calls += v.calls;
    byProvider.set(provider, existing);
  }
  const providers = [...byProvider.entries()].sort((a, b) => b[1].cents - a[1].cents);

  // Short names, because a breakdown row is read at a glance; the full meaning is on the leads list.
  const TIER_SHORT: Record<number, string> = {
    1: "Call these first",
    2: "Spends, little wrong",
    3: "Lots wrong, no spend yet",
    4: "Lowest priority",
  };
  const tierRows = [1, 2, 3, 4].map((tier) => ({
    label: `${tier} · ${TIER_SHORT[tier]}`,
    count: count((b) => b.tier === tier),
    href: `/records?view=everything&tier=${tier}`,
  }));
  const icpRows = [...categories.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => ({ label: name, count: n, href: `/records?view=everything&icp=${encodeURIComponent(name)}` }));

  return (
    <AppShell
      current="dashboard"
      spentCents={spentCents}
      email={typeof claims?.email === "string" ? claims.email : null}
      signOutAction={signOut}
      title="Dashboard"
      actions={
        viewer?.isAdmin ? (
          <Link href="/search" className="btn" style={{ textDecoration: "none" }}>
            Find businesses
          </Link>
        ) : (
          <Link href="/records" className="btn" style={{ textDecoration: "none" }}>
            Open my leads
          </Link>
        )
      }
      what={
        viewer?.isAdmin
          ? "How the whole list is doing, and what to do next."
          : "Your leads, your spend, your tasks — and what is worth doing next."
      }
    >
      {/*
        ---- 1. The four stages, with their numbers in them ----

        The old dashboard said the same thing three times: a strip naming the four stages, a row of
        six number cards, and a pipeline of six more numbers — none of which was placed in the stage
        it belonged to. The operator asked for a new design, and this is its one idea: each stage is
        a column, and the numbers that describe that stage live inside it. Read left to right, it is
        the pipeline; read down a column, it is what that stage has done.
      */}
      <div className="dash-stages">
        <StageColumn
          n={1}
          name={viewer?.isAdmin ? "Sourcing" : "Getting leads in"}
          cost={viewer?.isAdmin ? "Can cost" : "Free"}
          big={rows.length.toLocaleString()}
          bigLabel="businesses in your list"
          lines={[
            ...originCounts.map((o) => ({
              label: BUSINESS_ORIGIN_LABELS[o.origin as BusinessOrigin].label,
              value: o.count,
              href: `/records?view=everything&from=${o.origin}`,
            })),
          ]}
          go={
            viewer?.isAdmin
              ? { href: "/search", label: "Find businesses" }
              : { href: "/records/import", label: "Import a list" }
          }
        />
        <StageColumn
          n={2}
          name="Filtering"
          cost="Free"
          big={worthCalling.length.toLocaleString()}
          bigLabel="worth calling"
          lines={[
            { label: "In one of your ICPs", value: inIcp, href: "/records?view=everything" },
            { label: "In no ICP", value: rows.length - inIcp, href: "/icps" },
            { label: "Claimed by someone", value: claimed.length, href: "/records?claimed=anyone" },
          ]}
          go={{ href: "/icps", label: "Your ICPs" }}
        />
        <StageColumn
          n={3}
          name="Analysis"
          cost="Free"
          big={tier1.length.toLocaleString()}
          bigLabel="Priority 1 — call these first"
          tone="bad"
          lines={[
            { label: "Websites read and checked", value: rows.length - neverAnalysed.length, href: "/records?view=everything" },
            { label: "Not analysed yet", value: neverAnalysed.length, href: "/records?view=unanalysed", warn: neverAnalysed.length > 0 },
            { label: "Given a priority", value: scored, href: "/records?view=everything" },
          ]}
          go={{ href: "/checklists", label: "Checklists" }}
        />
        <StageColumn
          n={4}
          name="Enrichment"
          cost="Paid"
          big={`$${(spentCents / 100).toFixed(2)}`}
          bigLabel="spent, all time"
          tone="money"
          lines={[
            { label: "Instagram looked up", value: igBought.size, href: "/instagram" },
            { label: "Ads checked", value: adsChecked.size, href: "/instagram" },
            { label: "Email found on their site", value: withEmail.size, href: "/records?view=everything" },
          ]}
          go={{ href: "/spend", label: "Data & spend" }}
        />
      </div>

      {/* ---- 2. What to do next ------------------------------------------------------ */}
      <SectionHeading title="What to do next" hint="Only what actually needs doing appears here — each with one button." />
      <div className="dash-next">
        {neverAnalysed.length > 0 && (
          <NextAction
            tone="warn"
            icon="🔍"
            title={`Analyse ${neverAnalysed.length} businesses`}
            body={
              <>
                Nobody has read their websites yet, so they have no score. <strong>It costs nothing.</strong>
              </>
            }
            action={
              <form action={analyseUnscored}>
                <input type="hidden" name="back" value="/dashboard" />
                <button className="btn" type="submit">
                  Analyse them now
                </button>
              </form>
            }
          />
        )}

        {tier1.length > 0 && (
          <NextAction
            tone="bad"
            icon="📞"
            title={`Call your ${tier1.length} Priority 1 leads`}
            body="Lots wrong with their online presence, and signs they already pay for things."
            action={
              <Link href="/records?tier=1" className="btn">
                Open Priority 1
              </Link>
            }
          />
        )}

        {igLinked.size > igBought.size && (
          <NextAction
            tone="social"
            icon="📸"
            title={`${igLinked.size - igBought.size} Instagram accounts not looked up`}
            body={
              <>
                Followers can lift a business with no website into Priority 1. About{" "}
                <strong>0.26¢ each</strong>, billed by Apify, only after you confirm.
              </>
            }
            action={
              <Link href="/instagram" className="btn-2 btn">
                Price them
              </Link>
            }
          />
        )}

        {callsLogged === 0 && rows.length > 0 && (
          <NextAction
            tone="brand"
            icon="📝"
            title="Log your first calls"
            body="The scoring has never seen a real reply. Every call you log teaches it which findings get answered."
            action={
              <Link href="/records" className="btn-2 btn">
                Go to leads
              </Link>
            }
          />
        )}

        {categories.size === 0 && rows.length > 0 && (
          <NextAction
            tone="brand"
            icon="🎯"
            title="Say who you want to sell to"
            body="Write your ICPs once: the words each kind of customer is searched for, and what makes a business count as one."
            action={
              <Link href="/icps?add=1" className="btn-2 btn">
                Add an ICP
              </Link>
            }
          />
        )}

        {importedWithoutListing.length > 0 && (
          <NextAction
            tone="warn"
            icon="🗺️"
            title={`${importedWithoutListing.length} leads cannot be checked on Google`}
            body={
              <>
                A spreadsheet carries no Google listing, so their reviews and search checks have{" "}
                <strong>no source at all</strong> — that is 36% of the Problem score standing on nothing. Buying the
                listing answers six checks and re-scores them. <strong>3.5¢ each</strong>, billed by Google Places,
                after you confirm.
              </>
            }
            action={
              <Link href="/records/enrich" className="btn-2 btn">
                Get listing data
              </Link>
            }
          />
        )}

        {dueBack.length > 0 && (
          <NextAction
            tone="good"
            icon="↩️"
            title={`${dueBack.length} ${dueBack.length === 1 ? "lead is" : "leads are"} waiting on a call back`}
            body="You set a date when you logged the call. It lives on the call and on the lead — there is no reminders screen in this product, so this is where it surfaces."
            action={
              <Link href="/calls?show=due" className="btn-2 btn">
                See the calls
              </Link>
            }
          />
        )}

        {rows.length === 0 && (
          <NextAction
            tone="brand"
            icon="🔎"
            title={viewer?.isAdmin ? "No businesses yet" : "You have not been given any leads yet"}
            body={
              viewer?.isAdmin
                ? "Find them on Google Maps for one of your ICPs, or upload a list you already have."
                : "Nothing has been handed to you — that is all this means. Bringing in your own list is free, and so is adding one by hand."
            }
            action={
              <span style={{ display: "flex", gap: 8 }}>
                {viewer?.isAdmin ? (
                  <Link href="/search" className="btn">
                    Find businesses
                  </Link>
                ) : null}
                <Link href="/records/import" className={viewer?.isAdmin ? "btn-2 btn" : "btn"}>
                  Import a list
                </Link>
                <Link href="/records/new" className="btn-2 btn">
                  Add one by hand
                </Link>
              </span>
            }
          />
        )}
      </div>

      {/* ---- 3. Where the list stands ----------------------------------------------------
          Four breakdowns side by side, every row a link into the leads list with that filter on,
          so a number that surprises you is one click from the businesses behind it. */}
      <SectionHeading title="Where the list stands" hint="Click any row to open those businesses in Leads." />
      <div className="dash-breakdowns">
        <Breakdown title="How good the leads are" total={rows.length} rows={tierRows} />
        <Breakdown
          title="What you could sell them"
          total={rows.length}
          rows={routeCounts.map((r) => ({
            label: ROUTE_LABELS[r.route] ?? r.route,
            count: r.count,
            href: `/records?view=everything&route=${r.route}`,
          }))}
        />
        <Breakdown
          title="Their websites"
          total={rows.length - neverAnalysed.length}
          rows={websiteCounts.map((w) => ({
            label: WEBSITE_LABELS[w.website] ?? w.website,
            count: w.count,
            href: `/records?view=everything&website=${w.website}`,
          }))}
        />
        <Breakdown
          title="Your ICPs"
          total={rows.length}
          rows={icpRows}
          empty={
            <>
              No ICP has matched anything yet. <Link href="/icps?add=1">Add one</Link>.
            </>
          }
          footer={
            rows.length - inIcp > 0 ? (
              <Link href="/icps" style={{ fontSize: 14 }}>
                {(rows.length - inIcp).toLocaleString()} in no ICP →
              </Link>
            ) : null
          }
        />
      </div>

      {/* ---- 4. What it has cost ------------------------------------------------------ */}
      <SectionHeading title="What it has cost" hint="From the ledger, written before every paid call — not an estimate." />
      <div className="dash-cost">
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 34, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
            ${(spentCents / 100).toFixed(2)}
          </div>
          <div style={{ fontSize: 15, color: "var(--ink-2)" }}>spent with every provider, all time</div>
          <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 12, lineHeight: 1.55 }}>
            Reading websites, the 64 checks, scoring and your ICPs cost nothing. Anything that costs
            money is bought only for businesses you pick, after a screen that shows the price.
          </div>
          <Link href="/spend" style={{ display: "inline-block", marginTop: 12, fontSize: 15 }}>
            See every rate →
          </Link>
        </div>
        <div className="card" style={{ padding: "6px 0" }}>
          {providers.length === 0 ? (
            <div style={{ padding: "14px 20px", color: "var(--ink-3)" }}>Nothing has been bought yet.</div>
          ) : (
            providers.map(([provider, v], i) => (
              <div
                key={provider}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto auto",
                  gap: 16,
                  alignItems: "baseline",
                  padding: "11px 20px",
                  borderTop: i === 0 ? "none" : "1px solid var(--rule-2)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 650 }}>{provider}</div>
                  {v.what && <div style={{ fontSize: 14, color: "var(--ink-3)" }}>{v.what}</div>}
                </div>
                <div style={{ fontSize: 14, color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
                  {v.calls.toLocaleString()} calls
                </div>
                <div style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 64, textAlign: "right" }}>
                  {v.cents === 0 ? "free" : `$${(v.cents / 100).toFixed(2)}`}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <p style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 22 }}>
        How the scores, priorities and costs are worked out: <Link href="/rules">How it works</Link>.
        {(batchRows ?? []).length > 0 && (
          <>
            {" "}
            Files you imported: <Link href="/records/imports">{(batchRows ?? []).length}</Link>.
          </>
        )}
      </p>
    </AppShell>
  );
}

/** One stage, as a column: its number, its cost in a word, one big figure and the lines under it. */
function StageColumn({
  n,
  name,
  cost,
  big,
  bigLabel,
  lines,
  go,
  tone,
}: {
  n: number;
  name: string;
  cost: string;
  big: string;
  bigLabel: string;
  lines: { label: string; value: number; href: string; warn?: boolean }[];
  go: { href: string; label: string };
  tone?: "bad" | "money";
}) {
  const free = cost === "Free";
  return (
    <section className="dash-stage">
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <span className="step-num">{n}</span>
        <span style={{ fontSize: 17, fontWeight: 750 }}>{name}</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 12.5,
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            padding: "3px 8px",
            borderRadius: 999,
            whiteSpace: "nowrap",
            color: free ? "var(--good-ink)" : "var(--warn-ink)",
            background: free ? "var(--good-bg)" : "var(--warn-bg)",
          }}
        >
          {cost}
        </span>
      </div>
      <div>
        <div
          style={{
            fontSize: 40,
            lineHeight: 1.05,
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            color: tone === "bad" ? "var(--bad)" : tone === "money" ? "var(--brand)" : "var(--ink)",
          }}
        >
          {big}
        </div>
        <div style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 3 }}>{bigLabel}</div>
      </div>
      <div style={{ display: "grid", borderTop: "1px solid var(--rule-2)" }}>
        {lines.map((line) => (
          <Link key={line.label} href={line.href} className="dash-line">
            <span style={{ color: line.warn ? "var(--warn-ink)" : "var(--ink-2)" }}>{line.label}</span>
            <strong style={{ fontVariantNumeric: "tabular-nums", color: line.warn ? "var(--warn-ink)" : "var(--ink)" }}>
              {line.value.toLocaleString()}
            </strong>
          </Link>
        ))}
      </div>
      <Link href={go.href} style={{ fontSize: 15, marginTop: "auto" }}>
        {go.label} →
      </Link>
    </section>
  );
}

/** A breakdown whose every row opens the leads list with that filter already on. */
function Breakdown({
  title,
  total,
  rows,
  empty,
  footer,
}: {
  title: string;
  total: number;
  rows: { label: string; count: number; href: string }[];
  empty?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <section className="card" style={{ padding: "16px 18px", display: "grid", gap: 10, alignContent: "start" }}>
      <div style={{ fontSize: 16.5, fontWeight: 700 }}>{title}</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>{empty ?? "Nothing yet."}</div>
      ) : (
        rows.map((r) => (
          <Link key={r.label} href={r.href} className="dash-bar">
            <span style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 14.5 }}>
              <span style={{ color: "var(--ink)", minWidth: 0 }}>{r.label}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                <strong>{r.count.toLocaleString()}</strong>
                <span style={{ color: "var(--ink-3)" }}> · {total > 0 ? Math.round((r.count / total) * 100) : 0}%</span>
              </span>
            </span>
            <span className="dash-track">
              <span style={{ width: `${Math.max(2, Math.round((r.count / max) * 100))}%` }} />
            </span>
          </Link>
        ))
      )}
      {footer}
    </section>
  );
}

const ENDPOINT_LABELS: Record<string, string> = {
  searchText: "Finding businesses on Google Maps",
  "searchText:center": "Looking up a location's centre",
  "places.details": "Google listing details (rating, reviews, hours)",
  "pagespeed.run": "Website speed test",
  "apify.instagram": "Instagram profile",
  "apify.metaads": "Facebook & Instagram ads",
  "lusha.contact": "Owner's mobile number",
  "dataforseo.traffic": "Website traffic estimate",
};
