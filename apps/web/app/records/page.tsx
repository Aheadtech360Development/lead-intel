import { BUSINESS_ORIGIN_LABELS, BUSINESS_ORIGINS, type BusinessOrigin } from "@lead-intel/shared";
import Link from "next/link";
import { leadTint, loadSocialFacts, matchesFilters, type LeadRow, type LeadTint } from "@/lib/lead-filters";
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
  Panel,
  Price,
  TierBadge,
  WEBSITE_LABELS,
} from "../ui";
import { claimBusiness, releaseClaim } from "./actions";
import { analyseUnscored } from "./analyse-actions";
import {
  auditEveryWebsite,
  auditTickedWebsites,
  getPaidDataForFiltered,
  getPaidDataForTicked,
  rescoreEverything,
} from "./audit-actions";

/**
 * The whole-list jobs, as data.
 *
 * Every entry carries its price and the service that bills it, because the operator's standing
 * instruction is that no cost may appear without naming the platform behind it and what that
 * platform does. Making the price part of the definition means an unnamed one cannot be written by
 * accident.
 */
/**
 * The three row tints, and what each one means.
 *
 * Kept beside the legend that explains them, so a colour cannot be added without a line telling the
 * operator what it says. A tint nobody can decode is decoration.
 */
const ROW_TINT: Record<LeadTint, string> = {
  "nothing-but-demand": "var(--row-red)",
  "no-website": "var(--row-blue)",
  "no-instagram": "var(--row-peach)",
  "has-both": "var(--row-green)",
};

/**
 * The key to the row colours.
 *
 * Written as what they **have** and what they **have not**, rather than as a sentence to interpret.
 * The operator asked to be told "kis color se kia hai or nhi hai", and a legend that says "an
 * audience with nowhere to send it" is prose about a colour rather than a definition of one.
 *
 * Ordered by how much attention the row deserves, so the key reads top to bottom the way the work
 * does — best call first.
 */
const ROW_TINT_MEANING: { tint: string; short: string; has: string; hasNot: string; why: string }[] = [
  {
    tint: "var(--row-red)",
    short: "Reviews only",
    has: "Google reviews",
    hasNot: "website, Instagram",
    why: "Proven customers and nowhere online to send them. Call these first.",
  },
  {
    tint: "var(--row-blue)",
    short: "No website",
    has: "Instagram",
    hasNot: "working website",
    why: "An audience already built, and no site behind it.",
  },
  {
    tint: "var(--row-peach)",
    short: "No Instagram",
    has: "working website",
    hasNot: "Instagram",
    why: "Findable, but absent from the platform their customers use.",
  },
  {
    tint: "var(--row-green)",
    short: "Has both",
    has: "website, Instagram",
    hasNot: "nothing missing",
    why: "A working site and an Instagram account. Least to sell them.",
  },
];

const WHOLE_LIST_JOBS: {
  title: string;
  what: string;
  button: string;
  action: (formData: FormData) => void | Promise<void>;
  cents: number;
  buys: string;
  platform: string;
  primary?: boolean;
  /** What pressing the button does, shown on hover. */
  tip: string;
}[] = [
  {
    title: "Read every website page by page",
    what:
      "Opens each business's site in a real browser, walks its pages, measures the layout, keeps a screenshot of the home and product pages, and asks the model what the measurements miss. Skips anything already read.",
    button: "Read them page by page",
    tip: "Starts reading every website not yet read page by page. This is the whole list — it can take hours. You can stop it from the bar at the top.",
    action: auditEveryWebsite,
    cents: 0.36,
    buys: "the model's read on each page it finds",
    platform: "Google AI Studio (Gemini), plus browser time on Trigger.dev",
    primary: true,
  },
  {
    title: "Re-score and re-sort everything",
    what:
      "Works the two scores and the priorities out again from the checks already stored. No website is read again and no provider is called - it is arithmetic over what is already here.",
    button: "Re-score everything",
    tip: "Works out every business's score and priority again from what is already stored. Free, and takes a few minutes.",
    action: rescoreEverything,
    cents: 0,
    buys: "nothing - it only re-reads what is already stored",
    platform: "our own code, on Trigger.dev",
  },
];

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
  /** Free text: a name, a town, a domain. */
  q?: string;
  /** "me" | "anyone" | "nobody" — who has claimed it. */
  claimed?: string;
  /** "colour" groups the list by what each business is missing. Anything else is the usual order. */
  sort?: string;
  /**
   * "1" renders every visible row already ticked.
   *
   * A select-all box that actually ticks the others needs JavaScript, and this application has
   * none. A link that reloads the page with every checkbox rendered checked reaches the same place
   * by the same mechanism every filter here already uses — and it survives without scripting, which
   * a checkbox listener would not.
   */
  all?: string;
}

interface PageParams extends Filters {
  /** Set after a purchase or an analysis is enqueued, so the operator sees what they started. */
  bought?: string;
  /** Set after anything else that succeeded. Two names for one idea, kept because both are in use. */
  saved?: string;
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
    ...(params.q && params.q.trim() ? { q: params.q.trim() } : {}),
    ...(params.claimed && params.claimed !== "all" ? { claimed: params.claimed } : {}),
    ...(params.sort && params.sort !== "all" ? { sort: params.sort } : {}),
    ...(params.all === "1" ? { all: "1" } : {}),
  };

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  // The whole active set, once. A few hundred rows is small enough that filtering and counting in
  // memory is simpler and cheaper than a round-trip per filter, and it keeps every count in the
  // sidebar guaranteed consistent with the rows beside it.
  // In the batch below rather than before it. On its own it was a sequential round trip — about
  // 60ms to Supabase — bought for nothing, since it does not depend on any of them.
  const businessesQuery = supabase
    .from("businesses")
    .select(
      "id, display_name, city, state, website_status, tier, problem_score, intent_score, route, route_reason, claim_status, claimed_by, passed_gate, manual_review_status, origin, import_batch_id, category, subcategory, category_rule_id, scored_at",
    )
    .eq("status", "active")
    .order("tier", { ascending: true, nullsFirst: false })
    .order("problem_score", { ascending: false, nullsFirst: false });

  const [{ data: all, error }, { data: contactRows }, { data: spendTotal }, { data: batchRows }, social] =
    await Promise.all([
    businessesQuery,
    supabase
      .from("field_metadata")
      .select("business_id, field_name")
      .in("field_name", ["contact_email", "contact_phone_web"])
      // Explicit, because PostgREST caps an unbounded select at 1,000 rows and reports the
      // truncation as an ordinary success. Two fields per business crosses that at roughly 500
      // businesses, which is inside the range this list is built for.
      .limit(20000),
    // A sum, not 315 rows fetched and added up in JavaScript. The database was always going to be
    // better at this, and the row count only grows.
    supabase.from("provider_calls").select("total:cost_cents.sum()").single(),
    supabase.from("import_batches").select("id, filename").eq("status", "imported"),
    // Instagram, ads and review counts — the columns, two of the filters, and the row tinting. The
    // same loader the buy screen uses, so neither can be looking at a different set of facts.
    loadSocialFacts(supabase),
  ]);

  const batchNames = new Map((batchRows ?? []).map((b) => [b.id, b.filename ?? "an uploaded file"]));

  const contactable = new Map<string, { email: boolean; phone: boolean }>();
  for (const row of contactRows ?? []) {
    const existing = contactable.get(row.business_id) ?? { email: false, phone: false };
    if (row.field_name === "contact_email") existing.email = true;
    if (row.field_name === "contact_phone_web") existing.phone = true;
    contactable.set(row.business_id, existing);
  }
  // numeric arrives as a string from PostgREST; Number() rather than `+`, which would concatenate.
  const spentCents = Number((spendTotal as { total?: number | string } | null)?.total ?? 0);

  const rows = all ?? [];

  /**
   * "Never analysed" means the same thing here as it does to the task that fixes it.
   *
   * It did not, and the consequence was a banner that could never be cleared. This page counted
   * businesses with no `website_status_reason` field, which the **crawler** writes; the task
   * selects businesses with no `findings` row. Ten businesses had findings but no website to crawl,
   * so they satisfied the page's definition and not the task's: the banner said "10 businesses have
   * never been analysed" and the button ran, reported "Read 0 websites", and left the banner exactly
   * where it was. Pressing it again would do the same thing forever.
   *
   * `scored_at` is written whenever findings are scored, and was verified against the task's own
   * definition across all 422 active businesses with zero disagreement in either direction. Using a
   * column already on the row also removes a twenty-thousand-row query.
   */
  const neverAnalysed = rows.filter((b) => b.scored_at === null);

  const shown = rows.filter((b) =>
    matchesFilters(b as unknown as LeadRow, { ...current, view }, { social, userId: claims?.sub ?? null }),
  );

  /**
   * Grouped by colour, when asked.
   *
   * The rows arrive sorted by priority, which is the right default — the best call is the first
   * row. Grouping by what is missing answers a different question: "show me every business with an
   * audience and no website, together", which is how a morning of similar calls actually gets
   * planned.
   *
   * Sorted, not filtered. Every business stays on the list; only the order changes.
   */
  if (current.sort === "colour") {
    const rank: Record<string, number> = {
      "nothing-but-demand": 0,
      "no-website": 1,
      "no-instagram": 2,
      "has-both": 3,
    };
    shown.sort((a, b) => {
      // Untinted last: "nobody knows yet" is not a group to work through, it is a gap in what we
      // have looked at.
      const ra = rank[leadTint(a as unknown as LeadRow, social) ?? ""] ?? 4;
      const rb = rank[leadTint(b as unknown as LeadRow, social) ?? ""] ?? 4;
      if (ra !== rb) return ra - rb;
      // Inside a colour, the original order stands — priority first.
      return 0;
    });
  }

  // Every count in the sidebar is "how many would I see if I clicked this", measured against the
  // filters already on — not a global total. A count that ignores the current selection sends the
  // operator to an empty list, which is the specific way faceted filters usually lie.
  const ctx = { social, userId: claims?.sub ?? null };

  /**
   * The sidebar counts, from the same predicate as the rows and the buy screen.
   *
   * This was a third copy of the filter rules — the list had one, the counts had another, and the
   * buy screen had a third that had already drifted twice. Three copies of one rule is three
   * chances for the number beside a filter to disagree with the list it produces, and the operator
   * has no way to tell which one is lying.
   *
   * "all" is how a cleared filter arrives from a toggle link, and means the same as absent.
   */
  const withinView = rows.filter((b) =>
    matchesFilters(b as unknown as LeadRow, { view, q: current.q, claimed: current.claimed }, ctx),
  );

  const countIf = (extra: Partial<Filters>) => {
    const f: Filters = { ...current, ...extra, view };
    for (const key of Object.keys(f) as (keyof Filters)[]) {
      if (f[key] === "all") delete f[key];
    }
    return rows.filter((b) => matchesFilters(b as unknown as LeadRow, f, ctx)).length;
  };

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
        {/* The whole-list buttons redirect with `saved`, which this page did not render — so
            pressing "Read them page by page" produced a redirect and complete silence. */}
        {params.saved && <Banner tone="good">{decodeURIComponent(params.saved)}</Banner>}
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
              <div style={{ fontSize: 16.5, fontWeight: 700, marginBottom: 3 }}>
                {neverAnalysed.length} businesses have never been analysed
              </div>
              <div style={{ fontSize: 15, color: "var(--ink-3)", lineHeight: 1.5 }}>
                Their websites have not been read yet, so they have no score. That is not a verdict
                about them — nobody has looked. <strong>It costs nothing.</strong>
              </div>
            </div>
            <form action={analyseUnscored}>
              <input type="hidden" name="back" value={href(current, {})} />
              <button className="btn" type="submit" style={{ padding: "9px 16px", fontSize: 16 }}>
                Analyse them now
              </button>
            </form>
          </div>
        )}

        {/*
          * Every whole-list job, with a button, and each one saying what it costs.
          *
          * Two of these had no way to be started from anywhere in the product: reading websites
          * page by page could only be done one business at a time from its own record, and
          * re-scoring could not be done at all. Both tasks existed and worked. The operator's
          * report was the general form of it - the things that were built should have buttons,
          * and the buttons should work.
          *
          * Each says what it costs and who bills it, because a button that might spend money and
          * does not say so is a button nobody can press with confidence.
          */}
        <Panel
          title="Run something over the whole list"
          hint="Each of these works through every business. Progress appears at the top of the screen and keeps updating while you work."
          tone="brand"
        >
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 1, background: "var(--rule)" }}>
            {WHOLE_LIST_JOBS.map((job) => (
              <div key={job.title} style={{ background: "var(--surface)", padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 16.5, fontWeight: 750, color: "var(--ink)" }}>{job.title}</div>
                  <div style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.55, marginTop: 4 }}>{job.what}</div>
                </div>
                <div style={{ marginTop: "auto", display: "flex", alignItems: "flex-end", gap: 14, flexWrap: "wrap" }}>
                  <form action={job.action}>
                    <button className={job.primary ? "btn" : "btn-2 btn"} type="submit" data-tip={job.tip}>
                      {job.button}
                    </button>
                  </form>
                  <span style={{ marginLeft: "auto" }}>
                    <Price cents={job.cents} what={job.buys} platform={job.platform} free={job.cents === 0} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/*
          * The search form itself, declared outside the table so the two do not nest.
          *
          * The table lives inside a GET form that posts ticked ids to the buy screen, and HTML
          * forbids a form inside a form. The `form=` attribute is the way out: the input sits
          * visually in the table header and belongs to this form, which lives out here.
          *
          * Every other active filter rides along as a hidden input, so searching inside "Priority 1,
          * running ads" narrows that set instead of quietly discarding it.
          */}
        <form id="lead-search" method="get" action="/records" />
        {Object.entries(current)
          .filter(([key]) => key !== "q")
          .map(([key, value]) => (
            <input key={key} type="hidden" form="lead-search" name={key} value={String(value)} />
          ))}

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
              <span style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                Filters
              </span>
              {anyFilter && (
                <Link
                  href={href({ ...(view !== "ready" ? { view } : {}) }, {})}
                  style={{ marginLeft: "auto", fontSize: 14 }}
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

            {/*
              * Who has claimed what.
              *
              * A lead could be claimed and then not found again: the badge appeared on the row, and
              * there was no way to ask "which ones are mine?" without reading the whole list. That
              * makes claiming a note to nobody.
              */}
            <FilterSection title="Claimed" hint="Who has put their name on a lead.">
              <FilterOption
                label="Mine"
                explain="Leads you claimed yourself"
                count={rows.filter((b) => b.claimed_by === claims?.sub).length}
                href={toggle(current, "claimed", "me")}
                active={current.claimed === "me"}
                accent
              />
              <FilterOption
                label="Claimed by anyone"
                explain="Someone is already on it"
                count={rows.filter((b) => b.claim_status === "claimed").length}
                href={toggle(current, "claimed", "anyone")}
                active={current.claimed === "anyone"}
              />
              <FilterOption
                label="Nobody has claimed"
                explain="Free to pick up"
                count={rows.filter((b) => b.claim_status !== "claimed").length}
                href={toggle(current, "claimed", "nobody")}
                active={current.claimed === "nobody"}
              />
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
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.4 }}>
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
                <div style={{ fontSize: 15, color: "var(--ink-2)", marginBottom: 6 }}>
                  {batchNames.get(current.batch) ?? "an uploaded file"}
                </div>
                <Link href={href(current, { batch: "" })} style={{ fontSize: 14 }}>
                  Show every file
                </Link>
              </FilterSection>
            )}

            <div style={{ padding: "12px 16px", fontSize: 14.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
              Spent so far <strong style={{ color: "var(--ink)" }}>${(spentCents / 100).toFixed(2)}</strong> on paid
              lookups. Reading websites and scoring are free.
              {" "}
              <Link href="/records/imports">Files you imported</Link>
            </div>
          </aside>

          <div style={{ minWidth: 0 }}>
            {current.from === "imported" && (
              <div style={{ ...PANEL, padding: "12px 16px", borderColor: "var(--accent)", fontSize: 15, lineHeight: 1.55 }}>
                <strong>These came from a file, so two checks cannot run on them.</strong> A
                spreadsheet carries no Google listing, so there is no way to read their reviews,
                their rating, or how they rank in local search. Their Problem score is built from{" "}
                <strong>four areas instead of six</strong>.
              </div>
            )}

            {error && <p style={{ color: "var(--warn-ink)" }}>Could not load the list: {error.message}</p>}

            {!error && shown.length === 0 && (
              <div style={{ ...PANEL, padding: "56px 24px", textAlign: "center", color: "var(--ink-3)" }}>
                <h3 style={{ color: "var(--ink)", fontSize: 20.5, margin: "0 0 8px" }}>Nothing matches</h3>
                <p style={{ maxWidth: 460, margin: "0 auto 14px", fontSize: 15.5 }}>
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
              <form action={getPaidDataForTicked} style={{ ...PANEL, marginBottom: 0, overflowX: "auto" }}>
                {Object.entries(current).map(([key, value]) => (
                  <input key={key} type="hidden" name={`f_${key}`} value={value} />
                ))}

                {/*
                  * Search, as a GET form.
                  *
                  * There was no way to find a named business anywhere in the product - the only
                  * route to one was to filter the list down and read it. A GET form needs no
                  * JavaScript: the browser puts the box's contents in the query string and the
                  * server filters on it, which is the same mechanism every filter link beside it
                  * already uses.
                  *
                  * The other filters travel with it as hidden inputs, so searching inside "Priority
                  * 1, running ads" narrows that set rather than silently throwing it away.
                  */}
                <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--rule)", flexWrap: "wrap" }}>
                  <input
                    type="search"
                    name="q"
                    form="lead-search"
                    defaultValue={current.q ?? ""}
                    placeholder="Search a business by name, town or category"
                    className="inp"
                    style={{ flex: "1 1 320px", maxWidth: 520 }}
                    aria-label="Search businesses"
                  />
                  <button className="btn" type="submit" form="lead-search" data-tip="Find businesses whose name, town or category contains what you typed. Your other filters stay on.">
                    Search
                  </button>
                  {current.q ? (
                    <Link href={href(current, { q: "" })} className="btn-2 btn">
                      Clear &ldquo;{current.q}&rdquo;
                    </Link>
                  ) : null}
                </div>

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
                  <span style={{ fontSize: 16, fontWeight: 700 }}>
                    {shown.length} {shown.length === 1 ? "business" : "businesses"}
                  </span>
                  {current.q ? (
                    <span style={{ fontSize: 15, color: "var(--ink)", fontWeight: 650 }}>
                      matching &ldquo;{current.q}&rdquo;
                    </span>
                  ) : null}
                  <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                    {view === "ready" ? "worth calling" : view === "unanalysed" ? "not analysed yet" : "in total"}
                  </span>
                  {/*
                    * The colours, as buttons rather than as a caption.
                    *
                    * They were a block of four explanations wedged between the toolbar and the
                    * column headings, which is the one place on this screen where the eye is
                    * already busiest — the operator's report was that it was confusing there, and
                    * it was: a legend looks like a heading when it sits where headings go.
                    *
                    * Here each colour is a swatch you can press to group the list by it, so the key
                    * and the control are the same object. Hovering names the rule in full; nothing
                    * has to be read to use the list.
                    */}
                  <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14.5, color: "var(--ink-2)" }}>Colours:</span>
                    {ROW_TINT_MEANING.map((m) => (
                      <Link
                        key={m.has + m.hasNot}
                        href={toggle(current, "sort", "colour")}
                        title={`${m.short} — ${m.why}`}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "3px 9px 3px 5px",
                          borderRadius: 99,
                          border: "1px solid var(--rule-2)",
                          background: current.sort === "colour" ? m.tint : "var(--surface)",
                          textDecoration: "none",
                          fontSize: 14,
                          color: "var(--ink)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <span
                          aria-hidden
                          style={{
                            width: 15,
                            height: 15,
                            borderRadius: 4,
                            background: m.tint,
                            border: "1px solid var(--rule-2)",
                          }}
                        />
                        {m.short}
                      </Link>
                    ))}
                    <span style={{ fontSize: 14, color: "var(--ink-2)" }}>
                      {current.sort === "colour" ? (
                        <Link href={href(current, { sort: "all" })}>back to priority order</Link>
                      ) : (
                        "click one to group the list by colour"
                      )}
                    </span>
                  </span>

                  <span style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {/* Zero-JavaScript select-all: a link that re-renders every row already ticked. */}
                    <Link href={href(current, { all: current.all === "1" ? "" : "1" })} style={{ fontSize: 15 }}>
                      {current.all === "1" ? `Untick all ${shown.length}` : `Tick all ${shown.length}`}
                    </Link>
                    <a href={`/records/export${href(current, {}).replace("/records", "")}`} style={{ fontSize: 15 }}>
                      Download CSV
                    </a>
                    {/* Hidden in the "not analysed" view on purpose. The confirm screen rebuilds
                        the selection from the filters it is handed, and "has never been analysed"
                        is not a column it can filter on — it would silently price a different set
                        of businesses than the one on screen. Ticking rows still works there. */}
                    {view !== "unanalysed" && (
                      <button
                        className="btn-2 btn"
                        type="submit"
                        formAction={getPaidDataForFiltered}
                        style={{ padding: "6px 12px", fontSize: 15 }}
                        data-tip="Opens a confirm screen that prices extra data for every business the filters are showing. Nothing is bought until you confirm there."
                      >
                        Get paid data for all {shown.length}
                      </button>
                    )}
                    <button
                      className="btn tip-right"
                      type="submit"
                      style={{ padding: "6px 12px", fontSize: 15 }}
                      data-tip="Opens a confirm screen that prices extra data for the rows you ticked. Nothing is bought until you confirm there."
                    >
                      Get paid data for ticked
                    </button>

                    {/*
                      * Reads only the ticked businesses.
                      *
                      * `formAction` rather than a form of its own, because a checkbox belongs to
                      * exactly one form and these ticks already belong to the buy form around the
                      * table. Overriding where this one button submits is what lets the same ticks
                      * drive two different things — which is what the operator asked for: the
                      * whole-list button at the top does everything, this does only what they chose.
                      *
                      * Free of any provider charge except the model's read, the same 0.36¢ a site
                      * the top button quotes.
                      */}
                    <button
                      type="submit"
                      formAction={auditTickedWebsites}
                      style={{ padding: "6px 12px", fontSize: 15 }}
                      className="btn-2 btn tip-right"
                      data-tip="Opens the ticked businesses' websites in a real browser, keeps screenshots, finds social links and re-scores them. About 0.36¢ a site."
                    >
                      Read ticked page by page
                    </button>
                  </span>
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1290, tableLayout: "fixed" }}>
                  <thead style={{ background: "var(--surface-2)" }}>
                    <tr>
                      {/*
                        * Percentages for the columns that hold sentences, pixels for the ones that
                        * hold a fixed thing.
                        *
                        * "Business" had no width at all, so it absorbed every spare pixel — on a
                        * wide screen it ran to nearly a thousand pixels for a name and a town while
                        * "What to sell them", which is a paragraph, was squeezed into 230. The
                        * columns now grow and shrink together instead of one of them taking
                        * whatever the others left.
                        */}
                      <Th label="" width={40} />
                      <Th label="No." explain="1 is best" width={62} />
                      <Th label="Business" explain="Click to open the full report" width="21%" />
                      <Th label="What to sell them" explain="The area with the most wrong" width="23%" />
                      <Th label="Scores" explain="Problem: how much is wrong. Signals: do they pay?" width={168} />
                      <Th label="Category" explain="From your own rules" width="13%" />
                      <Th label="Instagram" explain="Followers, and whether they advertise" width="12%" />
                      <Th label="Contact" explain="What we have to reach them" width="11%" />
                      <Th label="" explain="claim" width={96} />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((b) => {
                      const isMine = claims?.sub && b.claimed_by === claims.sub;
                      // Same definition as the banner and the task. See the note beside
                      // `neverAnalysed` for why there is only one of these now.
                      const seen = b.scored_at !== null;
                      const contact = contactable.get(b.id);
                      const has = [contact?.email ? "email" : null, contact?.phone ? "phone" : null].filter(Boolean);
                      // How this row is tinted. See leadTint in lib/lead-filters.ts.
                      const tint = leadTint(b as unknown as LeadRow, social);
                      return (
                        <tr key={b.id} style={tint ? { background: ROW_TINT[tint] } : undefined}>
                          <td style={TD}>
                            <input
                              type="checkbox"
                              name="id"
                              value={b.id}
                              // Ticked by the "select all" link in the header, which reloads with
                              // `all=1` rather than running a script. See the Filters type.
                              defaultChecked={current.all === "1"}
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
                            <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 2 }}>
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
                                <div style={{ fontWeight: 600, fontSize: 15 }}>{ROUTE_LABELS[b.route] ?? b.route}</div>
                                {b.route_reason && (
                                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.4 }}>
                                    {b.route_reason}
                                  </div>
                                )}
                              </>
                            ) : (
                              <span style={{ color: "var(--ink-3)", fontSize: 14.5 }}>
                                {seen ? "Nothing solid enough" : "Not analysed yet"}
                              </span>
                            )}
                          </td>
                          <td style={TD}>
                            {b.problem_score === null && b.intent_score === null ? (
                              <span style={{ color: "var(--ink-3)", fontSize: 14.5 }}>
                                {seen ? "Not scored" : "Not analysed"}
                              </span>
                            ) : (
                              <ScoreBars problem={b.problem_score} intent={b.intent_score} />
                            )}
                          </td>
                          <td style={TD}>
                            {b.category ? (
                              <>
                                <div style={{ fontSize: 15 }}>{b.category}</div>
                                {b.subcategory ? (
                                  <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>{b.subcategory}</div>
                                ) : null}
                              </>
                            ) : (
                              <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>no rule matched</span>
                            )}
                          </td>
                          <td style={TD}>
                            {(() => {
                              const s = social.get(b.id);
                              if (!s || (s.followers === null && s.adsRunning === null && !s.handle)) {
                                return <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>not looked up</span>;
                              }
                              return (
                                <>
                                  <div style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>
                                    {s.followers === null ? "—" : `${s.followers.toLocaleString()} followers`}
                                  </div>
                                  {s.adsRunning !== null ? (
                                    <div
                                      style={{
                                        fontSize: 14.5,
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
                              <span style={{ fontSize: 14.5 }}>{has.join(" + ")}</span>
                            ) : (
                              <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>listing only</span>
                            )}
                          </td>
                          <td style={TD}>
                            {b.claim_status === "unclaimed" ? (
                              <button
                                className="btn-2 btn"
                                type="submit"
                                formAction={claimBusiness.bind(null, b.id)}
                                style={{ padding: "5px 11px", fontSize: 14.5 }}
                              >
                                Claim
                              </button>
                            ) : isMine ? (
                              <button
                                className="btn-2 btn"
                                type="submit"
                                formAction={releaseClaim.bind(null, b.id)}
                                style={{ padding: "5px 11px", fontSize: 14.5 }}
                              >
                                Release
                              </button>
                            ) : (
                              <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>Taken</span>
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
