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
  /** Which of the operator's ICPs a business matched. */
  icp?: string;
  /** Google reviews: "none", or a floor such as "20". */
  reviews?: string;
  /** A town or state. */
  where?: string;

  /** Which ICP assigned it — the link from the ICPs screen. */
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
  /** "1" while step 3 is open. It rides in on a GET submit of the table, which carries the ticks. */
  act?: string;
  /** Which page of the list. Not a filter: changing any filter goes back to the first page. */
  page?: string;
  /**
   * The ticked businesses, put here by that same submit. One value per tick.
   *
   * Deliberately on PageParams rather than on Filters: a selection is not a filter, and href()
   * walks Filters to build every link on the page — a tick that leaked in there would follow the
   * operator around the list for ever.
   */
  id?: string | string[];
  /** Set after a purchase or an analysis is enqueued, so the operator sees what they started. */
  bought?: string;
  /** Set after anything else that succeeded. Two names for one idea, kept because both are in use. */
  saved?: string;
  /** Set when starting something failed — shown rather than swallowed. */
  error?: string;
}

/**
 * One filter, as a menu that opens over the page.
 *
 * `<details>` and nothing else: it opens, closes, and closes on Escape without a line of
 * JavaScript, and because the panel is absolutely positioned the table below does not move when
 * one is opened. The summary carries the chosen value, so a closed menu still says what it is
 * doing.
 */
function Menu({
  label,
  value,
  right,
  children,
}: {
  label: string;
  value?: string | null;
  right?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className={right ? "fmenu fmenu-right" : "fmenu"}>
      <summary data-on={value ? "1" : undefined}>
        {label}
        {value ? <>: {value}</> : null}
      </summary>
      <div className="fmenu-panel">{children}</div>
    </details>
  );
}

/** One thing the operator can do, with what it costs and who bills it stated beside it. */
function ActionRow({
  title,
  what,
  cost,
  who,
  children,
  off,
}: {
  title: string;
  what: string;
  cost: string;
  who: string;
  children: React.ReactNode;
  /**
   * Why a button in this row cannot be pressed right now, said next to the button.
   *
   * The reason used to be stated once, at the top of the panel. Scrolled past, the buttons below
   * simply looked broken — which is exactly how the operator read them.
   */
  off?: React.ReactNode;
}) {
  return (
    <div style={{ border: "1.5px solid var(--rule)", borderRadius: 10, padding: "13px 15px", display: "grid", gap: 9 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16.5, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.45 }}>{what}</div>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{cost}</div>
          <div style={{ fontSize: 13.5, color: "var(--ink-3)" }}>{who}</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>{children}</div>
      {off ? (
        <div style={{ fontSize: 14, color: "var(--warn-ink)", lineHeight: 1.45 }}>
          {off}
        </div>
      ) : null}
    </div>
  );
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

  /**
   * The businesses ticked when step 3 was opened.
   *
   * Opening step 3 is a GET submit of the table itself, so the ticks arrive here as `id` in the
   * query string. That is the only way a no-JavaScript page can carry a selection anywhere: the
   * ticks belong to the form, and a link does not.
   */
  const tickedIds = (Array.isArray(params.id) ? params.id : params.id ? [params.id] : []).filter(Boolean);
  const pageNo = Math.max(1, Math.floor(Number(params.page) || 1));
  const view = params.view === "everything" ? "everything" : params.view === "unanalysed" ? "unanalysed" : "ready";
  const current: Filters = {
    ...(view !== "ready" ? { view } : {}),
    ...(params.tier && params.tier !== "all" ? { tier: params.tier } : {}),
    ...(params.route && params.route !== "all" ? { route: params.route } : {}),
    ...(params.website && params.website !== "all" ? { website: params.website } : {}),
    ...(params.from && params.from !== "all" ? { from: params.from } : {}),
    ...(params.batch ? { batch: params.batch } : {}),
    ...(params.icp && params.icp !== "all" ? { icp: params.icp } : {}),
    ...(params.reviews && params.reviews !== "all" ? { reviews: params.reviews } : {}),
    ...(params.where && params.where !== "all" ? { where: params.where } : {}),
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
      "id, display_name, city, state, website_status, tier, problem_score, intent_score, route, route_reason, claim_status, claimed_by, passed_gate, manual_review_status, origin, import_batch_id, icp_name, icp_id, scored_at",
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

  /**
   * The towns and states actually on the list, commonest first.
   *
   * Built from the rows rather than from a fixed list of places, for the same reason the ICP list
   * is: a place nobody in the list is in would be a filter that can only ever return nothing.
   */
  const placeCounts = new Map<string, number>();
  for (const b of withinView) {
    for (const part of [b.city, b.state]) {
      const name = (part ?? "").trim();
      if (name.length > 0) placeCounts.set(name, (placeCounts.get(name) ?? 0) + 1);
    }
  }
  const PAGE_SIZE = 50;
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const safePage = Math.min(pageNo, pageCount);
  const pageRows = shown.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const firstShown = shown.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const lastShown = (safePage - 1) * PAGE_SIZE + pageRows.length;
  const pageHref = (n: number) => {
    const base = href(current, {});
    return `${base}${base.includes("?") ? "&" : "?"}page=${n}`;
  };

  const places = [...placeCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  const anyFilter = Boolean(
    current.tier ||
      current.route ||
      current.website ||
      current.from ||
      current.batch ||
      current.icp ||
      current.reviews ||
      current.where ||
      current.rule ||
      current.ads ||
      current.minFollowers,
  );

  // Built from what is actually on the list rather than from the ICPs table, so an ICP with
  // no businesses in it never appears as a filter that leads nowhere.
  const icpCounts = new Map<string, number>();
  for (const b of withinView) {
    if (!b.icp_name) continue;
    icpCounts.set(b.icp_name, (icpCounts.get(b.icp_name) ?? 0) + 1);
  }
  const icpList = [...icpCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  /**
   * Every choice that is on, each removable on its own.
   *
   * The operator could previously see *that* a list was filtered only by reading down the sidebar
   * for highlighted rows. A chip says what is on in words, and takes exactly that one thing off
   * again — which is the difference between a state you can see and a state you have to hunt for.
   */
  const chips: { label: string; remove: string }[] = [];
  if (view !== "ready")
    chips.push({
      label: view === "unanalysed" ? "Not analysed yet" : "Everything",
      remove: href(current, { view: "ready" }),
    });
  if (current.claimed)
    chips.push({
      label:
        current.claimed === "me" ? "Mine" : current.claimed === "anyone" ? "Claimed by anyone" : "Nobody has claimed",
      remove: href(current, { claimed: "" }),
    });
  if (current.tier) chips.push({ label: `Priority ${current.tier}`, remove: href(current, { tier: "" }) });
  if (current.route)
    chips.push({ label: ROUTE_LABELS[current.route] ?? current.route, remove: href(current, { route: "" }) });
  if (current.website)
    chips.push({ label: WEBSITE_LABELS[current.website] ?? current.website, remove: href(current, { website: "" }) });
  if (current.icp) chips.push({ label: `ICP: ${current.icp}`, remove: href(current, { icp: "" }) });
  if (current.reviews)
    chips.push({
      label: current.reviews === "none" ? "No reviews at all" : `${current.reviews}+ Google reviews`,
      remove: href(current, { reviews: "" }),
    });
  if (current.where) chips.push({ label: `In ${current.where}`, remove: href(current, { where: "" }) });
  if (current.ads)
    chips.push({ label: current.ads === "yes" ? "Running ads now" : "Not running ads", remove: href(current, { ads: "" }) });
  if (current.minFollowers)
    chips.push({
      label: `${Number(current.minFollowers).toLocaleString()}+ followers`,
      remove: href(current, { minFollowers: "" }),
    });
  if (current.from)
    chips.push({
      label: current.from === "discovered" ? "Found by search" : current.from === "imported" ? "From a file" : "Added by hand",
      remove: href(current, { from: "" }),
    });
  if (current.batch)
    chips.push({ label: batchNames.get(current.batch) ?? "One file", remove: href(current, { batch: "" }) });
  if (current.rule) chips.push({ label: "One ICP rule", remove: href(current, { rule: "" }) });
  if (current.q) chips.push({ label: `“${current.q}”`, remove: href(current, { q: "" }) });
  if (current.sort === "colour") chips.push({ label: "Grouped by colour", remove: href(current, { sort: "" }) });
  const inNoIcp = withinView.filter((b) => !b.icp_name).length;
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
          Your call list, best call first. Three steps: choose businesses, tick the ones you want,
          then act on them.
        </>
      }
      actions={
        // One menu rather than three buttons: all three answer the same question — how do I get
        // more businesses in — and the header is not where the eye should be deciding between them.
        <details className="fmenu fmenu-right">
          <summary className="btn" style={{ border: 0 }}>
            Add businesses
          </summary>
          <div className="fmenu-panel" style={{ padding: 8, display: "grid", gap: 2, minWidth: 300 }}>
            {[
              { href: "/search", label: "Find businesses", what: "Search Google Maps for one of your ICPs" },
              { href: "/records/import", label: "Import a list", what: "Upload a spreadsheet you already have" },
              { href: "/records/new", label: "Add one by hand", what: "Type in a single business" },
            ].map((item) => (
              <Link key={item.href} href={item.href} className="menu-item">
                <strong>{item.label}</strong>
                <span>{item.what}</span>
              </Link>
            ))}
          </div>
        </details>
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

        {/*
          ---- The list, as three steps ------------------------------------------------

          The operator's report, in their words: the filters were half the confusion and the row of
          whole-list buttons was the other half. Both were true of the old shape — a column of
          permanently open filter sections down the left, and three separate groups of buttons
          along the top with no order between them.

          So the page reads 1, 2, 3 now. Choose who you are looking at, tick the ones you want, act
          on them — and the width of the table no longer changes when a filter panel opens, because
          the panels float over the page instead of sitting beside it.
        */}
        <div style={{ display: "grid", gap: 16 }}>
          <section style={{ ...PANEL, marginBottom: 0, padding: "16px 18px", display: "grid", gap: 13 }}>
            <div className="step-head">
              <span className="step-num">1</span>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>Choose which businesses</div>
                <div style={{ fontSize: 14.5, color: "var(--ink-2)" }}>
                  Pick from the menus. Every choice shows as a chip below, so you always see what is
                  on — and the table below never moves.
                </div>
              </div>
            </div>

            {/*
             * Search, as a GET form.
             *
             * A GET form needs no JavaScript: the browser puts the box's contents in the query
             * string and the server filters on it, which is the same mechanism every filter menu
             * beside it already uses.
             *
             * The other filters travel with it as hidden inputs, so searching inside "Priority 1,
             * running ads" narrows that set rather than silently throwing it away.
             */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="search"
                name="q"
                form="lead-search"
                defaultValue={current.q ?? ""}
                placeholder="Search a business by name, town or ICP"
                className="inp"
                style={{ flex: "1 1 320px", maxWidth: 520 }}
                aria-label="Search businesses"
              />
              <button className="btn" type="submit" form="lead-search" data-tip="Find businesses whose name, town or ICP contains what you typed. Your other filters stay on.">
                Search
              </button>
              {current.q ? (
                <Link href={href(current, { q: "" })} className="btn-2 btn">
                  Clear &ldquo;{current.q}&rdquo;
                </Link>
              ) : null}
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>

            <Menu label="Show" value={view === "ready" ? "Worth calling" : view === "unanalysed" ? "Not analysed" : "Everything"}>
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
            </Menu>

            {/*
              * Who has claimed what.
              *
              * A lead could be claimed and then not found again: the badge appeared on the row, and
              * there was no way to ask "which ones are mine?" without reading the whole list. That
              * makes claiming a note to nobody.
              */}
            <Menu label="Claimed" value={current.claimed === "me" ? "Mine" : current.claimed === "anyone" ? "Anyone" : current.claimed === "nobody" ? "Nobody" : null}>
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

            </Menu>

            <Menu label="Priority" value={current.tier ?? null}>
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

            </Menu>

            <Menu label="What to sell" value={current.route ? ROUTE_LABELS[current.route] ?? current.route : null}>
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

            </Menu>

            <Menu label="Website" value={current.website ? WEBSITE_LABELS[current.website] ?? current.website : null}>
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

            </Menu>

            {icpList.length > 0 && (
              <Menu label="ICP" value={current.icp ?? null}>
              <FilterSection title="ICP" hint="Who you want to sell to. You write these on the ICPs page.">
                {icpList.map((c) => (
                  <FilterOption
                    key={c.name}
                    label={c.name}
                    count={c.count}
                    href={toggle(current, "icp", c.name)}
                    active={current.icp === c.name}
                  />
                ))}
                {inNoIcp > 0 && (
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.4 }}>
                    {inNoIcp} match no ICP yet. <Link href="/icps">Write one</Link>.
                  </div>
                )}
              </FilterSection>
              </Menu>
            )}

            {/* Reviews and where, both new. Both are facts an ICP can ask about, so the list can
                ask about them too — and both refuse when the answer is unknown rather than
                counting a business nobody has looked up. */}
            <Menu label="Reviews" value={current.reviews === "none" ? "None at all" : current.reviews ? `${current.reviews}+` : null}>
              <FilterSection title="Google reviews" hint="Only counts businesses whose listing has been bought.">
                <FilterOption
                  label="50 or more"
                  explain="Proven demand"
                  count={countIf({ reviews: "50" })}
                  href={toggle(current, "reviews", "50")}
                  active={current.reviews === "50"}
                  accent
                />
                <FilterOption
                  label="20 or more"
                  count={countIf({ reviews: "20" })}
                  href={toggle(current, "reviews", "20")}
                  active={current.reviews === "20"}
                />
                <FilterOption
                  label="1 or more"
                  count={countIf({ reviews: "1" })}
                  href={toggle(current, "reviews", "1")}
                  active={current.reviews === "1"}
                />
                <FilterOption
                  label="None at all"
                  explain="Looked up, and has none"
                  count={countIf({ reviews: "none" })}
                  href={toggle(current, "reviews", "none")}
                  active={current.reviews === "none"}
                />
                <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.45 }}>
                  A business whose Google listing nobody has bought has no answer here, so it is left
                  out of all four rather than counted as having none.
                </div>
              </FilterSection>
            </Menu>

            <Menu label="Where" value={current.where ?? null}>
              <FilterSection title="Town or state" hint="Matched against both, so “Texas” and “Dallas” both work.">
                <div style={{ display: "grid", gap: 7 }}>
                  {places.slice(0, 10).map((place) => (
                    <FilterOption
                      key={place.name}
                      label={place.name}
                      count={place.count}
                      href={toggle(current, "where", place.name)}
                      active={current.where === place.name}
                    />
                  ))}
                </div>
              </FilterSection>
            </Menu>

            {anySocial && (
              <Menu label="Instagram &amp; ads" value={current.ads === "yes" ? "Running ads" : current.ads === "no" ? "No ads" : current.minFollowers ? `${Number(current.minFollowers).toLocaleString()}+ followers` : null}>
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
              </Menu>
            )}

            <Menu label="Where from" value={current.from === "discovered" ? "Search" : current.from === "imported" ? "A file" : current.from === "manual" ? "By hand" : null}>
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

            </Menu>

            {current.batch && (
              <Menu label="One file" value={batchNames.get(current.batch) ?? "a file"}>
              <FilterSection title="One file" hint="You followed a link from the imported files page.">
                <div style={{ fontSize: 15, color: "var(--ink-2)", marginBottom: 6 }}>
                  {batchNames.get(current.batch) ?? "an uploaded file"}
                </div>
                <Link href={href(current, { batch: "" })} style={{ fontSize: 14 }}>
                  Show every file
                </Link>
              </FilterSection>
              </Menu>
            )}

            {/*
              Two filters that exist and cannot be used.

              The operator asked for exactly this rather than for them to be hidden: a filter that
              is missing looks like something nobody thought of, one that is switched off with a
              reason looks like a decision. Nobody publishes what a small private business earns or
              spends, so there is nothing to filter on today.
            */}
            <span
              className="fmenu-off"
              tabIndex={0}
              data-tip="Switched off: no provider publishes what a small business spends, and nothing on their own website says it. Filtering on it would mean inventing the number. See Data & spend."
            >
              Budget <b>off</b>
            </span>
            <span
              className="fmenu-off"
              tabIndex={0}
              data-tip="Switched off: revenue for small private businesses is not published anywhere. It can be bought per business from a data provider later, and the price will be shown before anything is spent."
            >
              Revenue <b>off</b>
            </span>
            </div>

            {/* What is on, as chips. Each one removes only itself; Clear all removes the lot. */}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                borderTop: "1px solid var(--rule-2)",
                paddingTop: 12,
              }}
            >
              <span style={{ fontSize: 14.5, fontWeight: 700 }}>Showing:</span>
              {chips.length === 0 ? (
                <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                  everything worth calling — no filters on
                </span>
              ) : (
                chips.map((chip) => (
                  <Link key={chip.label} href={chip.remove} className="fchip" title={`Remove: ${chip.label}`}>
                    {chip.label} <span aria-hidden>✕</span>
                  </Link>
                ))
              )}
              {chips.length > 1 && (
                <Link href={href({ ...(view !== "ready" ? { view } : {}) }, {})} style={{ fontSize: 14.5 }}>
                  Clear all
                </Link>
              )}
              <span style={{ marginLeft: "auto", fontSize: 16, fontWeight: 700 }}>
                {shown.length} of {rows.length} businesses
              </span>
            </div>
          </section>

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
              <>
              <form id="lead-table" action={getPaidDataForTicked} style={{ ...PANEL, marginBottom: 0, overflowX: "auto" }}>
                <div className="step-head" style={{ padding: "14px 16px 0" }}>
                  <span className="step-num">2</span>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>Tick the ones you want</div>
                    <div style={{ fontSize: 14.5, color: "var(--ink-2)" }}>
                      Or tick none — step 3 can act on every business shown instead.
                    </div>
                  </div>
                </div>
                {Object.entries(current).map(([key, value]) => (
                  <input key={key} type="hidden" name={`f_${key}`} value={value} />
                ))}
                {/*
                  The same filters again, under their own names.

                  Opening step 3 is a GET submit of this form, and a GET submit builds the URL out
                  of the form's fields alone. Without these the panel would open on an unfiltered
                  list: the `f_` copies above are what the server actions read, and the page itself
                  reads the plain names.
                */}
                {Object.entries(current).map(([key, value]) => (
                  <input key={`plain-${key}`} type="hidden" name={key} value={value} />
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
                      {current.all === "1"
                        ? pageRows.length < shown.length
                          ? "Untick this page"
                          : `Untick all ${shown.length}`
                        : pageRows.length < shown.length
                          ? `Tick all ${pageRows.length} on this page`
                          : `Tick all ${shown.length}`}
                    </Link>

                    {/*
                      * Every action now lives in step 3, and this is the only button that leads
                      * there.
                      *
                      * They used to be three buttons in this row — buy for everyone, buy for the
                      * ticked, read the ticked — each with its own scope baked into its label. The
                      * operator's report was that this row was half the confusion on the screen,
                      * and it was: three scopes, three prices and no order between them, in the
                      * place the eye is busiest.
                      */}
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
                      {/* One line each, as the wireframe has them. The explanations these used to
                          carry under every heading made the header four lines tall; what each
                          column means is on the leads list's hover help and in How it works. */}
                      <Th label="Priority" width={96} />
                      <Th label="Business" width="21%" />
                      <Th label="What to sell" width="23%" />
                      <Th label="Scores" width={168} />
                      <Th label="ICP" width="13%" />
                      <Th label="Instagram" width="12%" />
                      <Th label="Contact" width="11%" />
                      <Th label="" width={96} />
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((b) => {
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
                              // `all=1` rather than running a script. See the Filters type — and
                              // re-ticked when step 3 sends the page back with the ids it carried,
                              // so opening the actions never loses what was chosen.
                              defaultChecked={current.all === "1" || tickedIds.includes(b.id)}
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
                                  <div className="clamp-2" title={b.route_reason} style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 2, lineHeight: 1.4 }}>
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
                            {b.icp_name ? (
                              <div style={{ fontSize: 15 }}>{b.icp_name}</div>
                            ) : (
                              <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>in no ICP</span>
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

                {/*
                  Fifty rows a page.

                  The whole list rendered at once was 176 rows and over twenty thousand pixels, most
                  of which nobody reads in one sitting — and every one of them was built on the
                  server before the first could be seen. The step 3 panel still acts on everything
                  the filters show; only the rows drawn are paged.
                */}
                {pageCount > 1 && (
                  <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--rule)", fontSize: 15 }}>
                    <span style={{ color: "var(--ink-2)" }}>
                      Showing {firstShown}–{lastShown} of {shown.length}
                    </span>
                    <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                      {pageNo > 1 ? (
                        <Link href={pageHref(pageNo - 1)} className="btn-2 btn">
                          ← Previous
                        </Link>
                      ) : null}
                      <span style={{ alignSelf: "center", color: "var(--ink-3)" }}>
                        Page {pageNo} of {pageCount}
                      </span>
                      {pageNo < pageCount ? (
                        <Link href={pageHref(pageNo + 1)} className="btn-2 btn">
                          Next →
                        </Link>
                      ) : null}
                    </span>
                  </div>
                )}



                <Note>
                  <strong>Problem</strong> is how much is wrong with their online presence, out of
                  100. <strong>Signals</strong> is how much evidence there is that they already pay
                  for things — analytics, a booking tool, a chat widget, a careers page. High on
                  both is the best possible lead, and that is what Priority 1 means.
                </Note>
              </form>

              {/*
                Step 3 sits outside the table's form on purpose, and reaches back into it with the
                `form` attribute.

                Inside the form it could never follow the operator down the page: the form scrolls
                sideways, and a sticky element is only sticky within the box that scrolls. Out here
                it sticks to the bottom of the screen for the whole length of the list — and its
                buttons still submit the ticks, because `form="lead-table"` names the form they
                belong to wherever they sit. It also lets the whole-list jobs below be forms of their
                own, which a form inside a form could not be.
              */}
                {/* Step 3 rides inside the table's own form, because the ticks do. Opening it is
                    a GET submit: the browser puts every ticked id in the query string, the page
                    comes back with the panel open and those rows still ticked. */}

                <div className="act-bar" style={{ margin: "14px 16px 16px" }}>
                  <span className="step-num">3</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>Do something with them</div>
                    <div style={{ fontSize: 14.5, color: "var(--ink-2)" }}>
                      Analyse, read their pages, buy extra data or download them — each with its
                      price before anything starts.
                    </div>
                  </div>
                  <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
                    <span style={{ fontSize: 15, color: "var(--ink-2)" }}>
                      {tickedIds.length > 0 ? `${tickedIds.length} ticked` : `${shown.length} shown`}
                    </span>
                    <button
                      className="btn tip-right"
                      type="submit"
                      form="lead-table"
                      formMethod="get"
                      formAction="/records"
                      name="act"
                      value="1"
                      data-tip="Opens one panel with everything you can do to these businesses, each with what it costs and who bills it. Nothing starts until you press a button inside it."
                    >
                      Choose what to do →
                    </button>
                  </span>
                </div>
                {/*
                  Step 3 itself: one panel, every action, each with its price and who bills it.

                  It lives inside the table's form so the buttons in it submit the same ticks the
                  operator made — `formAction` sends each one somewhere different, which is how one
                  set of checkboxes drives six different things without a line of JavaScript.
                */}
                {params.act === "1" && (
                  <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
                    <Link
                      href={href(current, {})}
                      aria-label="Close without doing anything"
                      style={{ position: "absolute", inset: 0, background: "rgba(16, 20, 28, 0.45)" }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: "min(680px, 100%)",
                        background: "var(--paper)",
                        borderLeft: "2px solid var(--rule)",
                        overflowY: "auto",
                        padding: "20px 22px 40px",
                        display: "grid",
                        gap: 14,
                        alignContent: "start",
                        boxShadow: "0 0 60px -10px rgba(16, 20, 28, 0.45)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                        <div>
                          <div style={{ fontSize: 22, fontWeight: 700 }}>Do something with them</div>
                          <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 3 }}>
                            Nothing starts until you press one of these.
                          </div>
                        </div>
                        <Link href={href(current, {})} className="btn-2 btn" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
                          ✕ Close
                        </Link>
                      </div>

                      <div style={{ ...PANEL, marginBottom: 0, padding: "12px 14px", fontSize: 15.5, lineHeight: 1.5 }}>
                        {tickedIds.length > 0 ? (
                          <>
                            <strong>{tickedIds.length} ticked.</strong> Everything below acts on those,
                            except where it says otherwise.
                          </>
                        ) : (
                          <>
                            <strong>Nothing is ticked.</strong> The buttons that need a selection are
                            switched off; the ones that act on all {shown.length} shown still work.
                          </>
                        )}
                      </div>

                      <ActionRow
                        title="Analyse them"
                        what="Reads their website, runs the 51 checks, measures their speed and scores them again. No provider is paid for any of it."
                        cost="Free"
                        who="our own crawler and Google PageSpeed"
                        off={
                          tickedIds.length === 0 ? (
                            <>
                              Switched off because nothing is ticked. Close this, tick businesses in
                              step 2, then press <strong>Choose what to do</strong> again.
                            </>
                          ) : undefined
                        }
                      >
                        <button
                          type="submit"
                          form="lead-table"
                          formAction={analyseUnscored}
                          className="btn"
                          disabled={tickedIds.length === 0}
                          data-tip="Runs the whole analysis on the businesses you ticked, in one go."
                        >
                          Run on {tickedIds.length > 0 ? `these ${tickedIds.length}` : "the ticked"}
                        </button>
                      </ActionRow>

                      <ActionRow
                        title="Read their pages in a browser"
                        what="Opens each page, keeps screenshots, finds social links and re-scores. No Google listing is bought."
                        cost="0.36¢ a site"
                        who="Google AI Studio (Gemini)"
                        off={
                          tickedIds.length === 0 ? (
                            <>
                              Switched off because nothing is ticked. Close this, tick businesses in
                              step 2, then press <strong>Choose what to do</strong> again.
                            </>
                          ) : undefined
                        }
                      >
                        <button
                          type="submit"
                          form="lead-table"
                          formAction={auditTickedWebsites}
                          className="btn-2 btn"
                          disabled={tickedIds.length === 0}
                          data-tip="Opens the ticked businesses' websites in a real browser and writes what is wrong with each page."
                        >
                          Read {tickedIds.length > 0 ? `these ${tickedIds.length}` : "the ticked"}
                        </button>
                      </ActionRow>

                      <ActionRow
                        title="Buy extra data"
                        what="Their Google listing, their Instagram, whether they are running ads. The next screen prices every source before anything is spent."
                        cost="priced on the next screen"
                        who="nothing is spent here"
                        off={
                          tickedIds.length === 0 ? (
                            <>
                              Switched off because nothing is ticked. Close this, tick businesses in
                              step 2, then press <strong>Choose what to do</strong> again.
                            </>
                          ) : undefined
                        }
                      >
                        <button
                          type="submit"
                          form="lead-table"
                          className="btn"
                          disabled={tickedIds.length === 0}
                          data-tip="Opens the confirm screen with the rows you ticked. Nothing is bought until you confirm there."
                        >
                          For the {tickedIds.length > 0 ? tickedIds.length : "ticked"}
                        </button>
                        {view !== "unanalysed" && (
                          <button
                            type="submit"
                            form="lead-table"
                          formAction={getPaidDataForFiltered}
                            className="btn-2 btn"
                            data-tip="Opens the confirm screen with every business your filters are showing, ticked or not."
                          >
                            For all {shown.length} shown
                          </button>
                        )}
                      </ActionRow>

                      <div style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-3)", marginTop: 6 }}>
                        For your whole list, ticked or not
                      </div>
                      {WHOLE_LIST_JOBS.map((job) => (
                        <ActionRow
                          key={job.title}
                          title={job.title}
                          what={job.what}
                          cost={job.cents === 0 ? "Free" : `${job.cents}¢ a site`}
                          who={job.platform}
                        >
                          <form action={job.action}>
                            <button className="btn-2 btn" type="submit" data-tip={job.tip}>
                              {job.button}
                            </button>
                          </form>
                        </ActionRow>
                      ))}

                      <ActionRow title="Download them" what="A spreadsheet of everything the filters are showing, with every column." cost="Free" who="—">
                        <a
                          href={`/records/export${href(current, {}).replace("/records", "")}`}
                          className="btn-2 btn"
                          style={{ textDecoration: "none" }}
                        >
                          Download {shown.length} as CSV
                        </a>
                      </ActionRow>

                      <div style={{ fontSize: 14.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
                        Spent so far <strong style={{ color: "var(--ink)" }}>${(spentCents / 100).toFixed(2)}</strong>{" "}
                        on paid lookups altogether. Reading websites, the checks and the scoring cost
                        nothing. <Link href="/spend">What each thing costs</Link>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </>
    </AppShell>
  );
}
