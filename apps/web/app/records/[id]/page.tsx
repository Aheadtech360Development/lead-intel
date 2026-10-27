import { PAGE_TYPE_LABELS, buildOpeners, checkedness, type CheckResult } from "@lead-intel/core";
import { BUSINESS_ORIGIN_LABELS, type BusinessOrigin } from "@lead-intel/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadJobsForBusiness } from "@/lib/job-runs";
import { loadScorecards } from "@/lib/page-scorecards";
import { auditWebsite, fullAnalyse } from "./audit-actions";
import { analyseUnscored } from "../analyse-actions";
import { createClient } from "@/lib/supabase/server";
import { getViewer, leadScope } from "@/lib/viewer";
import { explainBusiness } from "./explain-actions";
import { saveInstagramUrl } from "./social-actions";
import {
  AppShell,
  AREA_EXPLAIN,
  AREA_LABELS,
  Badge,
  Banner,
  Fact,
  FactGrid,
  Meter,
  Note,
  PANEL,
  Panel,
  ROUTE_LABELS,
  Stars,
  TD,
  TIER_MEANING,
  TierBadge,
  WEBSITE_LABELS,
} from "../../ui";
import { JobLine } from "../../running-jobs";
import { claimBusiness, releaseClaim } from "../actions";
import { logOutcome } from "./outcome-actions";

/**
 * One business, ordered by what a caller needs in the fifteen seconds before dialling (§8.2) —
 * and, on the right, the whole scoring explained in words rather than left as numbers to trust.
 *
 * The operator's report on the previous version was that the scoring was not understandable and
 * that "why is this Priority 1" had no answer on the page. So the tier is now spelled out as the
 * two comparisons that actually produced it, using this business's own numbers.
 */

const GROUP_HEAD = (colour: string): React.CSSProperties => ({
  padding: "12px 18px 0",
  fontSize: 14,
  fontWeight: 800,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: colour,
});

const AREA_ORDER = ["WEB", "SEO", "REP", "CON", "SOC", "ADS"];

const ROUTE_TO_AREA: Record<string, string> = {
  web_development: "WEB",
  local_seo: "SEO",
  reputation: "REP",
  contactability: "CON",
  social_media: "SOC",
  advertising: "ADS",
};

const label: React.CSSProperties = {
  fontSize: 14.5,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const input: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 15.5,
  border: "1px solid var(--rule)",
  borderRadius: 4,
  background: "var(--surface)",
  color: "var(--ink)",
  fontFamily: "inherit",
};
const fieldCol: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 165px" };
const rowKey: React.CSSProperties = { flex: "0 0 175px", color: "var(--ink-3)" };
const detailPanel: React.CSSProperties = { ...PANEL, marginBottom: 12 };
const detailSummary: React.CSSProperties = {
  padding: "12px 18px",
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 600,
  color: "var(--ink-2)",
};

interface AreaScoreRow {
  area: string;
  score: number | null;
  firedPoints: number;
  measuredPoints: number;
  possiblePoints: number;
  coverage: number;
  enoughData: boolean;
}

function readAreaScores(value: unknown): AreaScoreRow[] {
  if (value === null || typeof value !== "object") return [];
  const byArea = value as Record<string, AreaScoreRow>;
  return AREA_ORDER.map((a) => byArea[a]).filter((r): r is AreaScoreRow => Boolean(r));
}

export default async function RecordDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /**
   * The answer to whatever the operator just pressed.
   *
   * This page did not accept these at all, while its own actions — start an audit, save an
   * Instagram handle, write the AI briefing — every one of them redirects back here with `saved` or
   * `error`. So every message any of them has ever produced was discarded on arrival, and pressing
   * a button here has always looked identical to pressing nothing.
   */
  searchParams: Promise<{ saved?: string; error?: string; tab?: string; log?: string }>;
}) {
  const { id } = await params;
  const message = await searchParams;

  /**
   * One business, in four tabs.
   *
   * Everything here used to be one very long page: who they are, everything known about them,
   * every page of their website, every one of the 64 checks, the call log and every job ever run.
   * All of it matters and none of it is wanted at the same time — the operator's report was that
   * the important things were buried.
   *
   * The tab is a URL, not state. That keeps the page free of JavaScript, makes a tab linkable, and
   * means the browser's back button moves between them the way it moves anywhere else.
   */
  const tab: "overview" | "website" | "checks" | "calls" =
    message.tab === "website" || message.tab === "checks" || message.tab === "calls" ? message.tab : "overview";
  const supabase = await createClient();

  const viewer = await getViewer();
  const claims = viewer ? { sub: viewer.id, email: viewer.email } : null;

  const { data: business } = await supabase.from("businesses").select("*").eq("id", id).maybeSingle();
  if (!business) notFound();

  /**
   * A member may open their own leads, and only their own.
   *
   * The list is already filtered, so this only matters when an address is typed in or a link is
   * forwarded — which is exactly when it matters. `notFound` rather than a refusal on purpose:
   * telling someone a record exists but is not theirs is itself a leak of the list.
   */
  const scope = viewer ? leadScope(viewer) : null;
  if (scope && business[scope.column] !== scope.value) notFound();

  // Checklist rules are scoped by industry, and an industry now lives on the ICP the business
  // matched. A business in no ICP has none, and is judged on the universal rules alone.
  const { data: icpRow } = business.icp_id
    ? await supabase.from("icps").select("industry").eq("id", business.icp_id).maybeSingle()
    : { data: null };
  const icpIndustry = (icpRow?.industry as string | null) ?? null;

  const { data: batch } = business.import_batch_id
    ? await supabase.from("import_batches").select("filename").eq("id", business.import_batch_id).maybeSingle()
    : { data: null };
  const importFilename = batch?.filename ?? null;

  const [{ data: keys }, { data: fields }, { data: outcomes }, { data: findings }] = await Promise.all([
    supabase.from("identity_keys").select("key_type, key_value, rank").eq("business_id", id).order("rank"),
    supabase
      .from("field_metadata")
      .select("field_name, value, source_name, last_verified_at")
      .eq("business_id", id)
      .order("field_name"),
    supabase
      .from("outcomes")
      .select("channel, result, objection, notes, created_at, meeting_date")
      .eq("business_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("findings")
      .select("check_id, family, area, outcome, points, max_points, evidence, source_name")
      .eq("business_id", id)
      .order("points", { ascending: false }),
  ]);

  const isMine = claims?.sub && business.claimed_by === claims.sub;
  const phone = keys?.find((k) => k.key_type === "phone")?.key_value ?? null;
  const domain = keys?.find((k) => k.key_type === "domain")?.key_value ?? null;
  const fieldValue = (name: string) => (fields ?? []).find((f) => f.field_name === name)?.value ?? null;
  // The model's briefing, if one has been written. Stored rather than generated on render: a
  // summary that changes every refresh is one nobody can rely on, and one that costs money to
  // re-read is worse still.
  const aiSummary = fieldValue("ai_summary");
  const aiCategoryVerdict = fieldValue("ai_category_verdict");
  const aiCategoryNote = fieldValue("ai_category_note");
  const aiWrittenAt = (fields ?? []).find((f) => f.field_name === "ai_summary")?.last_verified_at ?? null;

  const websiteUrl = fieldValue("website_url");

  /**
   * Google's own numbers, which this page has never shown.
   *
   * 271 of 422 businesses have a rating and a review count stored, bought and paid for through the
   * Places API, and until now not one of them appeared anywhere on the record they belong to. The
   * operator's report was simply "sab Google Reviews ... visible hon", and it was correct: the data
   * was there the whole time.
   */
  const rating = fieldValue("rating");
  const reviewCount = fieldValue("review_count");
  const googleCategory = fieldValue("google_category") ?? fieldValue("primary_type");
  const businessStatus = fieldValue("business_status");
  const listingOutcome = fieldValue("listing_outcome");

  const youtube = {
    channel: fieldValue("youtube_channel_title"),
    channelId: fieldValue("youtube_channel_id"),
    latestVideoAt: fieldValue("youtube_latest_video_at"),
    outcome: fieldValue("youtube_outcome"),
  };

  const site = {
    title: fieldValue("page_title"),
    pagesRead: fieldValue("pages_read"),
    crawlOutcome: fieldValue("crawl_outcome"),
    crawlDetail: fieldValue("crawl_detail"),
    httpStatus: fieldValue("http_status"),
    finalUrl: fieldValue("final_url"),
    webPhone: fieldValue("contact_phone_web"),
    // How many pages a real browser managed, which is often more than the plain crawler got. The
    // two are shown side by side rather than one overwriting the other — see recordBrowserRead in
    // apps/jobs/src/audit-site.ts for why the crawler's verdict is left alone.
    browserPages: fieldValue("browser_pages_read"),
  };

  // Every job this business has been through, so "did that audit actually run?" is answered here
  // rather than by going back to the leads screen and hoping the banner is still up.
  const businessJobs = await loadJobsForBusiness(supabase, id);
  const contactEmail = fieldValue("contact_email");
  const contactName = fieldValue("contact_name");
  const contactNameSource = fieldValue("contact_name_source");

  // Instagram and Meta, kept together because between them they answer one question the website
  // crawl cannot: what is this business doing away from its own site, and is it already paying to
  // be seen? Both are bought separately, so either can be present without the other.
  const instagram = {
    url: fieldValue("instagram_url"),
    handle: fieldValue("instagram_handle"),
    followers: fieldValue("instagram_followers"),
    posts: fieldValue("instagram_posts"),
    category: fieldValue("instagram_category"),
    bio: fieldValue("instagram_bio"),
    verified: fieldValue("instagram_verified"),
    isPrivate: fieldValue("instagram_private"),
  };
  /**
   * The one thing worth doing next on this lead.
   *
   * The design asks for a single obvious next step, and the rule it sets is that the step must be
   * supported by data already on the record — never a guess dressed up as advice. So this is a
   * short ladder, read top to bottom, and every rung is a fact: nothing has been read · a call is
   * already booked · they have been called · there is a cheap thing left to learn · nothing is
   * left, so ring them.
   */
  const metaAds = {
    page: fieldValue("facebook_url"),
    running: fieldValue("meta_ads_running"),
    activeCount: fieldValue("meta_ads_active_count"),
    since: fieldValue("meta_ads_since"),
    platforms: fieldValue("meta_ads_platforms"),
    sample: fieldValue("meta_ads_sample"),
    checkedAt: fieldValue("meta_ads_checked_at"),
  };

  // The page-by-page audit, judged against the current checklists. See lib/page-scorecards.ts
  // for why the verdicts are worked out here rather than stored.
  const scorecards = await loadScorecards(supabase, id, icpIndustry);

  const problems = (findings ?? []).filter((f) => f.outcome === "fired" && f.family !== "N");
  const credits = (findings ?? []).filter((f) => f.outcome === "fired" && f.family === "N");
  const clean = (findings ?? []).filter((f) => f.outcome === "passed");
  const unmeasured = (findings ?? []).filter((f) => f.outcome === "not_measured");
  const areaScores = readAreaScores(business.area_scores);
  const openerArea = business.route ? ROUTE_TO_AREA[business.route] : null;

  const lastOutcome = (outcomes ?? [])[0] ?? null;
  const bookedFor = (outcomes ?? []).map((o) => o.meeting_date).find((d): d is string => Boolean(d)) ?? null;
  const hasListing = (keys ?? []).some((k) => k.key_type === "place_id");

  const nextStep: { title: string; body: string; href: string; label: string; cost: string | null } = (() => {
    if (!business.scored_at) {
      return {
        title: "Nobody has looked at this one yet",
        body: "No check has run against it, so it has no score — which is not the same as a low one. Reading their website takes about fifteen seconds and costs nothing.",
        href: `/records/${id}?tab=checks`,
        label: "See what is missing",
        cost: null,
      };
    }
    if (bookedFor) {
      return {
        title: `You are due back on ${new Date(bookedFor).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}`,
        body: "A date was set when you logged the call. Open the history to see exactly what was said before you ring again.",
        href: `/records/${id}?tab=calls`,
        label: "Read the call",
        cost: null,
      };
    }
    if (lastOutcome) {
      return {
        title: "You have spoken to this business",
        body: "Everything said is on the Calls tab. Log the next attempt from there — it is what teaches the product which openers actually get answered.",
        href: `/records/${id}?tab=calls`,
        label: "Log another call",
        cost: null,
      };
    }
    if (!hasListing) {
      return {
        title: "Their Google listing has never been bought",
        body: "Six checks — their reviews, their rating, their hours, their category and whether Google even has a website for them — have no source at all until it is. That is more than a third of the Problem score standing on nothing.",
        href: "/records/enrich",
        label: "Get the listing",
        cost: "3.5¢, billed by Google Places, after you confirm",
      };
    }
    if (instagram.url && !instagram.handle) {
      return {
        title: "There is an Instagram account nobody has opened",
        body: "Followers and post count are the clearest proof a small business already spends money on being found — and they can lift a business with no website straight into Priority 1.",
        href: "/records/enrich",
        label: "Look it up",
        cost: "0.26¢, billed by Apify, after you confirm",
      };
    }
    return {
      title: "Ring them",
      body: "The findings are read, the opener is below, and there is nothing cheap left to learn about this business. The next useful thing is a phone call.",
      href: `/records/${id}?tab=calls`,
      label: "Log the call",
      cost: null,
    };
  })();

  const openers = buildOpeners({
    businessName: business.display_name,
    city: business.city ?? null,
    route: business.route ?? null,
    findings: (findings ?? []) as unknown as CheckResult[],
  });

  const problem = business.problem_score as number | null;
  const intent = business.intent_score as number | null;

  /**
   * What this business's score was actually made of.
   *
   * From the findings this page has already loaded, so it costs nothing. It is the answer to the
   * operator's question — "check nahi kia hua tab bhi score dikh raha hota hai" — said on the one
   * screen where somebody is deciding whether to believe the number.
   */
  const checked = checkedness((findings ?? []) as unknown as CheckResult[]);
  const crux = fieldValue("crux_category");
  const perfScore = fieldValue("performance_score");
  const lcp = fieldValue("lcp_ms");

  return (
    <AppShell
      autoRefresh={false} wide back={{ href: "/records", label: "Back to all leads" }}>

      <>
        {message.error ? <Banner tone="bad">{decodeURIComponent(message.error)}</Banner> : null}
        {message.saved ? <Banner tone="good">{decodeURIComponent(message.saved)}</Banner> : null}

        {/* ---- Header: who they are and how to reach them ---- */}
        <div style={{ ...PANEL, padding: "20px 22px", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 380px" }}>
              <h1 style={{ fontSize: 30, margin: "0 0 3px", lineHeight: 1.2, display: "flex", alignItems: "center", gap: 12 }}>
                {business.tier ? <TierBadge tier={business.tier} /> : null}
                {business.display_name}
              </h1>
              <p style={{ margin: "0 0 10px", color: "var(--ink-3)", fontSize: 16 }}>
                {[business.city, business.state].filter(Boolean).join(", ") || "Location not recorded"}
              </p>

              {/* How much is behind the priority badge above, in words, before anything else is
                  read. A thin score is still a score — it is only dishonest when it is silent. */}
              <div
                className={checked.band === "nothing" || checked.band === "thin" ? "note warn" : "note"}
                style={{ margin: "0 0 16px", maxWidth: 620 }}
              >
                <strong>{checked.measured === 0 ? "Nothing checked yet" : `Checked: ${checked.measured} of ${checked.catalogue}`}</strong>{" "}
                {checked.sentence}
              </div>
              <div style={{ display: "flex", gap: 30, flexWrap: "wrap", rowGap: 16 }}>
                <span>
                  <div style={label}>Phone</div>
                  <div style={{ fontSize: 20.5, fontWeight: 600, marginTop: 2 }}>
                    {phone ? <a href={`tel:${phone}`}>{phone}</a> : <span style={{ color: "var(--ink-3)" }}>Not found</span>}
                  </div>
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>from their Google listing</div>
                </span>

                {/* Free, and previously invisible: the crawler has been pulling these off the
                    business's own pages all along and storing them inside a check's detail. */}
                {contactEmail && (
                  <span>
                    <div style={label}>Email</div>
                    <div style={{ fontSize: 17.5, fontWeight: 600, marginTop: 3 }}>
                      <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                    </div>
                    <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>from their own website</div>
                  </span>
                )}

                {contactName && (
                  <span>
                    <div style={label}>Who to ask for</div>
                    <div style={{ fontSize: 17.5, fontWeight: 600, marginTop: 3 }}>{contactName}</div>
                    <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                      {contactNameSource ? `stated on ${contactNameSource}` : "from their own website"}
                    </div>
                  </span>
                )}

                {/* Bought, stored, and until now never shown. See the note beside `rating` above. */}
                <span>
                  <div style={label}>Google rating</div>
                  <div style={{ fontSize: 20.5, fontWeight: 600, marginTop: 2 }}>
                    {rating ? (
                      <Stars rating={Number(rating)} />
                    ) : (
                      <span style={{ color: "var(--ink-3)", fontSize: 17.5 }}>Not bought yet</span>
                    )}
                  </div>
                  <div style={{ fontSize: 14.5, color: "var(--ink-2)" }}>
                    {reviewCount
                      ? `${Number(reviewCount).toLocaleString("en-GB")} ${Number(reviewCount) === 1 ? "review" : "reviews"} on Google`
                      : "Buy their Google listing to see this"}
                  </div>
                </span>

                <span>
                  <div style={label}>Website</div>
                  <div style={{ fontSize: 17.5, marginTop: 4 }}>
                    {domain ? (
                      <a href={`https://${domain}`} target="_blank" rel="noreferrer noopener">
                        {domain} ↗
                      </a>
                    ) : (
                      <span style={{ color: "var(--ink-3)" }}>None on their Google listing</span>
                    )}
                  </div>
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                    {WEBSITE_LABELS[business.website_status] ?? business.website_status}
                  </div>
                </span>

                {/* Where the record came from, next to everything else about it. On this page it
                    is shown for all three origins, not only the unusual ones: the whole point of
                    opening a lead is to see what is behind its numbers, and an imported record's
                    Problem score rests on four areas rather than six. */}
                <span>
                  <div style={label}>Where from</div>
                  <div style={{ fontSize: 17.5, marginTop: 4 }}>
                    {BUSINESS_ORIGIN_LABELS[business.origin as BusinessOrigin]?.label ?? business.origin}
                  </div>
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", maxWidth: 300, lineHeight: 1.4 }}>
                    {importFilename
                      ? `Row of ${importFilename}`
                      : (BUSINESS_ORIGIN_LABELS[business.origin as BusinessOrigin]?.explain ?? "")}
                  </div>
                </span>
              </div>
            </div>
            {/*
              * Claim, and everything that can be run on this business, together at the top.
              *
              * These were a panel of their own further down the record. The operator asked for them
              * up here beside Claim, which is right: this is the row you act from, and an action you
              * have to scroll to find is one you forget exists.
              *
              * "Full analysis" first and filled in, because it is the answer to "show me everything
              * about this one" — the question anyone opening a record is actually asking. The
              * individual passes stay, for when only one of them is wanted.
              */}
            <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 9, alignItems: "flex-end" }}>
              <div style={{ display: "flex", gap: 9, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <form action={fullAnalyse}>
                  <input type="hidden" name="id" value={id} />
                  <button
                    className="btn tip-right"
                    type="submit"
                    disabled={!websiteUrl}
                    data-tip="Reads their website, runs all 64 checks, opens it in a real browser page by page, then scores it again. A couple of minutes, about 0.36¢."
                  >
                    Full analysis of this business
                  </button>
                </form>

                {business.claim_status === "unclaimed" ? (
                  <form action={claimBusiness.bind(null, business.id)}>
                    <button className="btn-2 btn" type="submit">
                      Claim this lead
                    </button>
                  </form>
                ) : isMine ? (
                  <form action={releaseClaim.bind(null, business.id)}>
                    <button className="btn-2 btn" type="submit">
                      Release
                    </button>
                  </form>
                ) : (
                  <span style={{ fontSize: 16, color: "var(--ink-2)", alignSelf: "center" }}>
                    Claimed by someone else
                  </span>
                )}
              </div>

              <div style={{ display: "flex", gap: 9, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <form action={analyseUnscored}>
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="back" value={`/records/${id}`} />
                  <button
                    className="btn-2 btn tip-right"
                    type="submit"
                    style={{ fontSize: 15, padding: "7px 12px" }}
                    data-tip="Fetches their pages again and re-runs the 64 checks and the score. Free. Sites that block robots will block this too — use Read page by page for those."
                  >
                    Re-read &amp; re-score
                  </button>
                </form>

                <form action={auditWebsite}>
                  <input type="hidden" name="id" value={id} />
                  <button
                    className="btn-2 btn tip-right"
                    type="submit"
                    disabled={!websiteUrl}
                    style={{ fontSize: 15, padding: "7px 12px" }}
                    data-tip="Opens their site in a real browser, keeps screenshots of the home and product pages, finds their social links, and re-scores. About 0.36¢."
                  >
                    Read page by page
                  </button>
                </form>

                {/*
                  * Instagram is bought, not read, so this is a link to the confirm screen rather
                  * than a button that spends. `only=` narrows that screen to this one source, so an
                  * operator who came here for a follower count is not offered four other purchases.
                  */}
                <Link
                  href={`/records/enrich?id=${id}&only=instagram_profile`}
                  data-tip="Opens a confirm screen for their Instagram followers, posts and category. 0.26¢ with Apify, only after you confirm. Needs an Instagram account on the record."
                  className="btn-2 btn tip-right"
                  style={{ fontSize: 15, padding: "7px 12px" }}
                >
                  {instagram.followers ? "Refresh their Instagram" : "Analyse their Instagram"}
                </Link>
              </div>

              <div style={{ fontSize: 14, color: "var(--ink-2)", textAlign: "right", maxWidth: 360, lineHeight: 1.45 }}>
                Everything here is free except the Instagram lookup (0.26&#162; with Apify) and the model&rsquo;s
                read on each page (0.36&#162; a site with Gemini).
              </div>
            </div>
          </div>
          {business.manual_review_status && (
            <p
              style={{
                margin: "16px 0 0",
                padding: "11px 13px",
                background: "var(--accent-bg)",
                border: "1px solid var(--rule)",
                borderRadius: 4,
                fontSize: 15,
                color: "var(--ink-2)",
              }}
            >
              <strong>Check this one by hand before calling.</strong> {business.route_reason ?? ""}
            </p>
          )}
        </div>


        {/*
          The four tabs. Links, not buttons: each one is a URL, so a tab can be sent to someone and
          the back button moves between them.
        */}
        <nav className="tabs" style={{ margin: "0 0 18px" }}>
          {[
            { id: "overview", label: "Overview" },
            { id: "website", label: `Website pages${scorecards.length > 0 ? ` (${scorecards.length})` : ""}` },
            { id: "checks", label: "Checks & scores" },
            { id: "calls", label: `Calls & history${(outcomes ?? []).length > 0 ? ` (${(outcomes ?? []).length})` : ""}` },
          ].map((t) => (
            <Link
              key={t.id}
              href={t.id === "overview" ? `/records/${id}` : `/records/${id}?tab=${t.id}`}
              aria-selected={tab === t.id}
            >
              {t.label}
            </Link>
          ))}
        </nav>


        {/*
          One line, one button, on the tab a salesperson opens first. Every word of it comes from
          the ladder computed above, so it cannot recommend something the record does not support.
        */}
        {tab === "overview" && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              padding: "13px 16px",
              marginBottom: 18,
              background: "var(--surface)",
              border: "1px solid var(--rule)",
              borderLeft: "3px solid var(--warn)",
              borderRadius: "var(--radius)",
            }}
          >
            <div style={{ minWidth: 0, flex: "1 1 320px" }}>
              <strong style={{ fontSize: 15.5, color: "var(--ink)" }}>Next: {nextStep.title}</strong>
              <div style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.5 }}>{nextStep.body}</div>
              {nextStep.cost ? (
                <div style={{ fontSize: 13.5, color: "var(--warn-ink)", marginTop: 5 }}>{nextStep.cost}</div>
              ) : (
                <div style={{ fontSize: 13.5, color: "var(--good-ink)", marginTop: 5 }}>Free</div>
              )}
            </div>
            <Link href={nextStep.href} className="btn" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
              {nextStep.label}
            </Link>
          </div>
        )}

        {/*
          Two columns on the tabs that have something for both, one on the tabs that do not. The
          right-hand column is not rendered at all when it would be empty — an empty grid cell is a
          gap the eye still has to cross.
        */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              tab === "overview"
                ? "minmax(0, 1fr) minmax(0, 1.4fr)"
                : tab === "checks"
                  ? "minmax(0, 1.15fr) minmax(0, 1fr)"
                  : "minmax(0, 1fr)",
            gap: 20,
            alignItems: "start",
          }}
        >
          {/* ================= LEFT: what to do ================= */}
          <div>
            {tab === "overview" && (
            <Panel title="Why this lead, in plain terms">
              <div style={{ padding: "16px 18px" }}>
                {problem === null ? (
                  <p style={{ margin: 0, fontSize: 16, color: "var(--ink-2)" }}>
                    <strong>We could not score this business.</strong>{" "}
                    {business.route_reason ?? "Too little could be measured."} That is not a judgement
                    about them — it means we could not read enough to have an opinion.
                  </p>
                ) : (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ ...label, marginBottom: 4 }}>Sell them</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>
                        {business.route ? ROUTE_LABELS[business.route] ?? business.route : "Nothing solid enough yet"}
                      </div>
                      {business.route_reason && (
                        <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 3 }}>{business.route_reason}</div>
                      )}
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 4 }}>
                        <strong>Problem score — how much is wrong</strong>
                        <span style={{ fontWeight: 700 }}>{problem} / 100</span>
                      </div>
                      <Meter value={problem} tone="problem" height={10} />
                      <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 4 }}>
                        {problem >= 55
                          ? "Above 55, so there is enough wrong here to be worth a call."
                          : "Below 55 — not much is wrong, so this is a harder conversation to open."}
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 4 }}>
                        <strong>Buying signals — do they spend money?</strong>
                        <span style={{ fontWeight: 700 }}>{intent ?? 0} / 100</span>
                      </div>
                      <Meter value={intent} tone="good" height={10} />
                      <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 4 }}>
                        {(intent ?? 0) >= 35
                          ? "Above 35 — they already pay for tools or advertising, so there is a budget."
                          : "Below 35 — we found little sign they currently pay for anything."}
                      </div>
                    </div>

                    {/* The question the operator actually asked: why is this Priority 1? */}
                    <div style={{ padding: "13px 14px", background: "var(--surface-2)", borderRadius: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <TierBadge tier={business.tier} />
                        <strong style={{ fontSize: 16 }}>
                          {business.tier ? `Priority ${business.tier}` : "No priority"}
                        </strong>
                      </div>
                      <div style={{ fontSize: 15, color: "var(--ink-2)", lineHeight: 1.55 }}>
                        {business.tier ? (
                          <>
                            {TIER_MEANING[business.tier]}.
                            <div style={{ marginTop: 7, color: "var(--ink-3)", fontSize: 14.5 }}>
                              Worked out from exactly two comparisons: problem score{" "}
                              <strong>{problem}</strong> is {problem >= 55 ? "above" : "below"} 55, and
                              buying signals <strong>{intent ?? 0}</strong> {(intent ?? 0) >= 35 ? "above" : "below"}{" "}
                              35. Nothing else changes the priority.
                            </div>
                          </>
                        ) : (
                          "Not enough was measured to place this business."
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </Panel>
            )}
            {tab === "overview" && (
            <Panel
              title="What to say when they answer"
              hint="Built from one specific thing we found. If we had nothing solid, no line is suggested at all."
              tone="brand"
            >
              {openers.openers.length === 0 ? (
                <div style={{ padding: 18, color: "var(--ink-3)", fontSize: 16 }}>{openers.reason}</div>
              ) : (
                openers.openers.map((o, i) => (
                  <div
                    key={o.channel}
                    style={{ padding: "15px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}
                  >
                    <div style={{ ...label, marginBottom: 7 }}>{o.channel === "call" ? "On the phone" : "As a message"}</div>
                    <p style={{ margin: "0 0 8px", fontSize: 18, lineHeight: 1.55 }}>&ldquo;{o.text}&rdquo;</p>
                    <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>Because we found: {o.evidence}</div>
                  </div>
                ))
              )}
            </Panel>
            )}

            {/* Off-site presence, in its own panel. It is bought separately from the free crawl,
                arrives separately, and answers a different question — so mixing it into the
                website findings would blur where each fact came from. */}

            {/* The briefing sits directly above the findings it was written from, and the findings
                are unchanged. That arrangement is the whole safety design: if the paragraph is
                wrong, the real thing is one line below it, in the operator's own words —
                "ager AI ne sahi se explain nhi kia to mai points read kerloon". */}
            {/* Page-by-page audit. Above the old findings because it is more specific: "the contact
                page has no form" is a sentence to open a call with, where "CON scores 62" is not. */}
            {/* Shown whenever there is a site to read, not only once it has been read. A feature
                with no way to start it is a feature nobody has — the audit worked correctly and
                invisibly for a week because nothing in the application could trigger it. */}
            {tab === "website" && !websiteUrl && (
              <Panel title="Their website, page by page">
                <div style={{ padding: "16px 18px", fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                  No website is stored for this business, so there are no pages to read. Add one on
                  the Overview tab and this tab fills in once it has been read.
                </div>
              </Panel>
            )}
            {tab === "website" && websiteUrl && (
              <Panel
                title={
                  scorecards.length > 0
                    ? `Their website, page by page (${scorecards.length})`
                    : "Their website, page by page"
                }
                hint="Judged against your checklists. Edit those on the Checklists screen — these verdicts follow immediately, because they are worked out fresh every time you open this."
              >
                <form
                  action={auditWebsite}
                  style={{ ...TD, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
                >
                  <input type="hidden" name="id" value={id} />
                  <button className={scorecards.length > 0 ? "btn-2 btn" : "btn"} type="submit">
                    {scorecards.length > 0 ? "Read it again" : "Read their website"}
                  </button>
                  <span style={{ fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.5, flex: "1 1 320px" }}>
                    {scorecards.length > 0
                      ? "Re-reads every page and replaces what is below. Worth doing after they change something, or after you change a checklist rule that needs a fresh measurement."
                      : "Opens each page of their site in a real browser, measures it, and asks the model what the measurements miss. Usually under a minute."}{" "}
                    <span style={{ color: "var(--ink-3)" }}>
                      Costs about half a cent of Gemini — Google&#8217;s model, which supplies the
                      judgement — plus machine time on Trigger.dev, where the browser runs.
                    </span>
                  </span>
                </form>

                {/*
                  * Said once, at the top, when a picture was meant to exist and does not.
                  *
                  * The reason was only ever written to the worker's log, where an operator will
                  * never see it - so the screenshots simply appeared to be missing, with nothing on
                  * the screen to explain why or what to do. A feature that silently does not happen
                  * is indistinguishable from one that was never built.
                  */}
                {scorecards.some((c) => c.screenshotExpected && c.screenshotUrl === null && c.outcome === "ok") && (
                  <div
                    style={{
                      margin: "0 18px 4px",
                      padding: "12px 14px",
                      background: "var(--warn-bg)",
                      borderLeft: "3px solid var(--warn)",
                      borderRadius: "0 6px 6px 0",
                      fontSize: 15,
                      lineHeight: 1.6,
                      color: "var(--ink)",
                    }}
                  >
                    <strong>The screenshots were taken but could not be stored.</strong> The worker needs{" "}
                    <code>SUPABASE_SERVICE_ROLE_KEY</code> in <code>apps/jobs/.env</code> before it can keep them
                    &mdash; Supabase dashboard, Project Settings, API keys, the <code>service_role</code> one. Add it and
                    press &ldquo;Read it again&rdquo; above; everything else in this audit was measured normally.
                  </div>
                )}

                {scorecards.map((card) => (
                  <div key={card.url} style={{ ...TD, display: "block" }}>
                    <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 16 }}>{PAGE_TYPE_LABELS[card.pageType]}</strong>
                      <a href={card.url} target="_blank" rel="noreferrer noopener" style={{ fontSize: 14.5 }}>
                        {card.url.replace(/^https?:\/\/[^/]+/, "") || "/"} &#8599;
                      </a>
                      <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "baseline" }}>
                        {card.score !== null && (
                          <strong
                            style={{
                              fontSize: 18.5,
                              fontVariantNumeric: "tabular-nums",
                              color: card.score >= 80 ? "var(--good)" : card.score >= 50 ? "var(--warn)" : "var(--bad)",
                            }}
                          >
                            {card.score}
                          </strong>
                        )}
                        <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                          {card.failed} to fix · {card.passed} fine
                          {card.unknown > 0 ? ` · ${card.unknown} not checkable` : ""}
                        </span>
                      </span>
                    </div>

                    {card.outcome !== "ok" && (
                      <div style={{ fontSize: 15, color: "var(--warn-ink)", marginTop: 5 }}>
                        {card.detail ?? "This page could not be read, so nothing below is a judgement about it."}
                      </div>
                    )}

                    {/* The picture, for the two pages an operator would actually put in front of a
                        client. Every other page's screenshot was taken, shown to the model and
                        thrown away - keeping all of them would fill the free gigabyte for no gain.
                        Shown open rather than behind a disclosure: it was collapsed at first, and
                        the operator's report was that they could not find the screenshots at all.
                        A picture nobody clicks to reveal is a picture that does not exist. */}
                    {card.screenshotUrl && (
                      <div style={{ marginTop: 10 }}>
                        <div
                          style={{
                            fontSize: 13.5,
                            letterSpacing: "0.05em",
                            textTransform: "uppercase",
                            color: "var(--ink-2)",
                            fontWeight: 800,
                            marginBottom: 4,
                          }}
                        >
                          How the page actually looks &mdash; click to open full size
                        </div>
                        <a href={card.screenshotUrl} target="_blank" rel="noreferrer noopener">
                          {/* eslint-disable-next-line @next/next/no-img-element -- a signed
                              Supabase link, not a static asset; next/image would need the host
                              whitelisted and would re-fetch a URL that expires in an hour. */}
                          <img
                            src={card.screenshotUrl}
                            alt={`${PAGE_TYPE_LABELS[card.pageType]} of ${business.display_name}`}
                            style={{
                              display: "block",
                              width: "100%",
                              maxWidth: 640,
                              border: "1px solid var(--rule-2)",
                              borderRadius: 8,
                              boxShadow: "var(--shadow-sm)",
                            }}
                          />
                        </a>
                      </div>
                    )}

                    {/* The model's read, kept visibly apart from the measurements above it.
                        Everything else on this card is something a browser measured; this is an
                        opinion, and an opinion that looks like a measurement is the one failure
                        mode this feature must not have. */}
                    {card.critique && (
                      <div className="note ai" style={{ marginTop: 8, lineHeight: 1.55 }}>
                        {/* Violet, and labelled. In this product violet means one thing only — a
                            language model wrote it — so the operator can tell an opinion from a
                            measurement without reading either. */}
                        <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                          <span className="badge ai">AI insight</span>
                          <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
                            Gemini 2.5 Flash, from this page’s own text — not a score
                          </span>
                        </div>
                        <div style={{ marginTop: 4 }}>{card.critique.purpose}</div>
                        <div style={{ marginTop: 4 }}>{card.critique.judgement}</div>
                        {card.critique.openWith && (
                          <div style={{ marginTop: 6 }}>
                            <strong>Open with:</strong> {card.critique.openWith}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Why there is no opinion, when there is none. A blank space would be
                        indistinguishable from a feature that quietly broke. */}
                    {!card.critique && card.critiqueDetail && (
                      <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 8 }}>
                        No read on this page: {card.critiqueDetail}
                      </div>
                    )}

                    {card.results
                      .filter((r) => r.outcome === "failed")
                      .map((r) => (
                        <div key={r.rule.id} style={{ fontSize: 15, marginTop: 6, lineHeight: 1.5 }}>
                          <span style={{ color: "var(--bad)", fontWeight: 700 }}>✕</span> {r.rule.says}{" "}
                          <span style={{ color: "var(--ink-3)" }}>
                            ({r.because}
                            {r.found ? `, found: ${r.found}` : ""})
                          </span>
                        </div>
                      ))}

                    {/* Named, not hidden. A rule nobody could evaluate is a gap in what we know, and
                        the operator should see that rather than assume the page passed it. */}
                    {card.unknown > 0 && (
                      <details style={{ marginTop: 6 }}>
                        <summary style={{ fontSize: 14, color: "var(--ink-3)", cursor: "pointer" }}>
                          {card.unknown} could not be checked on this page
                        </summary>
                        {card.results
                          .filter((r) => r.outcome === "unknown")
                          .map((r) => (
                            <div key={r.rule.id} style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 3 }}>
                              {r.rule.name} — {r.because}
                            </div>
                          ))}
                      </details>
                    )}
                  </div>
                ))}
              </Panel>
            )}

            {/* The briefing is read before ringing them, so it lives with the rest of what to say. */}
            {tab === "overview" && (
            <>
            <div id="summary" style={{ scrollMarginTop: 20 }} />
            <div
              style={{
                ...PANEL,
                padding: 0,
                overflow: "hidden",
                borderColor: aiSummary ? "var(--info)" : "var(--rule)",
              }}
            >
              <div
                style={{
                  padding: "12px 18px",
                  background: aiSummary ? "var(--info-bg)" : "var(--surface-2)",
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <strong style={{ fontSize: 16.5 }}>✨ In plain words</strong>
                <form action={explainBusiness} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="hidden" name="id" value={id} />
                  <button className="btn-2 btn" type="submit" style={{ fontSize: 14.5 }}>
                    {aiSummary ? "Write it again" : "Explain this business"}
                  </button>
                </form>
              </div>

              {aiSummary ? (
                <div style={{ padding: "15px 18px" }}>
                  {String(aiSummary)
                    .split(/\n{2,}/)
                    .map((para: string, i: number) => (
                    <p key={i} style={{ margin: i === 0 ? "0 0 10px" : "0 0 10px", fontSize: 16.5, lineHeight: 1.65 }}>
                      {para}
                    </p>
                  ))}

                  {aiCategoryVerdict === "disagrees" && aiCategoryNote && (
                    <div
                      style={{
                        marginTop: 4,
                        padding: "10px 12px",
                        background: "var(--warn-bg)",
                        borderRadius: 5,
                        fontSize: 15,
                        lineHeight: 1.55,
                      }}
                    >
                      🏷️ <strong>This may be in the wrong ICP.</strong> You have them in{" "}
                      <strong>{business.icp_name ?? "no ICP yet"}</strong>. {aiCategoryNote}{" "}
                      <Link href="/icps">Adjust your ICPs</Link> — which ICP a business is in is only
                      ever set by your ICPs, never by this.
                    </div>
                  )}

                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 12, lineHeight: 1.6 }}>
                    Written by <strong>gemini-2.5-flash</strong>
                    {aiWrittenAt ? ` on ${new Date(aiWrittenAt).toLocaleDateString("en-GB")}` : ""} from the{" "}
                    {problems.length} findings below and their website text.{" "}
                    <strong>It can be wrong.</strong> Everything it says should appear in the findings
                    below — if it does not, trust the findings and not this.
                  </div>
                </div>
              ) : (
                <div style={{ padding: "15px 18px", fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
                  A short briefing written from the findings below and their website text, so you can
                  read one paragraph instead of {problems.length} lines before ringing them. Costs
                  about a third of a cent, and the findings stay exactly as they are underneath.
                </div>
              )}
            </div>
            </>
            )}

            {tab === "checks" && (
            <Panel title={`The biggest problems (${problems.length})`} hint="Ordered by how much each one matters.">
              {problems.length === 0 ? (
                <div style={{ padding: 18, color: "var(--ink-3)", fontSize: 15.5 }}>
                  Nothing the free checks look for is wrong with this business.
                </div>
              ) : (
                problems.slice(0, 8).map((f, i) => (
                  <div key={f.check_id} style={{ display: "flex", gap: 14, padding: "11px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)", fontSize: 15.5 }}>
                    <span style={{ flex: "0 0 150px", color: "var(--ink-3)", fontSize: 14.5 }}>
                      {AREA_LABELS[f.area ?? ""] ?? f.area}
                    </span>
                    <span style={{ flex: 1 }}>{f.evidence}</span>
                  </div>
                ))
              )}
              {problems.length > 8 && (
                <Note>
                  {problems.length - 8} more, further down under &ldquo;every single check&rdquo;.
                </Note>
              )}
            </Panel>
            )}

            {/*
              The call log opens on + Log a call, and only then.

              It used to sit open at the top of this tab, which is the thing the operator asked
              every form in the product to stop doing: a form nobody has asked for is a question
              put to them every time they open the page. The panel is a URL (`log=1`), so it needs
              no JavaScript, and saving closes it by sending them back to this tab.
            */}
            {tab === "calls" && (
              <Panel
                title="Calls"
                hint="Every call you log teaches the system which findings actually get replies."
                tone="brand"
              >
                <div style={{ padding: "14px 18px", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 15.5, color: "var(--ink-2)" }}>
                    {outcomes && outcomes.length > 0
                      ? `${outcomes.length} ${outcomes.length === 1 ? "call" : "calls"} logged so far.`
                      : "No call has been logged for this business yet."}
                  </span>
                  <Link href={`/records/${id}?tab=calls&log=1`} className="btn" style={{ marginLeft: "auto", textDecoration: "none" }}>
                    + Log a call
                  </Link>
                </div>
              </Panel>
            )}

            {tab === "calls" && message.log === "1" && (
              <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
                <Link
                  href={`/records/${id}?tab=calls`}
                  aria-label="Close without saving"
                  style={{ position: "absolute", inset: 0, background: "rgba(16, 20, 28, 0.45)" }}
                />
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    right: 0,
                    bottom: 0,
                    width: "min(620px, 100%)",
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
                      <div style={{ fontSize: 22, fontWeight: 700 }}>Log a call</div>
                      <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 3 }}>
                        {business.display_name}
                        {phone ? ` · ${phone}` : ""}
                      </div>
                    </div>
                    <Link href={`/records/${id}?tab=calls`} className="btn-2 btn" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
                      ✕ Close
                    </Link>
                  </div>
            <Panel title="After the call, log what happened" hint="This is what teaches the system which findings actually get replies.">
              <form action={logOutcome.bind(null, business.id)} style={{ padding: "16px 18px" }}>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
                  <label style={fieldCol}>
                    <span style={label}>How</span>
                    <select name="channel" required defaultValue="call" style={input}>
                      <option value="call">Called them</option>
                      <option value="message">Messaged them</option>
                    </select>
                  </label>
                  <label style={fieldCol}>
                    <span style={label}>What happened</span>
                    <select name="result" required defaultValue="no_answer" style={input}>
                      <option value="no_answer">No answer</option>
                      <option value="not_interested">Not interested</option>
                      <option value="interested">Interested</option>
                      <option value="follow_up_requested">Wants a follow-up</option>
                      <option value="meeting_booked">Meeting booked</option>
                      <option value="do_not_contact">Do not contact again</option>
                      <option value="invalid_contact">Wrong number</option>
                    </select>
                  </label>
                  <label style={fieldCol}>
                    <span style={label}>Why they said no</span>
                    <select name="objection" defaultValue="none" style={input}>
                      <option value="none">They didn&rsquo;t say no</option>
                      <option value="price">Too expensive</option>
                      <option value="timing">Bad timing</option>
                      <option value="competition">Already has someone</option>
                      <option value="authority">Not the decision maker</option>
                      <option value="status_quo">Happy as they are</option>
                      <option value="technical">Technical objection</option>
                    </select>
                  </label>
                  <label style={fieldCol}>
                    <span style={label}>What you opened with</span>
                    <select name="opener_area" defaultValue={openerArea ?? ""} style={input}>
                      <option value="">Didn&rsquo;t note it</option>
                      {AREA_ORDER.map((a) => (
                        <option key={a} value={a}>
                          {AREA_LABELS[a]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={fieldCol}>
                    <span style={label}>Meeting date</span>
                    <input type="date" name="meeting_date" style={input} />
                  </label>
                </div>
                <label style={{ display: "block", marginBottom: 14 }}>
                  <span style={label}>Notes</span>
                  <textarea name="notes" rows={2} placeholder="What they actually said." style={{ ...input, width: "100%", resize: "vertical" }} />
                </label>
                <button className="btn" type="submit">
                  Save what happened
                </button>
              </form>
            </Panel>
                </div>
              </div>
            )}

            {tab === "calls" && (
              <>
        {businessJobs.length > 0 &&
          (() => {
            const live = businessJobs.filter((j) => j.status === "running" || j.status === "queued");
            return (
              <div className="card" style={{ marginBottom: 18 }} {...(live.length > 0 ? { "data-tone": "brand" } : {})}>
                {/*
                  * Closed unless something is actually running.
                  *
                  * Every re-run leaves a row here, so after a few attempts this was five paragraphs
                  * of finished job summaries sitting between the operator and the record they came
                  * to read. A `<details>` needs no JavaScript and remembers nothing, which is right:
                  * the useful default is "hidden", and the exception — a job in flight — opens it by
                  * itself.
                  */}
                <details open={live.length > 0}>
                  <summary
                    style={{
                      padding: "14px 18px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "baseline",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontSize: 18, fontWeight: 750, color: "var(--ink)" }}>
                      What has been run on this business
                    </span>
                    <span style={{ fontSize: 14.5, color: "var(--ink-2)" }}>
                      {live.length > 0
                        ? `${live.length} running now`
                        : `${businessJobs.length} finished — click to see`}
                    </span>
                  </summary>
                  <div style={{ padding: "0 18px 16px", borderTop: "1px solid var(--rule)" }}>
                    {businessJobs.map((job) => (
                      <JobLine key={job.id} job={job} compact />
                    ))}
                  </div>
                </details>
              </div>
            );
          })()}
              </>
            )}

            {tab === "calls" && outcomes && outcomes.length > 0 && (
              <Panel title={`Previous attempts (${outcomes.length})`}>
                {outcomes.map((o, i) => (
                  <div key={i} style={{ display: "flex", gap: 14, padding: "11px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)", fontSize: 15.5 }}>
                    <span style={{ flex: "0 0 100px", color: "var(--ink-3)" }}>{new Date(o.created_at).toLocaleDateString()}</span>
                    <span style={{ flex: 1 }}>
                      {o.channel} · {o.result.replace(/_/g, " ")}
                      {o.objection !== "none" ? ` · ${o.objection.replace(/_/g, " ")}` : ""}
                      {o.notes ? <div style={{ color: "var(--ink-3)", fontSize: 15 }}>{o.notes}</div> : null}
                    </span>
                  </div>
                ))}
              </Panel>
            )}
          </div>

          {/* ================= RIGHT: why, explained ================= */}
          {(tab === "overview" || tab === "checks") && (
          <div>
            {tab === "overview" && (
            <>
        {/*
          * Everything known about them, in one place, grouped by who told us.
          *
          * The operator's report was that opening a business did not show what the system knows.
          * It was accurate: Google's rating and review count, the YouTube channel, the speed
          * measurement, the page title and the crawl result were all stored and none of them
          * appeared anywhere. Grouping by source rather than by subject is deliberate - these facts
          * have very different reliability, and a screen that mixes them teaches the operator to
          * trust them equally.
          */}
        <Panel
          title="Everything we know about them"
          hint="Grouped by where each fact came from, because they are not all equally reliable. Anything blank says so rather than being left empty."
          tone="info"
        >
          <div style={GROUP_HEAD("var(--info-ink)")}>From their Google listing</div>
          <FactGrid>
            <Fact label="Rating" value={rating ? <Stars rating={Number(rating)} /> : null} missing="Not bought" from="Google Places" />
            <Fact
              label="Reviews"
              value={reviewCount ? Number(reviewCount).toLocaleString("en-GB") : null}
              missing="Not bought"
              from="Google Places"
            />
            <Fact label="Phone" value={phone ? <a href={`tel:${phone}`}>{phone}</a> : null} missing="None listed" from="Google Places" />
            <Fact label="Google files them under" value={googleCategory} missing="Not recorded" from="Google Places" />
            <Fact
              label="Still trading?"
              value={businessStatus === "operational" ? "Yes, operational" : businessStatus}
              missing="Not checked"
              from="Google Places"
              tone={businessStatus === "operational" ? "good" : businessStatus ? "warn" : undefined}
            />
            <Fact
              label="Listing bought?"
              value={listingOutcome === "ok" ? "Yes, rating and reviews are real" : listingOutcome}
              missing="Not bought yet"
              from={listingOutcome ? "3.5c already spent with Google" : "would cost 3.5c with Google"}
            />
          </FactGrid>

          <div style={{ ...GROUP_HEAD("var(--good-ink)"), borderTop: "1px solid var(--rule)", marginTop: 4 }}>
            From their own website &mdash; free, our own crawler
          </div>
          <FactGrid>
            <Fact
              label="Website"
              value={domain ? <a href={`https://${domain}`} target="_blank" rel="noreferrer noopener">{domain} &#8599;</a> : null}
              missing="None found"
              from={WEBSITE_LABELS[business.website_status] ?? business.website_status}
            />
            <Fact label="What the site calls itself" value={site.title} missing="No title tag" from="their home page" />
            <Fact
              label="Pages the crawler read"
              value={site.pagesRead}
              missing="None read"
              from={site.crawlOutcome ?? "not crawled"}
            />
            {/*
              * Shown only when a browser did better, which is the case worth explaining. A record
              * that says "403, 0 pages" directly above five pages of that same site with screenshots
              * is a record contradicting itself, and the operator read it exactly that way.
              */}
            {site.browserPages ? (
              <Fact
                label="Pages a browser read"
                value={site.browserPages}
                from="the page-by-page audit got in where the crawler was refused"
                tone="good"
              />
            ) : null}
            <Fact
              label="Speed on a phone"
              value={perfScore ? `${perfScore} / 100` : null}
              missing="No score"
              from={lcp ? `main content appears in ${(Number(lcp) / 1000).toFixed(1)}s` : "Google PageSpeed, free"}
              tone={perfScore ? (Number(perfScore) >= 50 ? "good" : "bad") : undefined}
            />
            <Fact
              label="Email on their site"
              value={contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : null}
              missing="None found"
              from="their own pages"
            />
            <Fact label="Phone on their site" value={site.webPhone} missing="None found" from="their own pages" />
            <Fact
              label="Who to ask for"
              value={contactName}
              missing="Not stated anywhere"
              from={contactNameSource ? `stated on ${contactNameSource}` : "their about page"}
            />
            <Fact label="Server answered" value={site.httpStatus} missing="Never answered" from={site.crawlDetail ?? "our crawler"} />
          </FactGrid>

          <div style={{ ...GROUP_HEAD("var(--social-ink)"), borderTop: "1px solid var(--rule)", marginTop: 4 }}>
            Away from their own site
          </div>
          <FactGrid>
            <Fact
              label="Instagram"
              value={
                instagram.handle ? (
                  <a href={instagram.url ?? `https://instagram.com/${instagram.handle}`} target="_blank" rel="noreferrer noopener">
                    @{instagram.handle} &#8599;
                  </a>
                ) : null
              }
              missing="No account known"
              from={instagram.url ? "found on their website, or typed in" : "paste one below if you know it"}
            />
            <Fact
              label="Followers"
              value={instagram.followers ? Number(instagram.followers).toLocaleString("en-GB") : null}
              missing="Not bought"
              from={instagram.followers ? "Apify, 0.26c already spent" : "would cost 0.26c with Apify"}
              size="large"
              tone={instagram.followers && Number(instagram.followers) >= 10000 ? "good" : undefined}
            />
            <Fact label="Posts" value={instagram.posts} missing="Not bought" from="Apify" />
            <Fact label="Instagram files them under" value={instagram.category} missing="Not bought" from="Apify" />
            <Fact
              label="Facebook"
              value={metaAds.page ? <a href={metaAds.page} target="_blank" rel="noreferrer noopener">Their page &#8599;</a> : null}
              missing="None found"
              from="linked from their website"
            />
            <Fact
              label="Running ads?"
              value={
                metaAds.running === "true"
                  ? `Yes, ${metaAds.activeCount ?? "some"} live`
                  : metaAds.running === "false"
                    ? "No ads running"
                    : null
              }
              missing="Never checked"
              from={metaAds.checkedAt ? "Meta Ad Library, already bought" : "would cost 11.6c with Apify"}
              tone={metaAds.running === "true" ? "good" : undefined}
            />
            <Fact
              label="YouTube"
              value={youtube.channel}
              missing={youtube.outcome === "failed" ? "No channel found" : "Not checked"}
              from={
                youtube.latestVideoAt
                  ? `last video ${new Date(youtube.latestVideoAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`
                  : "YouTube Data API, free"
              }
            />
          </FactGrid>

          {instagram.bio && (
            <div style={{ padding: "0 18px 16px" }}>
              <div style={{ fontSize: 13.5, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-2)", fontWeight: 800 }}>
                What their Instagram bio says
              </div>
              <div style={{ fontSize: 15.5, color: "var(--ink)", marginTop: 4, lineHeight: 1.6, whiteSpace: "pre-wrap", maxWidth: 720 }}>
                {instagram.bio}
              </div>
            </div>
          )}
        </Panel>

            </>
            )}
            {tab === "overview" && (
            <Panel
              title="Instagram and ads"
              hint="What they do away from their own website, and whether they already pay to be seen."
            >
              <div style={{ padding: "14px 18px", display: "grid", gap: 16 }}>
                <div>
                  <div style={label}>Instagram</div>
                  {instagram.handle ? (
                    <>
                      <div style={{ fontSize: 17.5, fontWeight: 600, marginTop: 3 }}>
                        <a href={`https://instagram.com/${instagram.handle}`} target="_blank" rel="noreferrer noopener">
                          @{instagram.handle} &#8599;
                        </a>
                        {instagram.verified === "true" ? (
                          <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}> &middot; verified</span>
                        ) : null}
                      </div>
                      <div style={{ display: "flex", gap: 24, marginTop: 9, flexWrap: "wrap" }}>
                        <Figure
                          value={instagram.followers ? Number(instagram.followers).toLocaleString() : "not shown"}
                          label="followers"
                        />
                        <Figure value={instagram.posts ? Number(instagram.posts).toLocaleString() : "—"} label="posts" />
                        <Figure value={instagram.category ?? "—"} label="Instagram's own category" />
                      </div>
                      {instagram.bio ? (
                        <p style={{ fontSize: 15, color: "var(--ink-2)", margin: "11px 0 0", lineHeight: 1.5 }}>
                          &ldquo;{instagram.bio}&rdquo;
                        </p>
                      ) : null}
                      {instagram.isPrivate === "true" ? (
                        <p style={{ fontSize: 14.5, color: "var(--ink-3)", margin: "7px 0 0", lineHeight: 1.45 }}>
                          This account is private, so Instagram withholds the follower count. That is
                          why it reads &ldquo;not shown&rdquo; rather than zero.
                        </p>
                      ) : null}
                    </>
                  ) : !instagram.url ? (
                    /* No link, and no way for the crawler to find one — this business has no site
                       to crawl. Typing it is the only route, and it is the route to Priority 1:
                       10,000 followers qualifies on its own. */
                    <form action={saveInstagramUrl} style={{ marginTop: 6 }}>
                      <input type="hidden" name="id" value={id} />
                      <div style={{ fontSize: 15, color: "var(--ink-2)", marginBottom: 7, lineHeight: 1.55 }}>
                        {business.website_status === "unclear" ? (
                          <>
                            No website to find one on, so nobody can look this up for you. Paste it
                            and a large following can carry them to Priority 1 on its own.
                          </>
                        ) : (
                          <>No Instagram link was found on their website. Paste one if you know it.</>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input
                          name="instagram"
                          placeholder="instagram.com/theirname"
                          style={{ ...input, flex: "1 1 210px", minWidth: 0 }}
                        />
                        <button className="btn-2 btn" type="submit" style={{ fontSize: 15 }}>
                          Save
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div style={{ fontSize: 15, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>
                      Their website links to{" "}
                      <a href={instagram.url} target="_blank" rel="noreferrer noopener">
                        an Instagram account
                      </a>
                      , and nobody has looked it up yet. Tick this business on the leads list to buy
                      it &mdash; it costs a fraction of a cent.
                    </div>
                  )}
                </div>

                <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
                  <div style={label}>Facebook &amp; Instagram ads</div>
                  {metaAds.checkedAt ? (
                    <>
                      <div style={{ fontSize: 17.5, fontWeight: 600, marginTop: 3 }}>
                        {metaAds.running === "true"
                          ? `Running ${metaAds.activeCount ?? ""} ad${metaAds.activeCount === "1" ? "" : "s"} right now`
                          : "Not running any ads"}
                      </div>
                      {metaAds.since ? (
                        <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 2 }}>
                          advertising since {metaAds.since}
                          {metaAds.platforms ? ` on ${metaAds.platforms}` : ""}
                        </div>
                      ) : null}
                      {metaAds.sample ? (
                        <p style={{ fontSize: 14.5, color: "var(--ink-2)", margin: "10px 0 0", lineHeight: 1.5 }}>
                          &ldquo;{metaAds.sample.split(" \u23D0 ")[0]}&rdquo;
                        </p>
                      ) : null}
                      <p style={{ fontSize: 14.5, color: "var(--ink-3)", margin: "11px 0 0", lineHeight: 1.45 }}>
                        <strong>What they spend is not shown, and cannot be.</strong> Meta publishes
                        ad spend only for political and social-issue ads; for an ordinary business it
                        is empty in Meta&rsquo;s own Ad Library, so no tool or provider can supply
                        it at any price.
                      </p>
                    </>
                  ) : metaAds.page ? (
                    <div style={{ fontSize: 15, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>
                      They have{" "}
                      <a href={metaAds.page} target="_blank" rel="noreferrer noopener">
                        a Facebook page
                      </a>
                      , and nobody has checked whether it is running ads.
                    </div>
                  ) : (
                    <div style={{ fontSize: 15, color: "var(--ink-3)", marginTop: 4 }}>
                      No Facebook page was found on their website.
                    </div>
                  )}
                </div>
              </div>
            </Panel>
            )}

            {tab === "checks" && (
            <Panel
              title="Score by area"
              hint="Each area is scored only on the checks we could actually run for it. 100 means everything we checked was wrong."
            >
              {areaScores.map((a, i) => (
                <div key={a.area} style={{ padding: "12px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                    <strong style={{ fontSize: 15.5 }}>{AREA_LABELS[a.area] ?? a.area}</strong>
                    <span style={{ fontSize: 15.5, fontWeight: 700, color: a.enoughData ? "var(--ink)" : "var(--ink-3)" }}>
                      {a.enoughData ? `${a.score} / 100` : "no data"}
                    </span>
                  </div>
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginBottom: 6 }}>{AREA_EXPLAIN[a.area]}</div>
                  <Meter value={a.enoughData ? a.score : null} tone="problem" />
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 5 }}>
                    {a.enoughData
                      ? `${a.firedPoints} of the ${a.measuredPoints} points we could check came back wrong.`
                      : `We could only check ${Math.round(a.coverage * 100)}% of this area — too little to score fairly, so it is left out.`}
                  </div>
                </div>
              ))}
            </Panel>
            )}

            {tab === "checks" && (
            <Panel
              title="How busy is their website?"
              hint="An honest signal, not a visitor count — see the note below."
            >
              <div style={{ padding: "14px 18px" }}>
                {crux ? (
                  <>
                    <div style={{ fontSize: 17.5, fontWeight: 600, marginBottom: 4 }}>
                      Google has real visitor data for this site
                    </div>
                    <div style={{ fontSize: 15, color: "var(--ink-2)" }}>
                      Enough people visit that Google collects real speed measurements from their
                      browsers. For a small local business that means meaningful traffic — and
                      Google rates the experience as <strong>{crux.toLowerCase()}</strong>.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 17.5, fontWeight: 600, marginBottom: 4 }}>Very little traffic</div>
                    <div style={{ fontSize: 15, color: "var(--ink-2)" }}>
                      Google does not have enough real visits to this site to report speed data from
                      actual users. That threshold is low, so it usually means the site gets very few
                      visitors.
                    </div>
                  </>
                )}
                {(perfScore || lcp) && (
                  <div style={{ marginTop: 12, fontSize: 15, color: "var(--ink-3)" }}>
                    Speed test: {perfScore ? <strong>{perfScore}/100</strong> : "—"}
                    {lcp ? ` · main content appears in ${(Number(lcp) / 1000).toFixed(1)}s on a phone` : ""}
                  </div>
                )}
              </div>
              <Note>
                <strong>We cannot show monthly visitor numbers.</strong> Nobody can measure another
                company&rsquo;s traffic for free — the tools that estimate it (Similarweb, Semrush)
                are paid subscriptions, and their numbers are estimates too. The signal above is the
                honest free version: Google either has real visit data for the site, or it does not.
              </Note>
            </Panel>
            )}
          </div>
          )}
        </div>

        {/* ---- Folded detail: every check, and where every value came from ---- */}
        {tab === "checks" && (
        <>
        <h2 style={{ fontSize: 15, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)", margin: "26px 0 12px" }}>
          The full detail
        </h2>

        <details style={detailPanel}>
          <summary style={detailSummary}>Every single check — {problems.length} wrong, {clean.length} fine, {unmeasured.length} we couldn&rsquo;t measure</summary>
          <div style={{ borderTop: "1px solid var(--rule)" }}>
            {[...problems, ...clean, ...unmeasured].map((f) => (
              <div key={f.check_id} style={{ display: "flex", gap: 14, ...TD }}>
                <span style={{ flex: "0 0 90px" }}>
                  <span
                    style={{
                      fontSize: 14.5,
                      padding: "2px 7px",
                      borderRadius: 3,
                      border: "1px solid var(--rule)",
                      color: f.outcome === "fired" ? "var(--bad)" : f.outcome === "passed" ? "var(--good-ink)" : "var(--ink-3)",
                    }}
                  >
                    {f.outcome === "fired" ? "problem" : f.outcome === "passed" ? "fine" : "unknown"}
                  </span>
                </span>
                <span style={{ flex: "0 0 150px", color: "var(--ink-3)", fontSize: 14.5 }}>
                  {AREA_LABELS[f.area ?? ""] ?? "Buying signal"}
                </span>
                <span style={{ flex: 1 }}>{f.evidence}</span>
              </div>
            ))}
          </div>
          <Note>
            A check we could not run is never counted as a pass. They are listed here so
            &ldquo;nothing wrong&rdquo; can never quietly mean &ldquo;we didn&rsquo;t look&rdquo;.
          </Note>
        </details>

        {credits.length > 0 && (
          <details style={detailPanel}>
            <summary style={detailSummary}>Signs they spend money ({credits.length})</summary>
            <div style={{ borderTop: "1px solid var(--rule)" }}>
              {credits.map((f) => (
                <div key={f.check_id} style={TD}>
                  {f.evidence}
                </div>
              ))}
            </div>
          </details>
        )}

        <details style={detailPanel}>
          <summary style={detailSummary}>Where every value came from ({(fields?.length ?? 0) + (keys?.length ?? 0)})</summary>
          <div style={{ borderTop: "1px solid var(--rule)" }}>
            {(keys ?? []).map((k) => (
              <div key={k.key_type + k.key_value} style={{ display: "flex", gap: 14, ...TD }}>
                <span style={rowKey}>{k.key_type.replace(/_/g, " ")}</span>
                <span style={{ flex: 1, fontFamily: "monospace", fontSize: 14.5 }}>{k.key_value}</span>
              </div>
            ))}
            {(fields ?? []).map((f) => (
              <div key={f.field_name} style={{ display: "flex", gap: 14, ...TD }}>
                <span style={rowKey}>{f.field_name.replace(/_/g, " ")}</span>
                <span style={{ flex: 1 }}>
                  {f.value}
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                    {f.source_name} · checked {new Date(f.last_verified_at).toLocaleDateString()}
                  </div>
                </span>
              </div>
            ))}
          </div>
        </details>
        </>
        )}
      </>
    </AppShell>
  );
}

/** A number with its word underneath, for the Instagram figures. */
function Figure({ value, label: text }: { value: string; label: string }) {
  return (
    <span>
      <span style={{ display: "block", fontSize: 20.5, fontWeight: 700, lineHeight: 1.15 }}>{value}</span>
      <span style={{ display: "block", fontSize: 14.5, color: "var(--ink-3)", marginTop: 1 }}>{text}</span>
    </span>
  );
}
