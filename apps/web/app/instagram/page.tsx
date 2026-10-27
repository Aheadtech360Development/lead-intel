import { formatCents } from "@lead-intel/core";
import { ENRICHMENT_DEFINITIONS } from "@lead-intel/shared";
import Link from "next/link";
import { instagramCandidateIds } from "@/lib/instagram-candidates";
import { createClient } from "@/lib/supabase/server";
import { getViewer, leadScope } from "@/lib/viewer";
import { signOut } from "../actions";
import { AppShell, Badge, FilterOption, FilterSection, InfoBox, Note, PANEL, Panel, TD, Th, TierBadge } from "../ui";

/**
 * Instagram, on its own screen.
 *
 * The operator asked for this in as many words: Instagram data shown separately, with as many
 * filters as it takes to squeeze the right person out of it. The leads list answers "who should I
 * call"; this answers a different question — "of the accounts I have looked up, which ones are the
 * shape of business I want" — and mixing the two into one table made both harder to read.
 *
 * The screen is honest about the gap between what is linked and what is known. A business whose
 * website links an Instagram account is not a business whose followers we have; the second costs
 * money and the first does not. Those are two different numbers and they are shown as two different
 * numbers, because treating "has a link" as "has data" is how a screen ends up quietly reporting
 * zero followers for accounts nobody has ever looked at.
 */

interface Params {
  followers?: string;
  cat?: string;
  mine?: string;
  ads?: string;
  from?: string;
  posts?: string;
  sort?: string;
}

/** Follower bands, chosen so each says something different about how to approach the business. */
const BANDS: { key: string; label: string; hint: string; min: number; max: number | null }[] = [
  { key: "under1k", label: "Under 1,000", hint: "Barely started", min: 0, max: 999 },
  { key: "1k-5k", label: "1,000 – 5,000", hint: "Real but small", min: 1000, max: 4999 },
  { key: "5k-25k", label: "5,000 – 25,000", hint: "Working at it", min: 5000, max: 24999 },
  { key: "25k+", label: "25,000 and up", hint: "Has an audience", min: 25000, max: null },
];

export default async function InstagramPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const viewer = await getViewer();

  /** A member's social screen covers their own leads only. */
  const scope = viewer ? leadScope(viewer) : null;
  const claims = viewer ? { sub: viewer.id, email: viewer.email } : null;

  const [{ data: businessRows }, { data: fieldRows }, { data: batchRows }] = await Promise.all([
    (() => {
      let q = supabase
        .from("businesses")
        .select("id, display_name, city, state, tier, problem_score, route, origin, import_batch_id, icp_name")
        .eq("status", "active")
        .limit(5000);
      if (scope) q = q.eq(scope.column, scope.value);
      return q;
    })(),
    supabase
      .from("field_metadata")
      .select("business_id, field_name, value")
      .in("field_name", [
        "instagram_url",
        "instagram_handle",
        "instagram_followers",
        "instagram_posts",
        "instagram_category",
        "instagram_bio",
        "instagram_verified",
        "instagram_private",
        "meta_ads_running",
        "meta_ads_since",
      ])
      .limit(50000),
    supabase.from("import_batches").select("id, filename").eq("status", "imported"),
  ]);

  const batchNames = new Map((batchRows ?? []).map((b) => [b.id, b.filename ?? "an uploaded file"]));

  // One row per business, with whatever Instagram facts exist for it. Fields arrive as rows and are
  // folded here rather than joined, which keeps this to three queries however many fields there are.
  const facts = new Map<string, Record<string, string>>();
  /**
   * Keyed by business, so it has to be cut down to the businesses this viewer can see.
   *
   * `field_metadata` is pulled whole because PostgREST cannot filter it by "businesses this member
   * owns" without a join. Folding it blind would put the whole company's Instagram counts on a
   * member's screen — which is exactly what the member side promises it will never do.
   */
  const visible = new Set((businessRows ?? []).map((b) => b.id as string));
  for (const f of fieldRows ?? []) {
    if (!f.business_id) continue;
    if (scope && !visible.has(f.business_id)) continue;
    const bag = facts.get(f.business_id) ?? {};
    bag[f.field_name] = f.value;
    facts.set(f.business_id, bag);
  }

  type Row = {
    id: string;
    name: string;
    where: string;
    tier: number | null;
    problem: number | null;
    origin: string;
    batch: string | null;
    myIcp: string | null;
    url: string | null;
    handle: string | null;
    followers: number | null;
    posts: number | null;
    igCategory: string | null;
    bio: string | null;
    verified: boolean;
    isPrivate: boolean;
    adsRunning: string | null;
    adsSince: string | null;
  };

  const rows: Row[] = (businessRows ?? []).map((b) => {
    const f = facts.get(b.id) ?? {};
    // Number() on a stored string, and only kept when it actually parses. A follower count that
    // will not parse is unknown, never zero — zero is a claim about their account.
    const followers = f.instagram_followers === undefined ? null : Number(f.instagram_followers);
    const posts = f.instagram_posts === undefined ? null : Number(f.instagram_posts);
    return {
      id: b.id,
      name: b.display_name,
      where: [b.city, b.state].filter(Boolean).join(", ") || "Unknown",
      tier: b.tier,
      problem: b.problem_score === null ? null : Number(b.problem_score),
      origin: b.origin ?? "discovered",
      batch: b.import_batch_id,
      myIcp: b.icp_name,
      url: f.instagram_url ?? null,
      handle: f.instagram_handle ?? null,
      followers: followers !== null && Number.isFinite(followers) ? followers : null,
      posts: posts !== null && Number.isFinite(posts) ? posts : null,
      igCategory: f.instagram_category ?? null,
      bio: f.instagram_bio ?? null,
      verified: f.instagram_verified === "true",
      isPrivate: f.instagram_private === "true",
      adsRunning: f.meta_ads_running ?? null,
      adsSince: f.meta_ads_since ?? null,
    };
  });

  const linked = rows.filter((r) => r.url !== null || r.handle !== null);
  const lookedUp = rows.filter((r) => r.followers !== null || r.igCategory !== null);
  const notLookedUp = linked.filter((r) => r.followers === null && r.igCategory === null);
  const noLink = rows.length - linked.length;

  // Only businesses with something to show. A screen about Instagram that lists 168 businesses with
  // no Instagram is a screen about something else.
  const pool = linked;

  function matches(r: Row, f: Params): boolean {
    if (f.followers && f.followers !== "all") {
      if (f.followers === "unknown") {
        if (r.followers !== null) return false;
      } else {
        const band = BANDS.find((b) => b.key === f.followers);
        if (!band) return false;
        if (r.followers === null) return false;
        if (r.followers < band.min) return false;
        if (band.max !== null && r.followers > band.max) return false;
      }
    }
    if (f.cat && f.cat !== "all") {
      if (f.cat === "none") {
        if (r.igCategory) return false;
      } else if (r.igCategory !== f.cat) return false;
    }
    if (f.mine && f.mine !== "all") {
      if (f.mine === "none") {
        if (r.myIcp) return false;
      } else if (r.myIcp !== f.mine) return false;
    }
    if (f.ads && f.ads !== "all") {
      if (f.ads === "yes" && r.adsRunning !== "true") return false;
      if (f.ads === "no" && r.adsRunning !== "false") return false;
      if (f.ads === "unknown" && r.adsRunning !== null) return false;
    }
    if (f.from && f.from !== "all" && r.origin !== f.from) return false;
    if (f.posts && f.posts !== "all") {
      if (f.posts === "verified" && !r.verified) return false;
      if (f.posts === "private" && !r.isPrivate) return false;
    }
    return true;
  }

  const current: Params = {
    ...(params.followers && params.followers !== "all" ? { followers: params.followers } : {}),
    ...(params.cat && params.cat !== "all" ? { cat: params.cat } : {}),
    ...(params.mine && params.mine !== "all" ? { mine: params.mine } : {}),
    ...(params.ads && params.ads !== "all" ? { ads: params.ads } : {}),
    ...(params.from && params.from !== "all" ? { from: params.from } : {}),
    ...(params.posts && params.posts !== "all" ? { posts: params.posts } : {}),
    ...(params.sort ? { sort: params.sort } : {}),
  };

  const shown = pool.filter((r) => matches(r, current));

  /** Counted with every other filter still on, so a number next to an option is what you would get. */
  function countIf(extra: Partial<Params>): number {
    return pool.filter((r) => matches(r, { ...current, ...extra })).length;
  }

  function href(next: Partial<Params>): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...current, ...next })) {
      if (v && v !== "all") q.set(k, String(v));
    }
    const s = q.toString();
    return s ? `/instagram?${s}` : "/instagram";
  }

  /** Clicking the active option clears it, which is what a filter that shows a count should do. */
  function toggle(key: keyof Params, value: string): string {
    return href({ [key]: current[key] === value ? "" : value });
  }

  const igCategories = [...new Set(pool.map((r) => r.igCategory).filter((c): c is string => Boolean(c)))].sort();
  const myIcps = [...new Set(pool.map((r) => r.myIcp).filter((c): c is string => Boolean(c)))].sort();

  const sort = params.sort ?? "followers";
  const sorted = [...shown].sort((a, b) => {
    if (sort === "problem") return (b.problem ?? -1) - (a.problem ?? -1);
    if (sort === "name") return a.name.localeCompare(b.name);
    // Followers, biggest first, with unknown last rather than treated as zero.
    if (a.followers === null && b.followers === null) return a.name.localeCompare(b.name);
    if (a.followers === null) return 1;
    if (b.followers === null) return -1;
    return b.followers - a.followers;
  });

  const costToFinish = ENRICHMENT_DEFINITIONS.instagram_profile.costCents * notLookedUp.length;

  // The "buy for everything in view" target. Built from the same function the confirm screen uses,
  // so the number on the button is the number that gets priced — see lib/instagram-candidates.ts
  // for why that is worth a shared function rather than two similar queries.
  const buyAllParams = new URLSearchParams({ scope: "instagram", only: "instagram_profile" });
  if (current.from) buyAllParams.set("f_from", current.from);
  const buyAllCount = (
    await instagramCandidateIds(supabase, { from: current.from, onlyMissing: true })
  ).length;

  return (
    <AppShell
      current="instagram"
      email={typeof claims?.email === "string" ? claims.email : null}
      signOutAction={signOut}
      title="Instagram"
      wide
      what={
        <>
          Every business whose website links an Instagram account, and what is known about those
          accounts. <strong>Linking is free; the follower count is not</strong> — the two numbers
          below are deliberately separate.
        </>
      }
    >
      <>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
          <Fig value={linked.length} label="Have an Instagram link" hint="Found free on their own website" tone="social" />
          <Fig
            value={lookedUp.length}
            label="Looked up"
            hint="Followers and category actually known"
            tone={lookedUp.length > 0 ? "good" : "plain"}
          />
          <Fig
            value={notLookedUp.length}
            label="Linked but never looked up"
            hint={`≈ ${formatCents(costToFinish)} to do all of them`}
            tone={notLookedUp.length > 0 ? "warn" : "plain"}
          />
          <Fig value={noLink} label="No Instagram found" hint="Nothing on their site linked one" tone="plain" />
        </div>

        {/* The button the operator asked for: a way back to buying this data whenever they choose,
            without having to remember which screen prices it. It links to the confirm screen — it
            does not buy. */}
        {buyAllCount > 0 && (
          <div
            style={{
              ...PANEL,
              padding: "16px 18px",
              display: "flex",
              gap: 16,
              alignItems: "center",
              flexWrap: "wrap",
              borderColor: "var(--social)",
            }}
          >
            <span style={{ flex: "1 1 340px", fontSize: 15.5, lineHeight: 1.55 }}>
              <strong style={{ fontSize: 16.5 }}>
                {buyAllCount.toLocaleString()} accounts are linked but never looked up
                {current.from ? ` in “${current.from === "imported" ? "from a file I imported" : "found by search"}”` : ""}.
              </strong>
              <div style={{ color: "var(--ink-2)", marginTop: 3 }}>
                Roughly{" "}
                <strong>
                  {formatCents(ENRICHMENT_DEFINITIONS.instagram_profile.costCents * buyAllCount)}
                </strong>{" "}
                for all of them. The next screen shows the exact price and asks again — nothing is
                bought by pressing this.
              </div>
            </span>
            <Link href={`/records/enrich?${buyAllParams.toString()}`} className="btn" style={{ textDecoration: "none" }}>
              Get their Instagram →
            </Link>
          </div>
        )}

        {lookedUp.length === 0 && (
          <InfoBox title="Nothing has been looked up yet — here is what happens when it is" tone="social">
            <p style={{ margin: "0 0 10px" }}>
              {linked.length} businesses have an Instagram link, found for free while reading their
              websites. That link is an address, not an account: it does not tell you how many people
              follow them, what Instagram files them under, or what their bio says.
            </p>
            <p style={{ margin: "0 0 10px" }}>
              Looking one up costs about{" "}
              <strong>{formatCents(ENRICHMENT_DEFINITIONS.instagram_profile.costCents)}</strong>, so
              all {linked.length} would be roughly{" "}
              <strong>{formatCents(ENRICHMENT_DEFINITIONS.instagram_profile.costCents * linked.length)}</strong>. It
              fills in the follower count, Instagram&rsquo;s own category, the bio and the link in it —
              which then feeds your{" "}
              <Link href="/icps">ICPs</Link>, so a rule can say &ldquo;their website
              sells printing <em>and</em> Instagram calls them a clothing brand&rdquo;.
            </p>
            <p style={{ margin: 0 }}>
              Buy it from the leads list: tick the businesses, or filter to the ones you want and use
              the button at the bottom. Nothing on this screen spends anything.
            </p>
          </InfoBox>
        )}

        <div className="work-layout">
          <aside>
            <FilterSection title="Followers" hint="Unknown is its own answer — it means nobody has looked.">
              <FilterOption label="Any" count={pool.length} href={href({ followers: "" })} active={!current.followers} />
              {BANDS.map((b) => (
                <FilterOption
                  key={b.key}
                  label={b.label}
                  explain={b.hint}
                  count={countIf({ followers: b.key })}
                  href={toggle("followers", b.key)}
                  active={current.followers === b.key}
                />
              ))}
              <FilterOption
                label="Not looked up"
                explain="Linked, never bought"
                count={countIf({ followers: "unknown" })}
                href={toggle("followers", "unknown")}
                active={current.followers === "unknown"}
              />
            </FilterSection>

            {igCategories.length > 0 && (
              <FilterSection title="Instagram’s own category" hint="One word, chosen by them. There is no second level.">
                <FilterOption label="Any" count={pool.length} href={href({ cat: "" })} active={!current.cat} />
                {igCategories.map((c) => (
                  <FilterOption
                    key={c}
                    label={c}
                    count={countIf({ cat: c })}
                    href={toggle("cat", c)}
                    active={current.cat === c}
                  />
                ))}
                <FilterOption
                  label="None published"
                  count={countIf({ cat: "none" })}
                  href={toggle("cat", "none")}
                  active={current.cat === "none"}
                />
              </FilterSection>
            )}

            {myIcps.length > 0 && (
              <FilterSection title="Your ICP" hint="From your own ICPs, not Instagram’s categories.">
                <FilterOption label="Any" count={pool.length} href={href({ mine: "" })} active={!current.mine} />
                {myIcps.map((c) => (
                  <FilterOption
                    key={c}
                    label={c}
                    count={countIf({ mine: c })}
                    href={toggle("mine", c)}
                    active={current.mine === c}
                  />
                ))}
                <FilterOption
                  label="Not sorted yet"
                  count={countIf({ mine: "none" })}
                  href={toggle("mine", "none")}
                  active={current.mine === "none"}
                />
              </FilterSection>
            )}

            <FilterSection title="Running ads?" hint="Only known for businesses you bought it for, one at a time.">
              <FilterOption label="Any" count={pool.length} href={href({ ads: "" })} active={!current.ads} />
              <FilterOption
                label="Ads live now"
                count={countIf({ ads: "yes" })}
                href={toggle("ads", "yes")}
                active={current.ads === "yes"}
              />
              <FilterOption
                label="No ads live"
                count={countIf({ ads: "no" })}
                href={toggle("ads", "no")}
                active={current.ads === "no"}
              />
              <FilterOption
                label="Never checked"
                count={countIf({ ads: "unknown" })}
                href={toggle("ads", "unknown")}
                active={current.ads === "unknown"}
              />
            </FilterSection>

            <FilterSection title="The account itself">
              <FilterOption label="Any" count={pool.length} href={href({ posts: "" })} active={!current.posts} />
              <FilterOption
                label="Verified"
                count={countIf({ posts: "verified" })}
                href={toggle("posts", "verified")}
                active={current.posts === "verified"}
              />
              <FilterOption
                label="Private"
                explain="Instagram withholds their numbers"
                count={countIf({ posts: "private" })}
                href={toggle("posts", "private")}
                active={current.posts === "private"}
              />
            </FilterSection>

            <FilterSection title="Where from">
              <FilterOption label="Any" count={pool.length} href={href({ from: "" })} active={!current.from} />
              <FilterOption
                label="Found by search"
                count={countIf({ from: "discovered" })}
                href={toggle("from", "discovered")}
                active={current.from === "discovered"}
              />
              <FilterOption
                label="From a file I imported"
                count={countIf({ from: "imported" })}
                href={toggle("from", "imported")}
                active={current.from === "imported"}
              />
            </FilterSection>
          </aside>

          <div>
            <Panel
              title={`${sorted.length} businesses`}
              hint={
                Object.keys(current).filter((k) => k !== "sort").length > 0
                  ? "Matching the filters on the left."
                  : "Everything with an Instagram link."
              }
              right={
                <span style={{ display: "flex", gap: 10, fontSize: 14.5 }}>
                  {[
                    ["followers", "Most followers"],
                    ["problem", "Worst website"],
                    ["name", "A–Z"],
                  ].map(([key, label]) => (
                    <Link
                      key={key}
                      href={href({ sort: key })}
                      style={{
                        color: sort === key ? "var(--brand)" : "var(--ink-3)",
                        fontWeight: sort === key ? 700 : 400,
                      }}
                    >
                      {label}
                    </Link>
                  ))}
                </span>
              }
            >
              {sorted.length === 0 ? (
                <div style={{ padding: "34px 20px", textAlign: "center", color: "var(--ink-3)", fontSize: 15.5 }}>
                  Nothing matches those filters. <Link href="/instagram">Clear them</Link>.
                </div>
              ) : (
                <form method="get" action="/records/enrich">
                  {/* A plain GET form, like the leads list. The whole app is server-rendered with no
                      client JavaScript, so a selection is a set of checkboxes and a submit — there
                      is no "select all" here because that would need script; the bar above covers
                      the whole-list case instead. */}
                  <input type="hidden" name="only" value="instagram_profile" />
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
                    <thead style={{ background: "var(--surface-2)" }}>
                      <tr>
                        <Th label="" width={34} />
                        <Th label="Business" />
                        <Th label="Instagram" width={190} />
                        <Th label="Followers" explain="Blank = never looked up" width={110} />
                        <Th label="Posts" width={80} />
                        <Th label="Instagram’s category" width={160} />
                        <Th label="Your ICP" width={170} />
                        <Th label="Ads" width={90} />
                        <Th label="Lead" explain="Priority from the website score" width={80} />
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.slice(0, 500).map((r) => (
                        <tr key={r.id}>
                          <td style={TD}>
                            <input type="checkbox" name="id" value={r.id} style={{ width: 16, height: 16 }} />
                          </td>
                          <td style={TD}>
                            <Link href={`/records/${r.id}`} style={{ fontWeight: 600 }}>
                              {r.name}
                            </Link>
                            <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                              {r.where}
                              {r.origin === "imported" && r.batch ? ` · ${batchNames.get(r.batch) ?? "a file"}` : ""}
                            </div>
                          </td>
                          <td style={TD}>
                            {r.handle ? (
                              <a
                                href={`https://instagram.com/${r.handle}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                style={{ fontSize: 15 }}
                              >
                                @{r.handle} &#8599;
                              </a>
                            ) : r.url ? (
                              <a href={r.url} target="_blank" rel="noreferrer noopener" style={{ fontSize: 14.5 }}>
                                their account &#8599;
                              </a>
                            ) : null}
                            <span style={{ display: "block", marginTop: 3 }}>
                              {r.verified && <Badge tone="brand">verified</Badge>}{" "}
                              {r.isPrivate && <Badge tone="warn">private</Badge>}
                            </span>
                          </td>
                          <td style={{ ...TD, fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
                            {r.followers === null ? (
                              <span style={{ color: "var(--ink-3)", fontWeight: 400, fontSize: 14.5 }}>
                                {r.isPrivate ? "withheld" : "not looked up"}
                              </span>
                            ) : (
                              r.followers.toLocaleString()
                            )}
                          </td>
                          <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>
                            {r.posts === null ? <span style={{ color: "var(--ink-3)" }}>—</span> : r.posts.toLocaleString()}
                          </td>
                          <td style={{ ...TD, fontSize: 15 }}>
                            {r.igCategory ?? <span style={{ color: "var(--ink-3)" }}>—</span>}
                          </td>
                          <td style={{ ...TD, fontSize: 15 }}>
                            {r.myIcp ? (
                              <>
                                {r.myIcp}
                              </>
                            ) : (
                              <span style={{ color: "var(--ink-3)" }}>not sorted</span>
                            )}
                          </td>
                          <td style={TD}>
                            {r.adsRunning === "true" ? (
                              <Badge tone="money">live</Badge>
                            ) : r.adsRunning === "false" ? (
                              <span style={{ color: "var(--ink-3)", fontSize: 14.5 }}>none</span>
                            ) : (
                              <span style={{ color: "var(--ink-3)", fontSize: 14.5 }}>—</span>
                            )}
                          </td>
                          <td style={TD}>
                            <TierBadge tier={r.tier} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {sorted.length > 500 && <Note>Showing the first 500 of {sorted.length}.</Note>}
                  </div>
                  <div
                    style={{
                      padding: "14px 18px",
                      borderTop: "1px solid var(--rule)",
                      display: "flex",
                      gap: 13,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <button className="btn" type="submit">
                      Get Instagram for the ones I ticked
                    </button>
                    <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                      {formatCents(ENRICHMENT_DEFINITIONS.instagram_profile.costCents)} each. The next
                      screen prices exactly what you ticked and asks again — anything already bought
                      is shown as free.
                    </span>
                  </div>
                </form>
              )}
            </Panel>

            <InfoBox title="What Instagram will and will not tell you" tone="warn">
              <p style={{ margin: "0 0 8px" }}>
                <strong>You can get:</strong> the follower count, how many posts, the category the
                account publishes, the bio, the link in the bio, and whether the account is verified
                or private.
              </p>
              <p style={{ margin: "0 0 8px" }}>
                <strong>You cannot get, at any price:</strong> the list of who follows them — Instagram
                publishes a count and never the names, so &ldquo;which well-known accounts follow
                them&rdquo; is not for sale anywhere. Nor is a second category level: Instagram gives
                one word, which is exactly why{" "}
                <Link href="/icps">your own rules</Link> exist.
              </p>
              <p style={{ margin: 0 }}>
                <strong>Ads:</strong> whether they are running any, and since when — but never how
                much they spend. Meta publishes spend only for political and social-issue ads, so for
                an ordinary business that figure is empty in Meta&rsquo;s own library and cannot be
                bought from anyone.
              </p>
            </InfoBox>
          </div>
        </div>
      </>
    </AppShell>
  );
}

function Fig({
  value,
  label,
  hint,
  tone,
}: {
  value: number;
  label: string;
  hint: string;
  tone: "social" | "good" | "warn" | "plain";
}) {
  const colour = tone === "plain" ? "var(--ink-3)" : `var(--${tone})`;
  return (
    <div style={{ ...PANEL, marginBottom: 0, padding: "14px 16px", flex: "1 1 190px", minWidth: 175 }}>
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: colour, fontVariantNumeric: "tabular-nums" }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink-2)", marginTop: 3 }}>{label}</div>
      <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 2 }}>{hint}</div>
    </div>
  );
}
