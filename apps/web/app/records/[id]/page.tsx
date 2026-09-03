import { buildOpeners, type CheckResult } from "@lead-intel/core";
import { BUSINESS_ORIGIN_LABELS, type BusinessOrigin } from "@lead-intel/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { explainBusiness } from "./explain-actions";
import {
  AppShell,
  AREA_EXPLAIN,
  AREA_LABELS,
  Meter,
  Note,
  PANEL,
  Panel,
  ROUTE_LABELS,
  TD,
  TIER_MEANING,
  TierBadge,
  WEBSITE_LABELS,
} from "../../ui";
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
  fontSize: 13,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};
const input: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 14,
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
  fontSize: 13.5,
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

export default async function RecordDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const { data: business } = await supabase.from("businesses").select("*").eq("id", id).maybeSingle();
  if (!business) notFound();

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
      .select("channel, result, objection, notes, created_at")
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
  const metaAds = {
    page: fieldValue("facebook_url"),
    running: fieldValue("meta_ads_running"),
    activeCount: fieldValue("meta_ads_active_count"),
    since: fieldValue("meta_ads_since"),
    platforms: fieldValue("meta_ads_platforms"),
    sample: fieldValue("meta_ads_sample"),
    checkedAt: fieldValue("meta_ads_checked_at"),
  };

  const problems = (findings ?? []).filter((f) => f.outcome === "fired" && f.family !== "N");
  const credits = (findings ?? []).filter((f) => f.outcome === "fired" && f.family === "N");
  const clean = (findings ?? []).filter((f) => f.outcome === "passed");
  const unmeasured = (findings ?? []).filter((f) => f.outcome === "not_measured");
  const areaScores = readAreaScores(business.area_scores);
  const openerArea = business.route ? ROUTE_TO_AREA[business.route] : null;

  const openers = buildOpeners({
    businessName: business.display_name,
    city: business.city ?? null,
    route: business.route ?? null,
    findings: (findings ?? []) as unknown as CheckResult[],
  });

  const problem = business.problem_score as number | null;
  const intent = business.intent_score as number | null;
  const crux = fieldValue("crux_category");
  const perfScore = fieldValue("performance_score");
  const lcp = fieldValue("lcp_ms");

  return (
    <AppShell wide back={{ href: "/records", label: "Back to all leads" }}>

      <>
        {/* ---- Header: who they are and how to reach them ---- */}
        <div style={{ ...PANEL, padding: "20px 22px", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 24, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 380px" }}>
              <h1 style={{ fontSize: 27, margin: "0 0 3px", lineHeight: 1.2 }}>{business.display_name}</h1>
              <p style={{ margin: "0 0 16px", color: "var(--ink-3)", fontSize: 14.5 }}>
                {[business.city, business.state].filter(Boolean).join(", ") || "Location not recorded"}
              </p>
              <div style={{ display: "flex", gap: 30, flexWrap: "wrap", rowGap: 16 }}>
                <span>
                  <div style={label}>Phone</div>
                  <div style={{ fontSize: 19, fontWeight: 600, marginTop: 2 }}>
                    {phone ? <a href={`tel:${phone}`}>{phone}</a> : <span style={{ color: "var(--ink-3)" }}>Not found</span>}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)" }}>from their Google listing</div>
                </span>

                {/* Free, and previously invisible: the crawler has been pulling these off the
                    business's own pages all along and storing them inside a check's detail. */}
                {contactEmail && (
                  <span>
                    <div style={label}>Email</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>
                      <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--ink-3)" }}>from their own website</div>
                  </span>
                )}

                {contactName && (
                  <span>
                    <div style={label}>Who to ask for</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>{contactName}</div>
                    <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                      {contactNameSource ? `stated on ${contactNameSource}` : "from their own website"}
                    </div>
                  </span>
                )}

                <span>
                  <div style={label}>Website</div>
                  <div style={{ fontSize: 16, marginTop: 4 }}>
                    {domain ? (
                      <a href={`https://${domain}`} target="_blank" rel="noreferrer noopener">
                        {domain} ↗
                      </a>
                    ) : (
                      <span style={{ color: "var(--ink-3)" }}>None on their Google listing</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                    {WEBSITE_LABELS[business.website_status] ?? business.website_status}
                  </div>
                </span>

                {/* Where the record came from, next to everything else about it. On this page it
                    is shown for all three origins, not only the unusual ones: the whole point of
                    opening a lead is to see what is behind its numbers, and an imported record's
                    Problem score rests on four areas rather than six. */}
                <span>
                  <div style={label}>Where from</div>
                  <div style={{ fontSize: 16, marginTop: 4 }}>
                    {BUSINESS_ORIGIN_LABELS[business.origin as BusinessOrigin]?.label ?? business.origin}
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)", maxWidth: 300, lineHeight: 1.4 }}>
                    {importFilename
                      ? `Row of ${importFilename}`
                      : (BUSINESS_ORIGIN_LABELS[business.origin as BusinessOrigin]?.explain ?? "")}
                  </div>
                </span>
              </div>
            </div>
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              {business.claim_status === "unclaimed" ? (
                <form action={claimBusiness.bind(null, business.id)}>
                  <button className="btn" type="submit">
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
                <span style={{ fontSize: 14, color: "var(--ink-3)" }}>Claimed by someone else</span>
              )}
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
                fontSize: 13.5,
                color: "var(--ink-2)",
              }}
            >
              <strong>Check this one by hand before calling.</strong> {business.route_reason ?? ""}
            </p>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
          {/* ================= LEFT: what to do ================= */}
          <div>
            <Panel
              title="What to say when they answer"
              hint="Built from one specific thing we found. If we had nothing solid, no line is suggested at all."
              tone="brand"
            >
              {openers.openers.length === 0 ? (
                <div style={{ padding: 18, color: "var(--ink-3)", fontSize: 14.5 }}>{openers.reason}</div>
              ) : (
                openers.openers.map((o, i) => (
                  <div
                    key={o.channel}
                    style={{ padding: "15px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}
                  >
                    <div style={{ ...label, marginBottom: 7 }}>{o.channel === "call" ? "On the phone" : "As a message"}</div>
                    <p style={{ margin: "0 0 8px", fontSize: 16.5, lineHeight: 1.55 }}>&ldquo;{o.text}&rdquo;</p>
                    <div style={{ fontSize: 13, color: "var(--ink-3)" }}>Because we found: {o.evidence}</div>
                  </div>
                ))
              )}
            </Panel>

            {/* Off-site presence, in its own panel. It is bought separately from the free crawl,
                arrives separately, and answers a different question — so mixing it into the
                website findings would blur where each fact came from. */}
            <Panel
              title="Instagram and ads"
              hint="What they do away from their own website, and whether they already pay to be seen."
            >
              <div style={{ padding: "14px 18px", display: "grid", gap: 16 }}>
                <div>
                  <div style={label}>Instagram</div>
                  {instagram.handle ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>
                        <a href={`https://instagram.com/${instagram.handle}`} target="_blank" rel="noreferrer noopener">
                          @{instagram.handle} &#8599;
                        </a>
                        {instagram.verified === "true" ? (
                          <span style={{ fontSize: 13, color: "var(--ink-3)" }}> &middot; verified</span>
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
                        <p style={{ fontSize: 13.5, color: "var(--ink-2)", margin: "11px 0 0", lineHeight: 1.5 }}>
                          &ldquo;{instagram.bio}&rdquo;
                        </p>
                      ) : null}
                      {instagram.isPrivate === "true" ? (
                        <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "7px 0 0", lineHeight: 1.45 }}>
                          This account is private, so Instagram withholds the follower count. That is
                          why it reads &ldquo;not shown&rdquo; rather than zero.
                        </p>
                      ) : null}
                    </>
                  ) : instagram.url ? (
                    <div style={{ fontSize: 13.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>
                      Their website links to{" "}
                      <a href={instagram.url} target="_blank" rel="noreferrer noopener">
                        an Instagram account
                      </a>
                      , and nobody has looked it up yet. Tick this business on the leads list to buy
                      it &mdash; it costs a fraction of a cent.
                    </div>
                  ) : (
                    <div style={{ fontSize: 13.5, color: "var(--ink-3)", marginTop: 4 }}>
                      No Instagram link was found on their website.
                    </div>
                  )}
                </div>

                <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
                  <div style={label}>Facebook &amp; Instagram ads</div>
                  {metaAds.checkedAt ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>
                        {metaAds.running === "true"
                          ? `Running ${metaAds.activeCount ?? ""} ad${metaAds.activeCount === "1" ? "" : "s"} right now`
                          : "Not running any ads"}
                      </div>
                      {metaAds.since ? (
                        <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 2 }}>
                          advertising since {metaAds.since}
                          {metaAds.platforms ? ` on ${metaAds.platforms}` : ""}
                        </div>
                      ) : null}
                      {metaAds.sample ? (
                        <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "10px 0 0", lineHeight: 1.5 }}>
                          &ldquo;{metaAds.sample.split(" \u23D0 ")[0]}&rdquo;
                        </p>
                      ) : null}
                      <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "11px 0 0", lineHeight: 1.45 }}>
                        <strong>What they spend is not shown, and cannot be.</strong> Meta publishes
                        ad spend only for political and social-issue ads; for an ordinary business it
                        is empty in Meta&rsquo;s own Ad Library, so no tool or provider can supply
                        it at any price.
                      </p>
                    </>
                  ) : metaAds.page ? (
                    <div style={{ fontSize: 13.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.5 }}>
                      They have{" "}
                      <a href={metaAds.page} target="_blank" rel="noreferrer noopener">
                        a Facebook page
                      </a>
                      , and nobody has checked whether it is running ads.
                    </div>
                  ) : (
                    <div style={{ fontSize: 13.5, color: "var(--ink-3)", marginTop: 4 }}>
                      No Facebook page was found on their website.
                    </div>
                  )}
                </div>
              </div>
            </Panel>

            {/* The briefing sits directly above the findings it was written from, and the findings
                are unchanged. That arrangement is the whole safety design: if the paragraph is
                wrong, the real thing is one line below it, in the operator's own words —
                "ager AI ne sahi se explain nhi kia to mai points read kerloon". */}
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
                <strong style={{ fontSize: 15 }}>✨ In plain words</strong>
                <form action={explainBusiness} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <input type="hidden" name="id" value={id} />
                  <button className="btn-2 btn" type="submit" style={{ fontSize: 13 }}>
                    {aiSummary ? "Write it again" : "Explain this business"}
                  </button>
                </form>
              </div>

              {aiSummary ? (
                <div style={{ padding: "15px 18px" }}>
                  {String(aiSummary)
                    .split(/\n{2,}/)
                    .map((para: string, i: number) => (
                    <p key={i} style={{ margin: i === 0 ? "0 0 10px" : "0 0 10px", fontSize: 15, lineHeight: 1.65 }}>
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
                        fontSize: 13.5,
                        lineHeight: 1.55,
                      }}
                    >
                      🏷️ <strong>This may be in the wrong category.</strong> You file them under{" "}
                      <strong>{business.category ?? "nothing yet"}</strong>. {aiCategoryNote}{" "}
                      <Link href="/categories">Adjust your rules</Link> — the category itself is only
                      ever set by your rules, never by this.
                    </div>
                  )}

                  <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 12, lineHeight: 1.6 }}>
                    Written by <strong>gemini-2.5-flash</strong>
                    {aiWrittenAt ? ` on ${new Date(aiWrittenAt).toLocaleDateString("en-GB")}` : ""} from the{" "}
                    {problems.length} findings below and their website text.{" "}
                    <strong>It can be wrong.</strong> Everything it says should appear in the findings
                    below — if it does not, trust the findings and not this.
                  </div>
                </div>
              ) : (
                <div style={{ padding: "15px 18px", fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6 }}>
                  A short briefing written from the findings below and their website text, so you can
                  read one paragraph instead of {problems.length} lines before ringing them. Costs
                  about a third of a cent, and the findings stay exactly as they are underneath.
                </div>
              )}
            </div>

            <Panel title={`The biggest problems (${problems.length})`} hint="Ordered by how much each one matters.">
              {problems.length === 0 ? (
                <div style={{ padding: 18, color: "var(--ink-3)", fontSize: 14 }}>
                  Nothing the free checks look for is wrong with this business.
                </div>
              ) : (
                problems.slice(0, 8).map((f, i) => (
                  <div key={f.check_id} style={{ display: "flex", gap: 14, padding: "11px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)", fontSize: 14 }}>
                    <span style={{ flex: "0 0 150px", color: "var(--ink-3)", fontSize: 13 }}>
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

            {outcomes && outcomes.length > 0 && (
              <Panel title={`Previous attempts (${outcomes.length})`}>
                {outcomes.map((o, i) => (
                  <div key={i} style={{ display: "flex", gap: 14, padding: "11px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)", fontSize: 14 }}>
                    <span style={{ flex: "0 0 100px", color: "var(--ink-3)" }}>{new Date(o.created_at).toLocaleDateString()}</span>
                    <span style={{ flex: 1 }}>
                      {o.channel} · {o.result.replace(/_/g, " ")}
                      {o.objection !== "none" ? ` · ${o.objection.replace(/_/g, " ")}` : ""}
                      {o.notes ? <div style={{ color: "var(--ink-3)", fontSize: 13.5 }}>{o.notes}</div> : null}
                    </span>
                  </div>
                ))}
              </Panel>
            )}
          </div>

          {/* ================= RIGHT: why, explained ================= */}
          <div>
            <Panel title="Why this lead, in plain terms">
              <div style={{ padding: "16px 18px" }}>
                {problem === null ? (
                  <p style={{ margin: 0, fontSize: 14.5, color: "var(--ink-2)" }}>
                    <strong>We could not score this business.</strong>{" "}
                    {business.route_reason ?? "Too little could be measured."} That is not a judgement
                    about them — it means we could not read enough to have an opinion.
                  </p>
                ) : (
                  <>
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ ...label, marginBottom: 4 }}>Sell them</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>
                        {business.route ? ROUTE_LABELS[business.route] ?? business.route : "Nothing solid enough yet"}
                      </div>
                      {business.route_reason && (
                        <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 3 }}>{business.route_reason}</div>
                      )}
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 4 }}>
                        <strong>Problem score — how much is wrong</strong>
                        <span style={{ fontWeight: 700 }}>{problem} / 100</span>
                      </div>
                      <Meter value={problem} tone="problem" height={10} />
                      <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
                        {problem >= 55
                          ? "Above 55, so there is enough wrong here to be worth a call."
                          : "Below 55 — not much is wrong, so this is a harder conversation to open."}
                      </div>
                    </div>

                    <div style={{ marginBottom: 16 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 4 }}>
                        <strong>Buying signals — do they spend money?</strong>
                        <span style={{ fontWeight: 700 }}>{intent ?? 0} / 100</span>
                      </div>
                      <Meter value={intent} tone="good" height={10} />
                      <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4 }}>
                        {(intent ?? 0) >= 35
                          ? "Above 35 — they already pay for tools or advertising, so there is a budget."
                          : "Below 35 — we found little sign they currently pay for anything."}
                      </div>
                    </div>

                    {/* The question the operator actually asked: why is this Priority 1? */}
                    <div style={{ padding: "13px 14px", background: "var(--surface-2)", borderRadius: 5 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        <TierBadge tier={business.tier} />
                        <strong style={{ fontSize: 14.5 }}>
                          {business.tier ? `Priority ${business.tier}` : "No priority"}
                        </strong>
                      </div>
                      <div style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
                        {business.tier ? (
                          <>
                            {TIER_MEANING[business.tier]}.
                            <div style={{ marginTop: 7, color: "var(--ink-3)", fontSize: 13 }}>
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

            <Panel
              title="Score by area"
              hint="Each area is scored only on the checks we could actually run for it. 100 means everything we checked was wrong."
            >
              {areaScores.map((a, i) => (
                <div key={a.area} style={{ padding: "12px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
                    <strong style={{ fontSize: 14 }}>{AREA_LABELS[a.area] ?? a.area}</strong>
                    <span style={{ fontSize: 14, fontWeight: 700, color: a.enoughData ? "var(--ink)" : "var(--ink-3)" }}>
                      {a.enoughData ? `${a.score} / 100` : "no data"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 6 }}>{AREA_EXPLAIN[a.area]}</div>
                  <Meter value={a.enoughData ? a.score : null} tone="problem" />
                  <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 5 }}>
                    {a.enoughData
                      ? `${a.firedPoints} of the ${a.measuredPoints} points we could check came back wrong.`
                      : `We could only check ${Math.round(a.coverage * 100)}% of this area — too little to score fairly, so it is left out.`}
                  </div>
                </div>
              ))}
            </Panel>

            <Panel
              title="How busy is their website?"
              hint="An honest signal, not a visitor count — see the note below."
            >
              <div style={{ padding: "14px 18px" }}>
                {crux ? (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                      Google has real visitor data for this site
                    </div>
                    <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
                      Enough people visit that Google collects real speed measurements from their
                      browsers. For a small local business that means meaningful traffic — and
                      Google rates the experience as <strong>{crux.toLowerCase()}</strong>.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Very little traffic</div>
                    <div style={{ fontSize: 13.5, color: "var(--ink-2)" }}>
                      Google does not have enough real visits to this site to report speed data from
                      actual users. That threshold is low, so it usually means the site gets very few
                      visitors.
                    </div>
                  </>
                )}
                {(perfScore || lcp) && (
                  <div style={{ marginTop: 12, fontSize: 13.5, color: "var(--ink-3)" }}>
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
          </div>
        </div>

        {/* ---- Folded detail ---- */}
        <h2 style={{ fontSize: 13.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)", margin: "26px 0 12px" }}>
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
                      fontSize: 13,
                      padding: "2px 7px",
                      borderRadius: 3,
                      border: "1px solid var(--rule)",
                      color: f.outcome === "fired" ? "var(--bad)" : f.outcome === "passed" ? "var(--good-ink)" : "var(--ink-3)",
                    }}
                  >
                    {f.outcome === "fired" ? "problem" : f.outcome === "passed" ? "fine" : "unknown"}
                  </span>
                </span>
                <span style={{ flex: "0 0 150px", color: "var(--ink-3)", fontSize: 13 }}>
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
                <span style={{ flex: 1, fontFamily: "monospace", fontSize: 13 }}>{k.key_value}</span>
              </div>
            ))}
            {(fields ?? []).map((f) => (
              <div key={f.field_name} style={{ display: "flex", gap: 14, ...TD }}>
                <span style={rowKey}>{f.field_name.replace(/_/g, " ")}</span>
                <span style={{ flex: 1 }}>
                  {f.value}
                  <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
                    {f.source_name} · checked {new Date(f.last_verified_at).toLocaleDateString()}
                  </div>
                </span>
              </div>
            ))}
          </div>
        </details>
      </>
    </AppShell>
  );
}

/** A number with its word underneath, for the Instagram figures. */
function Figure({ value, label: text }: { value: string; label: string }) {
  return (
    <span>
      <span style={{ display: "block", fontSize: 19, fontWeight: 700, lineHeight: 1.15 }}>{value}</span>
      <span style={{ display: "block", fontSize: 13, color: "var(--ink-3)", marginTop: 1 }}>{text}</span>
    </span>
  );
}
