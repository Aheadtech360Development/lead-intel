import Link from "next/link";
import { AppShell, Banner, Note, PANEL, Panel } from "../ui";

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
      what="Pick a type of business and a place. We search Google Maps across a grid of points, remove the duplicates, then visit every website we find and analyse it for free. The next screen shows any cost before a penny is spent."
    >

      <>
        {/* A search that could not be started said so only on the run's own status page, which is
            not where the operator is looking after pressing the button. */}
        {error ? <Banner tone="bad">{decodeURIComponent(error)}</Banner> : null}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)", gap: 22, alignItems: "start" }}>
          <form action="/search/confirm" method="get" style={{ ...PANEL, padding: 22 }}>
            <div className="field">
              <label htmlFor="niche">What kind of business?</label>
              <input id="niche" name="niche" type="text" required placeholder="e.g. plumber" defaultValue={niche} />
              <p style={{ color: "var(--ink-3)", fontSize: 14.5, margin: "4px 0 0" }}>
                Type it the way a customer would search. Pick one from the right if you are unsure.
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
