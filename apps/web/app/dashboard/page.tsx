import { BUSINESS_ORIGIN_LABELS, BUSINESS_ORIGINS, type BusinessOrigin } from "@lead-intel/shared";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { analyseUnscored } from "../records/analyse-actions";
import {
  AppShell,
  BarRow,
  Funnel,
  InfoBox,
  NextAction,
  Note,
  Panel,
  ROUTE_LABELS,
  SectionHeading,
  StatCard,
  TIER_MEANING,
  WEBSITE_LABELS,
} from "../ui";

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
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const [{ data: all }, { data: analysedRows }, { data: spendRows }, { data: outcomeRows }, { data: batchRows }, { data: socialRows }] =
    await Promise.all([
      supabase
        .from("businesses")
        .select("id, tier, problem_score, route, website_status, passed_gate, claim_status, origin, category, subcategory")
        .eq("status", "active"),
      supabase.from("field_metadata").select("business_id").eq("field_name", "website_status_reason").limit(20000),
      supabase.from("provider_calls").select("endpoint, cost_cents").limit(20000),
      supabase.from("outcomes").select("id").limit(20000),
      supabase.from("import_batches").select("id, filename, row_count").eq("status", "imported"),
      supabase
        .from("field_metadata")
        .select("business_id, field_name")
        .in("field_name", ["instagram_url", "instagram_handle", "meta_ads_checked_at", "contact_email"])
        .limit(20000),
    ]);

  const rows = all ?? [];
  const analysed = new Set((analysedRows ?? []).map((r) => r.business_id));
  const neverAnalysed = rows.filter((b) => !analysed.has(b.id));
  const worthCalling = rows.filter((b) => b.passed_gate);
  const claimed = rows.filter((b) => b.claim_status !== "unclaimed");
  const callsLogged = (outcomeRows ?? []).length;
  const tier1 = rows.filter((b) => b.tier === 1);

  const has = (field: string) => new Set((socialRows ?? []).filter((r) => r.field_name === field).map((r) => r.business_id));
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
    if (!b.category) continue;
    const key = b.subcategory ? `${b.category} › ${b.subcategory}` : String(b.category);
    categories.set(key, (categories.get(key) ?? 0) + 1);
  }

  return (
    <AppShell
      current="dashboard"
      email={typeof claims?.email === "string" ? claims.email : null}
      signOutAction={signOut}
      title="Dashboard"
      what={
        <>
          Where everything stands, and what is worth doing next. <strong>Nothing here filters
          anything</strong> — to work through the businesses themselves, go to{" "}
          <Link href="/records">Leads</Link>.
        </>
      }
    >
      {/* ---- 1. The headline numbers ------------------------------------------------ */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
        <StatCard
          icon="🏢"
          value={rows.length}
          label="Businesses"
          explain="Everything in the system, from every source."
          href="/records?view=everything"
        />
        <StatCard
          icon="🎯"
          tone="brand"
          value={worthCalling.length}
          label="Worth calling"
          explain="Enough is wrong with these to justify picking up the phone."
          href="/records"
        />
        <StatCard
          icon="🔥"
          tone="bad"
          value={tier1.length}
          label="Priority 1"
          explain="Lots wrong AND already spending money. The best leads there are."
          href="/records?tier=1&view=everything"
        />
        <StatCard
          icon="✉️"
          tone="good"
          value={withEmail.size}
          label="Reachable by email"
          explain="Found free on their own website — no lookup was bought."
        />
        <StatCard
          icon="📞"
          tone={callsLogged === 0 ? "warn" : "good"}
          value={callsLogged}
          label="Calls logged"
          explain={callsLogged === 0 ? "The scoring has never seen a real reply." : "Every one of these teaches the scoring."}
        />
        <StatCard
          icon="💳"
          tone="money"
          value={`$${(spentCents / 100).toFixed(2)}`}
          label="Spent so far"
          explain="Read from the ledger, not estimated."
          href="/spend"
        />
      </div>

      {/* ---- 2. What to do next ------------------------------------------------------ */}
      <SectionHeading title="What to do next" hint="Only the things that actually need doing appear here." />
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        {neverAnalysed.length > 0 && (
          <NextAction
            tone="warn"
            icon="🔍"
            title={`Analyse ${neverAnalysed.length} businesses`}
            body={
              <>
                Nobody has read their websites yet, so they have no score. That is not a verdict
                about them — it means we have not looked. <strong>It costs nothing.</strong>
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

        {callsLogged === 0 && (
          <NextAction
            tone="bad"
            icon="📞"
            title="Log your first calls"
            body={
              <>
                The scoring has <strong>never seen a real reply</strong>. Every weight, the cut-off
                for &ldquo;worth calling&rdquo;, and which opening line works are estimates until
                about twenty calls have been logged.
              </>
            }
            action={
              <Link href="/records" className="btn">
                Open the call list
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
                Their websites link to an Instagram account and nobody has read it. Buying gives you
                followers, the category Instagram lists them under, and their bio — about{" "}
                <strong>a quarter of a cent each</strong>.
              </>
            }
            action={
              <Link href="/records?view=everything" className="btn-2 btn">
                Pick who to look up
              </Link>
            }
          />
        )}

        {categories.size === 0 && rows.length > 0 && (
          <NextAction
            tone="brand"
            icon="🏷️"
            title="Sort them into your own categories"
            body="Instagram gives every account one category and no second level, so a sub-category like “t-shirts within fashion” has to be defined by you. Write the rules once and every business gets sorted."
            action={
              <Link href="/categories" className="btn-2 btn">
                Set up categories
              </Link>
            }
          />
        )}

        {rows.length === 0 && (
          <NextAction
            tone="brand"
            icon="🔎"
            title="No businesses yet"
            body="Find them on Google Maps by trade and place, or upload a list you already have."
            action={
              <span style={{ display: "flex", gap: 8 }}>
                <Link href="/search" className="btn">
                  Find businesses
                </Link>
                <Link href="/records/import" className="btn-2 btn">
                  Import a list
                </Link>
              </span>
            }
          />
        )}

        {neverAnalysed.length === 0 && callsLogged > 0 && rows.length > 0 && categories.size > 0 && (
          <NextAction
            tone="good"
            icon="✅"
            title="Nothing is waiting"
            body="Everything found has been analysed, scored and sorted, and calls are being logged. Find more businesses when you want more leads."
            action={
              <Link href="/search" className="btn">
                Find more businesses
              </Link>
            }
          />
        )}
      </div>

      {/* ---- 3. The pipeline --------------------------------------------------------- */}
      <SectionHeading
        title="Your pipeline"
        hint="Each number is a subset of the one before it. Read left to right to see where businesses drop out."
      />
      <div className="card" style={{ overflowX: "auto", marginBottom: 4 }}>
        <Funnel
          steps={[
            { label: "Found", value: rows.length, explain: "Every business, from any source.", href: "/records?view=everything" },
            {
              label: "Analysed",
              value: rows.length - neverAnalysed.length,
              explain: "Website read, every free check run.",
              ...(neverAnalysed.length > 0 ? { tone: "warn" as const } : {}),
            },
            { label: "Scored", value: count((b) => b.tier !== null), explain: "Enough measured to give a priority." },
            {
              label: "Worth calling",
              value: worthCalling.length,
              explain: "Enough wrong to justify the phone.",
              tone: "brand" as const,
              href: "/records",
            },
            { label: "Claimed", value: claimed.length, explain: "Someone has taken them to contact." },
            {
              label: "Called",
              value: callsLogged,
              explain: "Outcomes logged. This teaches the scoring.",
              ...(callsLogged === 0 ? { tone: "bad" as const } : {}),
            },
          ]}
        />
        {neverAnalysed.length > 0 && (
          <Note tone="warn">
            {neverAnalysed.length} of {rows.length} have not been analysed, so they cannot reach any
            stage after it. That is the biggest single gap on this page.
          </Note>
        )}
      </div>

      {/* ---- 4. What the analysis found ---------------------------------------------- */}
      <SectionHeading title="What the analysis found" hint="Across every business whose website has been read." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 18 }}>
        <Panel
          tone="brand"
          title="What you could sell them"
          hint="The area with the most wrong, for each business. This is the recommended pitch."
        >
          <div style={{ padding: "6px 0 12px" }}>
            {routeCounts.length === 0 ? (
              <Note>Nothing has been scored yet.</Note>
            ) : (
              routeCounts.map((r) => (
                <BarRow
                  key={r.route}
                  label={ROUTE_LABELS[r.route] ?? r.route}
                  count={r.count}
                  total={rows.length}
                  href={`/records?view=everything&route=${r.route}`}
                  tone="neutral"
                />
              ))
            )}
          </div>
        </Panel>

        <Panel tone="info" title="State of their websites" hint="What we found when we visited. Analysed businesses only.">
          <div style={{ padding: "6px 0 12px" }}>
            {websiteCounts.length === 0 ? (
              <Note>Nothing has been analysed yet.</Note>
            ) : (
              websiteCounts.map((w) => (
                <BarRow
                  key={w.website}
                  label={WEBSITE_LABELS[w.website] ?? w.website}
                  count={w.count}
                  total={Math.max(1, rows.length - neverAnalysed.length)}
                  href={`/records?view=everything&website=${w.website}`}
                  tone={w.website === "dead" || w.website === "no_website" ? "problem" : "neutral"}
                />
              ))
            )}
          </div>
        </Panel>

        <Panel
          tone="bad"
          title="How good the leads are"
          hint="Priority 1 is the best. Hover a row on the leads list to see what each means."
        >
          <div style={{ padding: "6px 0 12px" }}>
            {[1, 2, 3, 4].map((tier) => (
              <BarRow
                key={tier}
                label={`${tier} — ${TIER_MEANING[tier]}`}
                count={count((b) => b.tier === tier)}
                total={rows.length}
                href={`/records?view=everything&tier=${tier}`}
                tone={tier === 1 ? "problem" : "neutral"}
              />
            ))}
          </div>
        </Panel>

        <Panel
          tone="social"
          title="Your categories"
          hint="Sorted by rules you wrote. Instagram has no second level, so this is yours to define."
          right={
            <Link href="/categories" style={{ fontSize: 13 }}>
              Edit rules
            </Link>
          }
        >
          <div style={{ padding: "6px 0 12px" }}>
            {categories.size === 0 ? (
              <Note>No category rules have been applied yet.</Note>
            ) : (
              [...categories.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([label, n]) => <BarRow key={label} label={label} count={n} total={rows.length} tone="neutral" />)
            )}
          </div>
        </Panel>
      </div>

      {/* ---- 5. Provenance and money ------------------------------------------------- */}
      <SectionHeading title="Where your data came from, and what it cost" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))", gap: 18 }}>
        <Panel title="Where they came from" hint="Businesses found by search can be scored on more than businesses from a file.">
          <div style={{ padding: "6px 0 6px" }}>
            {originCounts.map((o) => (
              <BarRow
                key={o.origin}
                label={BUSINESS_ORIGIN_LABELS[o.origin as BusinessOrigin].label}
                count={o.count}
                total={rows.length}
                href={`/records?view=everything&from=${o.origin}`}
                tone="neutral"
              />
            ))}
          </div>
          {(batchRows ?? []).length > 0 && (
            <div style={{ padding: "4px 18px 14px" }}>
              <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 5 }}>Files you have imported</div>
              {(batchRows ?? []).slice(0, 6).map((b) => (
                <div key={b.id} style={{ fontSize: 13, padding: "2px 0" }}>
                  <Link href={`/records/imports/${b.id}`}>{b.filename ?? "an uploaded file"}</Link>{" "}
                  <span style={{ color: "var(--ink-3)" }}>— {b.row_count} rows</span>
                </div>
              ))}
            </div>
          )}
          <Note>
            A file carries no Google listing, so reviews and local-search checks cannot run on those
            businesses — their score comes from four areas rather than six.
          </Note>
        </Panel>

        <Panel tone="money" title="What it has cost" hint="From the ledger, written before every paid call — not an estimate.">
          <div style={{ padding: "14px 18px 4px" }}>
            <div style={{ fontSize: 34, fontWeight: 750, lineHeight: 1.05, color: "var(--money-ink)" }}>
              ${(spentCents / 100).toFixed(2)}
            </div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>total, all time</div>
          </div>
          <table className="tbl" style={{ marginTop: 8 }}>
            <tbody>
              {[...spendByEndpoint.entries()]
                .sort((a, b) => b[1].cents - a[1].cents)
                .map(([endpoint, v]) => (
                  <tr key={endpoint}>
                    <td>{ENDPOINT_LABELS[endpoint] ?? endpoint}</td>
                    <td style={{ color: "var(--ink-3)", textAlign: "right" }}>{v.calls} calls</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>
                      {v.cents === 0 ? "free" : `$${(v.cents / 100).toFixed(2)}`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <Note>
            Reading websites, running every check and measuring speed are <strong>free</strong>.
            Anything that costs money is bought one business at a time, on a screen that shows the
            price first. <Link href="/spend">See every rate</Link>.
          </Note>
        </Panel>
      </div>

      <InfoBox title="How this all fits together" tone="info">
        Businesses arrive three ways — a Maps search, an uploaded file, or typed by hand. Every one
        is then <strong>crawled and scored for free</strong>: we read their website, run 51 checks,
        measure their speed, and work out both a <strong>Problem score</strong> (how much is wrong)
        and a <strong>Signals score</strong> (evidence they already pay for things). Anything beyond
        that — their Google listing, Instagram, whether they run ads — costs money and is only ever
        bought for businesses you tick yourself.
      </InfoBox>
    </AppShell>
  );
}

/**
 * The ledger stores endpoint names; an operator should not have to read `searchText:center`.
 * The keys are taken from what `provider_calls` actually holds, checked against the live table
 * rather than guessed from the code that writes them.
 */
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
