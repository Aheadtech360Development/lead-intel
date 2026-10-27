import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { AdminOnlyNotice, AppShell, Banner, Note, PANEL, Panel, StageStrip } from "../ui";

/**
 * Pipeline Stage 0 ("Plan"). A plain GET form so the values appear in /search/confirm's URL and
 * that page can compute the estimate from searchParams alone, with no client-side state. Nothing
 * is created here; confirming is a separate, explicit step (§9 — "ask the operator to confirm"
 * before Stage 1 spends anything).
 *
 * The niche presets exist because the field was a blank text box and the quality of a run depends
 * almost entirely on what goes in it. "printing" and "screen printing t-shirts" return very
 * different lists, and there was nothing on the page to suggest which shape works. These are
 * starting points that fill the box in — the field stays free text, because the niche changes on
 * every search and a fixed list would be a cage.
 */

/** Grouped by the service they most often need, which is how an operator picks a niche to work. */
const NICHE_PRESETS: { group: string; why: string; niches: string[] }[] = [
  {
    group: "Trades & home services",
    why: "Usually strong on reviews, weak on websites and tracking.",
    niches: ["plumber", "electrician", "roofing contractor", "HVAC repair", "landscaping", "pest control", "locksmith", "garage door repair"],
  },
  {
    group: "Health & beauty",
    why: "Often booking-platform pages rather than real websites.",
    niches: ["hair salon", "barber shop", "nail salon", "day spa", "dentist", "chiropractor", "optometrist", "massage therapy"],
  },
  {
    group: "Print, signs & apparel",
    why: "The niche this system was first tested against.",
    niches: ["screen printing", "embroidery", "sign shop", "print shop", "promotional products", "vehicle wraps"],
  },
  {
    group: "Food & hospitality",
    why: "High review counts, so Reputation rarely wins — look at website quality.",
    niches: ["restaurant", "coffee shop", "bakery", "catering", "food truck", "bar"],
  },
  {
    group: "Retail & specialty",
    why: "Small independents; often no tracking at all.",
    niches: ["yarn shop", "furniture store", "florist", "pet grooming", "bike shop", "jewelry store"],
  },
  {
    group: "Professional services",
    why: "Higher budgets, but often dated sites.",
    niches: ["accountant", "law firm", "insurance agency", "real estate agent", "financial advisor", "IT support"],
  },
];

export default async function NewSearchPage({
  searchParams,
}: {
  /** `error` is set when a search could not be started — see app/search/confirm/actions.ts. */
  searchParams: Promise<{ niche?: string; location?: string; error?: string }>;
}) {
  // The preset links come back through the URL, so the form re-renders with the box filled in and
  // the page still needs no client-side JavaScript at all.
  const { niche = "", location = "", error } = await searchParams;

  /**
   * Admin only, and refused here rather than only hidden from the navigation.
   *
   * A member who types this address gets the reason, not a blank page. The database refuses the
   * write as well — see `lib/viewer.ts` — because a boundary that lives in a menu is not one.
   */
  const viewer = await getViewer();
  if (viewer && !viewer.isAdmin) {
    return (
      <AppShell current="leads" email={viewer.email} title="Find businesses" autoRefresh={false}>
        <AdminOnlyNotice thing="Searching Google Maps" why={"A Maps search creates businesses nobody has seen yet, and it costs money for every search and every listing it brings back. The administrator runs it and hands out what it finds. Importing a spreadsheet and adding a business by hand are both yours, and both free."} />
      </AppShell>
    );
  }

  // The ICPs, with the words each one is searched for. Ordered the way they are checked, so the
  // list here reads the same as the list on the ICPs screen.
  const supabase = await createClient();
  const { data: icpRows } = await supabase
    .from("icps")
    .select("id, name, search_terms")
    .eq("enabled", true)
    .order("priority")
    .order("created_at");
  const icps = (icpRows ?? []).filter((r) => ((r.search_terms ?? []) as string[]).length > 0);
  // Kept apart so the page can say *why* an ICP cannot be picked, rather than hiding the whole
  // choice — which is what it did, and which left the operator looking at a screen with no ICP on
  // it at all and no idea one was meant to be there.
  const icpsWithoutWords = (icpRows ?? []).filter((r) => ((r.search_terms ?? []) as string[]).length === 0);

  const pill: React.CSSProperties = {
    padding: "5px 11px",
    fontSize: 15,
    borderRadius: 4,
    border: "1px solid var(--rule)",
    background: "var(--surface-2)",
    color: "var(--ink-2)",
    textDecoration: "none",
    whiteSpace: "nowrap",
  };

  return (
    <AppShell
      autoRefresh={false}
      current="search"
      title="Find businesses"
      what="Search Google Maps for one of your ICPs, or for a word of your own. The next screen shows the cost before anything is spent."
    >

      <>
        <StageStrip current="sourcing" />
        {/* A search that could not be started said so only on the run's own status page, which is
            not where the operator is looking after pressing the button. */}
        {error ? <Banner tone="bad">{decodeURIComponent(error)}</Banner> : null}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)", gap: 22, alignItems: "start" }}>
          <form action="/search/confirm" method="get" style={{ ...PANEL, padding: 22 }}>
            {/*
              An ICP already holds the words this kind of customer is searched for, so the search
              starts from one rather than from a blank box. The words are searched one after
              another, each as its own run — that is how "one ICP, several searches" is expressed
              without inventing a new kind of run.

              The text box below stays, for a word that belongs to no ICP yet. Whichever of the two
              is filled in is the one that decides, and the cost screen says which it read.
            */}
            <div className="field">
              <label htmlFor="icp">Search for one of your ICPs</label>
              <select
                id="icp"
                name="icp"
                defaultValue=""
                disabled={icps.length === 0}
                style={{ width: "100%", minHeight: 46, padding: "10px 12px", fontSize: 16, borderRadius: 8, border: "1px solid var(--rule)", background: "var(--surface)" }}
              >
                <option value="">
                  {icps.length === 0 ? "— none of your ICPs has search words yet —" : "— none, I will type a word myself —"}
                </option>
                {icps.map((icp) => (
                  <option key={icp.id} value={icp.id}>
                    {icp.name} — {(icp.search_terms as string[]).join(", ")}
                  </option>
                ))}
                {icpsWithoutWords.map((icp) => (
                  <option key={icp.id} value={`no-words-${icp.id}`} disabled>
                    {icp.name} — no search words yet
                  </option>
                ))}
              </select>
              <p style={{ color: "var(--ink-3)", fontSize: 14.5, margin: "4px 0 0" }}>
                {icps.length === 0 ? (
                  <>
                    An ICP is searched with the words you give it for Google Maps.{" "}
                    <Link href="/icps">Add words to an ICP</Link> and it appears here — until then, type
                    one word below.
                  </>
                ) : (
                  <>
                    Every word in the ICP is searched, one run each. <Link href="/icps">Edit your ICPs</Link> to
                    change the words.
                  </>
                )}
              </p>
            </div>

            <div className="field">
              <label htmlFor="niche">Or one word of your own</label>
              <input id="niche" name="niche" type="text" placeholder="e.g. plumber" defaultValue={niche} />
              <p style={{ color: "var(--ink-3)", fontSize: 14.5, margin: "4px 0 0" }}>
                Type it the way a customer would search. Ignored when an ICP is chosen above.
              </p>
            </div>

            <div className="field">
              <label htmlFor="location">Which city or area?</label>
              <input id="location" name="location" type="text" required placeholder="e.g. Miami, FL" defaultValue={location} />
              <p style={{ color: "var(--ink-3)", fontSize: 14.5, margin: "4px 0 0" }}>
                Include the state — &ldquo;Springfield&rdquo; alone matches dozens of places worldwide.
              </p>
            </div>

            <div className="field">
              <label htmlFor="radiusMiles">How far around it? (miles)</label>
              <input id="radiusMiles" name="radiusMiles" type="number" min="1" max="200" required defaultValue={10} />
              <p style={{ color: "var(--ink-3)", fontSize: 14.5, margin: "4px 0 0" }}>
                Start at 10 for a first run in a new area. Above about 20 miles the analysis takes
                longer than the system currently allows in one go.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="field">
                <label htmlFor="maxBusinesses">Stop after how many? (optional)</label>
                <input id="maxBusinesses" name="maxBusinesses" type="number" min="1" placeholder="No limit" />
              </div>
              <div className="field">
                <label htmlFor="maxSpendDollars">Never spend more than, $</label>
                <input id="maxSpendDollars" name="maxSpendDollars" type="number" min="1" step="0.01" defaultValue={5} />
              </div>
            </div>
            <p style={{ color: "var(--ink-3)", fontSize: 14.5, margin: "-6px 0 18px" }}>
              The run stops cleanly at this amount and keeps everything it has already found. A dense
              city can cost far more than a quiet one, which is why this has a default rather than
              being left blank.
            </p>

            <button className="btn" type="submit">
              See the cost first
            </button>
          </form>

          <div>
            <Panel
              title="Types of business that work well"
              hint="Click one to fill in the box. It is only a starting point — you can type anything."
            >
              {NICHE_PRESETS.map((group, i) => (
                <div key={group.group} style={{ padding: "13px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
                  <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 2 }}>{group.group}</div>
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginBottom: 9 }}>{group.why}</div>
                  <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                    {group.niches.map((preset) => (
                      // A link that pre-fills the form via the URL, so the page still needs no
                      // client-side JavaScript at all.
                      <a
                        key={preset} href={`/search?niche=${encodeURIComponent(preset)}${location ? `&location=${encodeURIComponent(location)}` : ""}`}
                        style={{ ...pill, ...(preset === niche ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" } : {}) }}
                      >
                        {preset}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
              <Note>
                A narrower niche gives a better list. &ldquo;screen printing&rdquo; finds print shops;
                &ldquo;printing&rdquo; also finds photocopying, 3D printing and stationery shops, and
                you will spend the analysis budget on businesses you cannot sell to.
              </Note>
            </Panel>
          </div>
        </div>
      </>
    </AppShell>
  );
}
