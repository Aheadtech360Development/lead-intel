import { ENRICHMENT_DEFINITIONS, ENRICHMENT_ORDER } from "@lead-intel/shared";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { AppShell, Badge, InfoBox, Note, Panel, SectionHeading, StatCard, TD, Th } from "../ui";

/**
 * What every kind of data costs, what is free, and what has actually been spent.
 *
 * The operator asked to be told what things are for. Cost is the part of this product where not
 * knowing is most expensive, and the answer was previously scattered: rates lived in a registry in
 * the code, the running total lived in a corner of the leads list, and what is *free* was written
 * down nowhere at all. Free is the majority of it, and worth saying loudly.
 *
 * Every figure on the right-hand side comes from `provider_calls`, which is written **before**
 * each paid call. It cannot flatter itself.
 */

const FREE_SOURCES: { name: string; what: string; icon: string }[] = [
  {
    icon: "🕷️",
    name: "Reading their website",
    what: "Up to four pages each — homepage, contact, socials, about. Produces most of the 51 checks, plus their email, a phone number and sometimes the owner's name.",
  },
  {
    icon: "⚡",
    name: "Speed test",
    what: "Google PageSpeed runs a full Lighthouse audit on their mobile site. Gives the load time and performance score behind two of the website checks.",
  },
  {
    icon: "🧮",
    name: "Scoring",
    what: "Problem score, Signals score, priority, and what to sell them. Pure arithmetic over findings already stored — re-runnable as often as you like.",
  },
  {
    icon: "🎬",
    name: "YouTube channel",
    what: "Whether they have a channel and when they last posted. Free, but limited to about 100 businesses a day by Google's quota.",
  },
  {
    icon: "🏷️",
    name: "Your category rules",
    what: "Sorting every business by rules you wrote. Reads text already stored, so changing a rule and re-applying costs nothing.",
  },
  {
    icon: "📂",
    name: "Importing a file",
    what: "Reading a CSV, matching it against businesses you already have, and creating the rest.",
  },
];

export default async function SpendPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const [{ data: calls }, { data: businessRows }] = await Promise.all([
    supabase.from("provider_calls").select("endpoint, cost_cents, status, called_at").limit(20000),
    supabase.from("businesses").select("id").eq("status", "active"),
  ]);

  const spentCents = (calls ?? []).reduce((sum, c) => sum + Number(c.cost_cents ?? 0), 0);
  const businesses = (businessRows ?? []).length;

  const byEndpoint = new Map<string, { calls: number; cents: number; failed: number }>();
  for (const c of calls ?? []) {
    const key = c.endpoint ?? "unknown";
    const at = byEndpoint.get(key) ?? { calls: 0, cents: 0, failed: 0 };
    at.calls += 1;
    at.cents += Number(c.cost_cents ?? 0);
    if (c.status !== "succeeded") at.failed += 1;
    byEndpoint.set(key, at);
  }

  return (
    <AppShell
      current="spend"
      email={typeof claims?.email === "string" ? claims.email : null}
      signOutAction={signOut}
      title="Data & spend"
      what={
        <>
          Every kind of data this system can get, whether it costs anything, and what you have spent
          so far. <strong>Most of it is free</strong> — the paid parts are only ever bought for
          businesses you tick yourself.
        </>
      }
    >
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 6 }}>
        <StatCard icon="💳" tone="money" value={`$${(spentCents / 100).toFixed(2)}`} label="Spent, all time" explain="From the ledger. Written before every paid call." />
        <StatCard icon="🧾" value={(calls ?? []).length} label="Paid calls made" explain="Each one is one business, one source." />
        <StatCard
          icon="🏢"
          value={businesses > 0 ? `$${(spentCents / 100 / businesses).toFixed(3)}` : "—"}
          label="Average per business"
          explain={`Across all ${businesses} businesses, including the ones nothing was bought for.`}
        />
        <StatCard icon="🎁" tone="good" value={FREE_SOURCES.length} label="Things that cost nothing" explain="Listed below. This is the bulk of the system." />
      </div>

      <SectionHeading title="Free — no key, no account, no limit" hint="This runs on every business automatically. You never have to choose it." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14, marginBottom: 8 }}>
        {FREE_SOURCES.map((s) => (
          <div key={s.name} className="card" data-tone="good" style={{ padding: "14px 16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 5 }}>
              <span aria-hidden style={{ fontSize: 17 }}>
                {s.icon}
              </span>
              <span style={{ fontWeight: 700, fontSize: 14.5 }}>{s.name}</span>
              <Badge tone="good">free</Badge>
            </div>
            <div style={{ fontSize: 13.3, color: "var(--ink-3)", lineHeight: 1.5 }}>{s.what}</div>
          </div>
        ))}
      </div>

      <SectionHeading
        title="Paid — bought one business at a time"
        hint="Nothing here happens on its own. You tick businesses on the leads list, see the price, and confirm."
      />
      <Panel tone="money" title="What each one costs" hint="Rates are per business unless the note says otherwise.">
        <table className="tbl">
          <thead>
            <tr>
              <Th label="Data" />
              <Th label="What you get" />
              <Th label="Per business" width={120} />
              <Th label={`All ${businesses}`} explain="If you bought it for everyone" width={110} />
              <Th label="Ready?" width={110} />
            </tr>
          </thead>
          <tbody>
            {ENRICHMENT_ORDER.map((id) => {
              const d = ENRICHMENT_DEFINITIONS[id];
              return (
                <tr key={id}>
                  <td style={{ ...TD, fontWeight: 650 }}>
                    {d.label}
                    <div style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 400 }}>{d.provider}</div>
                  </td>
                  <td style={{ ...TD, fontSize: 13.4, color: "var(--ink-2)" }}>
                    {d.describes}
                    {d.warning ? (
                      <div style={{ fontSize: 13, color: "var(--warn-ink)", marginTop: 5, lineHeight: 1.45 }}>
                        ⚠ {d.warning}
                      </div>
                    ) : null}
                  </td>
                  <td style={{ ...TD, fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>
                    ${(d.costCents / 100).toFixed(4).replace(/0+$/, "").replace(/\.$/, ".00")}
                  </td>
                  <td style={{ ...TD, fontVariantNumeric: "tabular-nums", color: "var(--ink-3)" }}>
                    ${((d.costCents * businesses) / 100).toFixed(2)}
                  </td>
                  <td style={TD}>
                    {d.requiresEnvVar === null ? (
                      <Badge tone="good">connected</Badge>
                    ) : (
                      <Badge tone="warn">needs a key</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Note>
          &ldquo;Needs a key&rdquo; means the option is shown and priced but cannot be bought until
          the provider&rsquo;s key is in <code>apps/jobs/.env</code>. That is deliberate: a source
          with no key must never fail halfway through a paid run.
        </Note>
      </Panel>

      <SectionHeading title="What you have actually spent" hint="Straight from the ledger, grouped by what was bought." />
      <Panel title="The ledger" hint="One row per kind of call. A failed call still cost money and is still counted.">
        {byEndpoint.size === 0 ? (
          <Note>Nothing has been bought yet.</Note>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <Th label="What was bought" />
                <Th label="Calls" width={90} />
                <Th label="Failed" explain="Charged, but returned nothing" width={90} />
                <Th label="Cost" width={110} />
              </tr>
            </thead>
            <tbody>
              {[...byEndpoint.entries()]
                .sort((a, b) => b[1].cents - a[1].cents)
                .map(([endpoint, v]) => (
                  <tr key={endpoint}>
                    <td>{ENDPOINT_LABELS[endpoint] ?? endpoint}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums" }}>{v.calls}</td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: v.failed > 0 ? "var(--warn-ink)" : "var(--ink-3)" }}>
                      {v.failed}
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>
                      {v.cents === 0 ? "free" : `$${(v.cents / 100).toFixed(2)}`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </Panel>

      <InfoBox title="Three things that cannot be bought at any price" tone="warn">
        <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
          <li>
            <strong>Who follows an Instagram account.</strong> Instagram publishes a follower
            <em> count</em> and never a list. No provider has one legally.
          </li>
          <li>
            <strong>How much a business spends on Facebook ads.</strong> Meta publishes spend only
            for political and social-issue ads; for an ordinary business it is empty in Meta&rsquo;s
            own Ad Library. You can see <em>that</em> they advertise and since when, never how much.
          </li>
          <li>
            <strong>Whether a Google listing is claimed</strong>, and the text and dates of their
            reviews. The Places API simply does not return those fields.
          </li>
        </ul>
      </InfoBox>

      <InfoBox title="How buying works" tone="info">
        Go to <Link href="/records">Leads</Link>, tick the businesses you want, and press{" "}
        <strong>Get paid data for the ticked ones</strong>. The next screen counts what would be
        bought, shows the exact price, and marks anything already bought as free. Nothing is
        charged until you confirm, and a spend cap stops a run that goes further than you expected.
      </InfoBox>
    </AppShell>
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
