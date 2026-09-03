import { BUSINESS_ORIGIN_LABELS, BUSINESS_ORIGINS, type BusinessOrigin } from "@lead-intel/shared";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import {
  AppShell, Banner,
  FilterOption,
  FilterSection,
  Note,
  PANEL,
  ROUTE_LABELS,
  ScoreBars,
  TD,
  Th,
  TIER_MEANING,
  TierBadge,
  WEBSITE_LABELS,
} from "../ui";
import { claimBusiness, releaseClaim } from "./actions";
import { analyseUnscored } from "./analyse-actions";

/**
 * The call list (spec §8.1) — and now only the call list.
 *
 * The version this replaced tried to be a summary and a worklist at once: six stat cards, three
 * bar charts and two rows of chips sat above the rows, and the operator reported that they could
 * not understand any of it. The charts were the root of it. They were *also* filters, so a page
 * that read as a report behaved as a control panel, and there were three different-looking ways
 * to do the same thing — chips, clickable charts, and stat cards that did nothing at all.
 *
 * So: the summary moved to /dashboard, and every filter on this page now has one shape, in one
 * place, with a count beside it and a plain sentence under its heading. What is left in the main
 * column is the list, which is what the page is for.
 */

interface Filters {
  view?: string;
  tier?: string;
  route?: string;
  website?: string;
  /** "discovered" | "imported" | "manual" — where the record came from. */
  from?: string;
  /** One import batch, so "show me what this file gave me" is a link rather than a memory test. */
  batch?: string;
  /** The operator's own category, and its second level. */
  category?: string;
  subcategory?: string;
  /** Which category rule assigned it — the link from the rules screen. */
  rule?: string;
  /** "yes" | "no" — are they running Facebook/Instagram ads? */
  ads?: string;
  /** A follower floor, so "only the ones with a real following" is one click. */
  minFollowers?: string;
}

interface PageParams extends Filters {
  /** Set after a purchase or an analysis is enqueued, so the operator sees what they started. */
  bought?: string;
  /** Set when starting something failed — shown rather than swallowed. */
  error?: string;
}

function href(current: Filters, change: Partial<Filters>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...change })) {
    if (value && value !== "all") params.set(key, value);
  }
  const query = params.toString();
  return query ? `/records?${query}` : "/records";
}

/** Clicking the filter you already have on clears it, so no selection is ever a dead end. */
function toggle(current: Filters, key: keyof Filters, value: string): string {
  return href(current, { [key]: current[key] === value ? "all" : value });
}

export default async function RecordsPage({ searchParams }: { searchParams: Promise<PageParams> }) {
  const params = await searchParams;
  const view = params.view === "everything" ? "everything" : params.view === "unanalysed" ? "unanalysed" : "ready";
  const current: Filters = {
    ...(view !== "ready" ? { view } : {}),
    ...(params.tier && params.tier !== "all" ? { tier: params.tier } : {}),
    ...(params.route && params.route !== "all" ? { route: params.route } : {}),
    ...(params.website && params.website !== "all" ? { website: params.website } : {}),
    ...(params.from && params.from !== "all" ? { from: params.from } : {}),
    ...(params.batch ? { batch: params.batch } : {}),
    ...(params.category && params.category !== "all" ? { category: params.category } : {}),
    ...(params.subcategory && params.subcategory !== "all" ? { subcategory: params.subcategory } : {}),
    ...(params.rule ? { rule: params.rule } : {}),
    ...(params.ads && params.ads !== "all" ? { ads: params.ads } : {}),
    ...(params.minFollowers && params.minFollowers !== "all" ? { minFollowers: params.minFollowers } : {}),
  };

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  // The whole active set, once. A few hundred rows is small enough that filtering and counting in
  // memory is simpler and cheaper than a round-trip per filter, and it keeps every count in the
  // sidebar guaranteed consistent with the rows beside it.
  const { data: all, error } = await supabase
    .from("businesses")
    .select(
      "id, display_name, city, state, website_status, tier, problem_score, intent_score, route, route_reason, claim_status, claimed_by, passed_gate, manual_review_status, origin, import_batch_id, category, subcategory, category_rule_id",
    )
    .eq("status", "active")
    .order("tier", { ascending: true, nullsFirst: false })
    .order("problem_score", { ascending: false, nullsFirst: false });

  const [{ data: contactRows }, { data: spendRows }, { data: batchRows }, { data: analysedRows }, { data: socialRows }] =
    await Promise.all([
    supabase
      .from("field_metadata")
      .select("business_id, field_name")
      .in("field_name", ["contact_email", "contact_phone_web"])
      // Explicit, because PostgREST caps an unbounded select at 1,000 rows and reports the
      // truncation as an ordinary success. Two fields per business crosses that at roughly 500
      // businesses, which is inside the range this list is built for.
      .limit(20000),
    supabase.from("provider_calls").select("cost_cents").limit(20000),
    supabase.from("import_batches").select("id, filename").eq("status", "imported"),
    // One row per business the crawler has visited. Deliberately not a query against `findings`:
    // that table holds one row per check per business — over eleven thousand rows for a few
    // hundred businesses — and PostgREST would cap the response long before it answered this.
    supabase.from("field_metadata").select("business_id").eq("field_name", "website_status_reason").limit(20000),
    // Instagram and ads, for the columns and the two filters below. One row per business per
    // field, so this is bounded by the list size rather than by anything unbounded.
    supabase
      .from("field_metadata")
      .select("business_id, field_name, value")
      .in("field_name", ["instagram_followers", "instagram_handle", "meta_ads_running"])
      .limit(20000),
  ]);

  const batchNames = new Map((batchRows ?? []).map((b) => [b.id, b.filename ?? "an uploaded file"]));
  const analysed = new Set((analysedRows ?? []).map((f) => f.business_id));

  const social = new Map<string, { followers: number | null; handle: string | null; adsRunning: boolean | null }>();
  for (const row of socialRows ?? []) {
    const at = social.get(row.business_id) ?? { followers: null, handle: null, adsRunning: null };
    if (row.field_name === "instagram_followers") {
      const n = Number(row.value);
      // Left unknown rather than coerced to 0 — a private account has no published count, and a
      // "5,000+ followers" filter must not sweep it in as though it had none.
      at.followers = Number.isFinite(n) ? n : null;
    }
    if (row.field_name === "instagram_handle") at.handle = row.value;
    if (row.field_name === "meta_ads_running") at.adsRunning = row.value === "true";
    social.set(row.business_id, at);
  }

  const contactable = new Map<string, { email: boolean; phone: boolean }>();
  for (const row of contactRows ?? []) {
    const existing = contactable.get(row.business_id) ?? { email: false, phone: false };
    if (row.field_name === "contact_email") existing.email = true;
    if (row.field_name === "contact_phone_web") existing.phone = true;
    contactable.set(row.business_id, existing);
  }
  // numeric arrives as a string from PostgREST; `+` on it concatenates.
  const spentCents = (spendRows ?? []).reduce((sum, r) => sum + Number(r.cost_cents ?? 0), 0);

  const rows = all ?? [];
  const neverAnalysed = rows.filter((b) => !analysed.has(b.id));

  const inView = (b: (typeof rows)[number]) =>
    view === "ready" ? Boolean(b.passed_gate) : view === "unanalysed" ? !analysed.has(b.id) : true;

  const shown = rows.filter((b) => {
    if (!inView(b)) return false;
    if (current.tier && String(b.tier) !== current.tier) return false;
    if (current.route && b.route !== current.route) return false;
    if (current.website && b.website_status !== current.website) return false;
    if (current.from && b.origin !== current.from) return false;
    if (current.batch && b.import_batch_id !== current.batch) return false;
    if (current.category && b.category !== current.category) return false;
    if (current.subcategory && b.subcategory !== current.subcategory) return false;
    if (current.rule && b.category_rule_id !== current.rule) return false;
    if (current.ads) {
      const running = social.get(b.id)?.adsRunning ?? null;
      // Unknown is neither yes nor no. A business whose ads were never checked must not appear
      // under "not advertising", which would be a claim nobody made.
      if (running === null || running !== (current.ads === "yes")) return false;
    }
    if (current.minFollowers) {
      const followers = social.get(b.id)?.followers ?? null;
      if (followers === null || followers < Number(current.minFollowers)) return false;
    }
    return true;
  });

  // Every count in the sidebar is "how many would I see if I clicked this", measured against the
  // filters already on — not a global total. A count that ignores the current selection sends the
  // operator to an empty list, which is the specific way faceted filters usually lie.
  const withinView = rows.filter(inView);
  const countIf = (extra: Partial<Filters>) =>
    withinView.filter((b) => {
      const f = { ...current, ...extra };
      if (f.tier && f.tier !== "all" && String(b.tier) !== f.tier) return false;
      if (f.route && f.route !== "all" && b.route !== f.route) return false;
      if (f.website && f.website !== "all" && b.website_status !== f.website) return false;
      if (f.from && f.from !== "all" && b.origin !== f.from) return false;
      if (f.batch && b.import_batch_id !== f.batch) return false;
      if (f.category && b.category !== f.category) return false;
      if (f.subcategory && b.subcategory !== f.subcategory) return false;
      if (f.rule && b.category_rule_id !== f.rule) return false;
      if (f.ads) {
        const running = social.get(b.id)?.adsRunning ?? null;
        if (running === null || running !== (f.ads === "yes")) return false;
      }
      if (f.minFollowers) {
        const followers = social.get(b.id)?.followers ?? null;
        if (followers === null || followers < Number(f.minFollowers)) return false;
      }
      return true;
    }).length;

  const anyFilter = Boolean(
    current.tier ||
      current.route ||
      current.website ||
      current.from ||
      current.batch ||
      current.category ||
      current.subcategory ||
      current.rule ||
      current.ads ||
      current.minFollowers,
  );

  // Built from what is actually on the list rather than from the rules table, so a category with
  // no businesses in it never appears as a filter that leads nowhere.
  const categoryPairs = new Map<string, { category: string; subcategory: string | null; count: number }>();
  for (const b of withinView) {
    if (!b.category) continue;
    const key = `${b.category}||${b.subcategory ?? ""}`;
    const existing = categoryPairs.get(key);
    if (existing) existing.count += 1;
    else categoryPairs.set(key, { category: b.category, subcategory: b.subcategory, count: 1 });
  }
  const categoryList = [...categoryPairs.values()].sort((a, b) => b.count - a.count);
  const uncategorised = withinView.filter((b) => !b.category).length;
  const anySocial = social.size > 0;

  return (
    <AppShell
      wide
      current="leads"
      email={typeof claims?.email === "string" ? claims.email : null}
      signOutAction={signOut}
      title="Leads"
      what={
        <>
          The call list, ordered so the best call is the first row. Filter it on the left; tick
          businesses to buy extra data for just those. For totals and charts see the{" "}
          <Link href="/dashboard">dashboard</Link>.
        </>
      }
      actions={
        <>
          <Link href="/records/new" className="btn-2 btn">
            Add one by hand
          </Link>
          <Link href="/records/import" className="btn-2 btn">
            Import a list
          </Link>
          <Link href="/search" className="btn">
            Find businesses
          </Link>
        </>
      }
    >
      <>
        {params.bought && (
          <Banner tone="brand">{decodeURIComponent(params.bought)}</Banner>
        )}
        {params.error && (
          <Banner tone="bad">{decodeURIComponent(params.error)}</Banner>
        )}

        {neverAnalysed.length > 0 && (
          <div
            style={{
              ...PANEL,
              padding: "14px 17px",
              borderColor: "var(--accent)",
              borderWidth: 2,
              display: "flex",
              gap: 16,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 440px", minWidth: 280 }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>
                {neverAnalysed.length} businesses have never been analysed
              </div>
              <div style={{ fontSize: 13.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                Their websites have not been read yet, so they have no score. That is not a verdict
                about them — nobody has looked. <strong>It costs nothing.</strong>
              </div>
            </div>
            <form action={analyseUnscored}>
              <input type="hidden" name="back" value={href(current, {})} />
              <button className="btn" type="submit" style={{ padding: "9px 16px", fontSize: 14.5 }}>
                Analyse them now
              </button>
            </form>
          </div>
        )}

        {/* ---- Sidebar of filters, main column of rows -------------------------------- */}
        <div className="work-layout">
          <aside className="work-filters" style={{ ...PANEL, marginBottom: 0 }}>
            <div
              style={{
                padding: "12px 16px",
                borderBottom: "1px solid var(--rule)",
                display: "flex",
                alignItems: "baseline",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                Filters
              </span>
              {anyFilter && (
                <Link
                  href={href({ ...(view !== "ready" ? { view } : {}) }, {})}
                  style={{ marginLeft: "auto", fontSize: 12.5 }}
                >
                  Clear all
                </Link>
              )}
            </div>

            <FilterSection title="Show" hint="Which businesses appear at all.">
              <FilterOption
                label="Worth calling"
                explain="Passed the free checks"
                count={rows.filter((b) => b.passed_gate).length}
                href={href(current, { view: "ready" })}
                active={view === "ready"}
              />
              <FilterOption
                label="Everything"
                explain="All businesses, scored or not"
                count={rows.length}
                href={href(current, { view: "everything" })}
                active={view === "everything"}
              />
              {neverAnalysed.length > 0 && (
                <FilterOption
                  label="Not analysed yet"
                  explain="Nobody has read their site"
                  count={neverAnalysed.length}
                  href={href(current, { view: "unanalysed" })}
                  active={view === "unanalysed"}
                  accent
                />
              )}
            </FilterSection>

            <FilterSection title="Priority" hint="How good a lead is, 1 being the best.">
              {[1, 2, 3, 4].map((tier) => (
                <FilterOption
                  key={tier}
                  label={`${tier} — ${TIER_MEANING[tier]}`}
                  count={countIf({ tier: String(tier) })}
                  href={toggle(current, "tier", String(tier))}
                  active={current.tier === String(tier)}
                />
              ))}
            </FilterSection>

            <FilterSection title="What to sell them" hint="The area with the most wrong.">
              {Object.entries(ROUTE_LABELS).map(([route, label]) => (
                <FilterOption
                  key={route}
                  label={label}
                  count={countIf({ route })}
                  href={toggle(current, "route", route)}
                  active={current.route === route}
                />
              ))}
            </FilterSection>

            <FilterSection title="Their website" hint="What we found when we visited.">
              {Object.entries(WEBSITE_LABELS).map(([status, label]) => (
                <FilterOption
                  key={status}
                  label={label}
                  count={countIf({ website: status })}
                  href={toggle(current, "website", status)}
                  active={current.website === status}
                />
              ))}
            </FilterSection>

            {categoryList.length > 0 && (
              <FilterSection title="Category" hint="Your own rules decide these — edit them on the Categories page.">
                {categoryList.map((c) => (
                  <FilterOption
                    key={`${c.category}-${c.subcategory ?? ""}`}
                    label={c.subcategory ? `${c.category} › ${c.subcategory}` : c.category}
                    count={c.count}
                    href={
                      c.subcategory
                        ? href(current, { category: c.category, subcategory: c.subcategory })
                        : toggle(current, "category", c.category)
                    }
                    active={current.category === c.category && (current.subcategory ?? null) === c.subcategory}
                  />
                ))}
                {uncategorised > 0 && (
                  <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.4 }}>
                    {uncategorised} match no rule yet. <Link href="/categories">Write one</Link>.
                  </div>
                )}
              </FilterSection>
            )}

            {anySocial && (
              <FilterSection title="Instagram &amp; ads" hint="Only for businesses whose Instagram or ads you have bought.">
                <FilterOption
                  label="Running ads now"
                  explain="Already paying to be seen"
                  count={countIf({ ads: "yes" })}
                  href={toggle(current, "ads", "yes")}
                  active={current.ads === "yes"}
                  accent
                />
                <FilterOption
                  label="Not running ads"
                  count={countIf({ ads: "no" })}
                  href={toggle(current, "ads", "no")}
                  active={current.ads === "no"}
                />
                {["1000", "5000", "10000"].map((floor) => (
                  <FilterOption
                    key={floor}
                    label={`${Number(floor).toLocaleString()}+ followers`}
                    count={countIf({ minFollowers: floor })}
                    href={toggle(current, "minFollowers", floor)}
                    active={current.minFollowers === floor}
                  />
                ))}
              </FilterSection>
            )}

            <FilterSection title="Where from" hint="Businesses from a file cannot be scored on Google reviews.">
              {BUSINESS_ORIGINS.map((origin) => (
                <FilterOption
                  key={origin}
                  label={BUSINESS_ORIGIN_LABELS[origin].label}
                  count={countIf({ from: origin })}
                  href={toggle(current, "from", origin)}
                  active={current.from === origin}
                />
              ))}
            </FilterSection>

            {current.batch && (
              <FilterSection title="One file" hint="You followed a link from the imported files page.">
                <div style={{ fontSize: 13.5, color: "var(--ink-2)", marginBottom: 6 }}>
                  {batchNames.get(current.batch) ?? "an uploaded file"}
                </div>
                <Link href={href(current, { batch: "" })} style={{ fontSize: 12.5 }}>
                  Show every file
                </Link>
              </FilterSection>
            )}

            <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
              Spent so far <strong style={{ color: "var(--ink)" }}>${(spentCents / 100).toFixed(2)}</strong> on paid
              lookups. Reading websites and scoring are free.
              {" "}
              <Link href="/records/imports">Files you imported</Link>
            </div>
          </aside>

          <div style={{ minWidth: 0 }}>
            {current.from === "imported" && (
              <div style={{ ...PANEL, padding: "12px 16px", borderColor: "var(--accent)", fontSize: 13.5, lineHeight: 1.55 }}>
                <strong>These came from a file, so two checks cannot run on them.</strong> A
                spreadsheet carries no Google listing, so there is no way to read their reviews,
                their rating, or how they rank in local search. Their Problem score is built from{" "}
                <strong>four areas instead of six</strong>.
              </div>
            )}

            {error && <p style={{ color: "var(--warn-ink)" }}>Could not load the list: {error.message}</p>}

            {!error && shown.length === 0 && (
              <div style={{ ...PANEL, padding: "56px 24px", textAlign: "center", color: "var(--ink-3)" }}>
                <h3 style={{ color: "var(--ink)", fontSize: 19, margin: "0 0 8px" }}>Nothing matches</h3>
                <p style={{ maxWidth: 460, margin: "0 auto 14px", fontSize: 14 }}>
                  No business fits every filter on the left at once.
                </p>
                {anyFilter && (
                  <Link href={href({ ...(view !== "ready" ? { view } : {}) }, {})} className="btn-2 btn" style={{ textDecoration: "none" }}>
                    Clear the filters
                  </Link>
                )}
              </div>
            )}

            {!error && shown.length > 0 && (
              // The table is a form: ticking rows and pressing the button is a plain GET to the
              // confirm screen, with no client-side JavaScript anywhere in this app. Claim and
              // Release use `formAction` rather than forms of their own — a form inside a form is
              // invalid, and the browser's response is to drop the inner one, which silently broke
              // the Claim button for as long as it was written that way.
              <form action="/records/enrich" method="get" style={{ ...PANEL, marginBottom: 0, overflowX: "auto" }}>
                {Object.entries(current).map(([key, value]) => (
                  <input key={key} type="hidden" name={`f_${key}`} value={value} />
                ))}

                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    flexWrap: "wrap",
                    padding: "11px 16px",
                    borderBottom: "1px solid var(--rule)",
                  }}
                >
                  <span style={{ fontSize: 14.5, fontWeight: 700 }}>
                    {shown.length} {shown.length === 1 ? "business" : "businesses"}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--ink-3)" }}>
                    {view === "ready" ? "worth calling" : view === "unanalysed" ? "not analysed yet" : "in total"}
                  </span>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <a href={`/records/export${href(current, {}).replace("/records", "")}`} style={{ fontSize: 13.5 }}>
                      Download CSV
                    </a>
                    {/* Hidden in the "not analysed" view on purpose. The confirm screen rebuilds
                        the selection from the filters it is handed, and "has never been analysed"
                        is not a column it can filter on — it would silently price a different set
                        of businesses than the one on screen. Ticking rows still works there. */}
                    {view !== "unanalysed" && (
                      <button className="btn-2 btn" type="submit" name="scope" value="filtered" style={{ padding: "6px 12px", fontSize: 13.5 }}>
                        Get paid data for all {shown.length}
                      </button>
                    )}
                    <button className="btn" type="submit" style={{ padding: "6px 12px", fontSize: 13.5 }}>
                      Get paid data for ticked
                    </button>
                  </span>
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1290 }}>
                  <thead style={{ background: "var(--surface-2)" }}>
                    <tr>
                      <Th label="" explain="tick" width={38} />
                      <Th label="No." explain="1 is best" width={62} />
                      <Th label="Business" explain="Click to open the full report" />
                      <Th label="What to sell them" explain="The area with the most wrong" width={230} />
                      <Th label="Scores" explain="Problem: how much is wrong. Signals: do they pay for things?" width={160} />
                      <Th label="Category" explain="From your own rules" width={150} />
                      <Th label="Instagram" explain="Followers, and whether they advertise" width={130} />
                      <Th label="Contact" explain="What we have to reach them" width={110} />
                      <Th label="" width={86} />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((b) => {
                      const isMine = claims?.sub && b.claimed_by === claims.sub;
                      const seen = analysed.has(b.id);
                      const contact = contactable.get(b.id);
                      const has = [contact?.email ? "email" : null, contact?.phone ? "phone" : null].filter(Boolean);
                      return (
                        <tr key={b.id}>
                          <td style={TD}>
                            <input
                              type="checkbox"
                              name="id"
                              value={b.id}
                              aria-label={`Select ${b.display_name}`}
                              style={{ width: 16, height: 16, cursor: "pointer" }}
                            />
                          </td>
                          <td style={TD}>
                            <TierBadge tier={b.tier} />
                          </td>
                          <td style={TD}>
                            <Link href={`/records/${b.id}`} style={{ fontWeight: 600 }}>
                              {b.display_name}
                            </Link>
                            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
                              {[b.city, b.state].filter(Boolean).join(", ") || "Location unknown"}
                              {" · "}
                              {/* "Couldn't check" is a claim about their site. Before anyone has
                                  visited it, the honest answer is that we have not looked. */}
                              {seen ? (WEBSITE_LABELS[b.website_status] ?? b.website_status) : "not looked at yet"}
                              {b.manual_review_status ? " · check by hand first" : ""}
                              {b.origin !== "discovered" && (
                                <>
                                  {" · "}
                                  <span style={{ color: "var(--accent)" }}>
                                    {b.origin === "imported"
                                      ? `from ${batchNames.get(b.import_batch_id ?? "") ?? "a file"}`
                                      : "added by hand"}
                                  </span>
                                </>
                              )}
                            </div>
                          </td>
                          <td style={TD}>
                            {b.route ? (
                              <>
                                <div style={{ fontWeight: 600, fontSize: 13.5 }}>{ROUTE_LABELS[b.route] ?? b.route}</div>
                                {b.route_reason && (
                                  <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.4 }}>
                                    {b.route_reason}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span style={{ color: "var(--ink-3)", fontSize: 13 }}>
                                {seen ? "Nothing solid enough" : "Not analysed yet"}
                              </span>
                            )}
                          </td>
                          <td style={TD}>
                            {b.problem_score === null && b.intent_score === null ? (
                              <span style={{ color: "var(--ink-3)", fontSize: 13 }}>
                                {seen ? "Not scored" : "Not analysed"}
                              </span>
                            ) : (
                              <ScoreBars problem={b.problem_score} intent={b.intent_score} />
                            )}
                          </td>
                          <td style={TD}>
                            {b.category ? (
                              <>
                                <div style={{ fontSize: 13.5 }}>{b.category}</div>
                                {b.subcategory ? (
                                  <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{b.subcategory}</div>
                                ) : null}
                              </>
                            ) : (
                              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>no rule matched</span>
                            )}
                          </td>
                          <td style={TD}>
                            {(() => {
                              const s = social.get(b.id);
                              if (!s || (s.followers === null && s.adsRunning === null && !s.handle)) {
                                return <span style={{ fontSize: 13, color: "var(--ink-3)" }}>not looked up</span>;
                              }
                              return (
                                <>
                                  <div style={{ fontSize: 13.5, fontVariantNumeric: "tabular-nums" }}>
                                    {s.followers === null ? "—" : `${s.followers.toLocaleString()} followers`}
                                  </div>
                                  {s.adsRunning !== null ? (
                                    <div
                                      style={{
                                        fontSize: 13,
                                        color: s.adsRunning ? "var(--accent)" : "var(--ink-3)",
                                        fontWeight: s.adsRunning ? 600 : 400,
                                      }}
                                    >
                                      {s.adsRunning ? "running ads" : "no ads"}
                                    </div>
                                  ) : null}
                                </>
                              );
                            })()}
                          </td>
                          <td style={TD}>
                            {has.length > 0 ? (
                              <span style={{ fontSize: 13 }}>{has.join(" + ")}</span>
                            ) : (
                              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>listing only</span>
                            )}
                          </td>
                          <td style={TD}>
                            {b.claim_status === "unclaimed" ? (
                              <button
                                className="btn-2 btn"
                                type="submit"
                                formAction={claimBusiness.bind(null, b.id)}
                                style={{ padding: "5px 11px", fontSize: 13 }}
                              >
                                Claim
                              </button>
                            ) : isMine ? (
                              <button
                                className="btn-2 btn"
                                type="submit"
                                formAction={releaseClaim.bind(null, b.id)}
                                style={{ padding: "5px 11px", fontSize: 13 }}
                              >
                                Release
                              </button>
                            ) : (
                              <span style={{ fontSize: 13, color: "var(--ink-3)" }}>Taken</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <Note>
                  <strong>Problem</strong> is how much is wrong with their online presence, out of
                  100. <strong>Signals</strong> is how much evidence there is that they already pay
                  for things — analytics, a booking tool, a chat widget, a careers page. High on
                  both is the best possible lead, and that is what Priority 1 means.
                </Note>
              </form>
            )}
          </div>
        </div>
      </>
    </AppShell>
  );
}
