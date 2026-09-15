import Link from "next/link";
import { estimateDiscoveryRequests } from "@lead-intel/core";
import { PLACES_CENTER_LOOKUP_COST_CENTS, PLACES_TEXT_SEARCH_COST_CENTS } from "@lead-intel/shared";
import { createClient } from "@/lib/supabase/server";
import { createRun } from "./actions";

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Every run makes one centre-resolution call (resolve-center.ts) plus the grid searches. */
function requestsToCents(requests: number): number {
  return requests * PLACES_TEXT_SEARCH_COST_CENTS + PLACES_CENTER_LOOKUP_COST_CENTS;
}

export default async function ConfirmSearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    niche?: string;
    icp?: string;
    location?: string;
    radiusMiles?: string;
    maxBusinesses?: string;
    maxSpendDollars?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;
  const location = params.location?.trim();
  const radiusMiles = Number(params.radiusMiles);

  /**
   * An ICP is several searches, so the price is several searches.
   *
   * Read here rather than carried in the query string: the words are the operator's and can be
   * edited between pressing the button and confirming, and quoting a price for words that have
   * since changed would be quoting for a search that is not the one about to run.
   */
  const supabase = await createClient();
  const { data: icp } = params.icp
    ? await supabase.from("icps").select("id, name, search_terms").eq("id", params.icp).maybeSingle()
    : { data: null };
  const icpTerms = ((icp?.search_terms ?? []) as string[]).filter((t) => t.trim().length > 0);
  const niche = icp ? icpTerms.join(", ") : params.niche?.trim();
  const searches = icp ? icpTerms.length : 1;

  if (icp && icpTerms.length === 0) {
    return (
      <main style={{ padding: 24, maxWidth: 640, margin: "0 auto" }}>
        <p>
          <Link href="/search">&larr; Start over</Link>
        </p>
        <p style={{ color: "var(--warn-ink)" }}>
          <strong>{icp.name}</strong> has no words to search Google Maps with yet, so there is
          nothing to run. <Link href={`/icps?edit=${icp.id}`}>Add some words to it</Link> — an ICP
          with none is only ever matched against businesses already in your list.
        </p>
      </main>
    );
  }

  if (!niche || !location || !Number.isFinite(radiusMiles) || radiusMiles <= 0) {
    return (
      <main style={{ padding: 24, maxWidth: 640, margin: "0 auto" }}>
        <p>
          <Link href="/search">&larr; Start over</Link>
        </p>
        <p style={{ color: "var(--warn-ink)" }}>Missing or invalid search — niche, location, and a positive radius are all required.</p>
      </main>
    );
  }

  // Grid geometry only — real business density, which decides where in this range a run actually
  // lands, cannot be known without running the search (pre-build-risks-and-api-limits.md §4).
  // See packages/core/src/discovery/estimate.ts for why the ceiling is shown separately rather
  // than folded into the range.
  const one = estimateDiscoveryRequests({ radiusMiles });
  // Every word is a full run of its own — its own grid, its own centre lookup — so the whole thing
  // costs what one costs, times the number of words.
  const estimate = {
    initialCells: one.initialCells * searches,
    minRequests: one.minRequests * searches,
    maxRequestsWithoutSubdivision: one.maxRequestsWithoutSubdivision * searches,
    ceilingRequests: one.ceilingRequests * searches,
  };
  const hasSpendLimit = Boolean(params.maxSpendDollars);

  return (
    <main style={{ padding: 24, maxWidth: 640, margin: "0 auto" }}>
      <p style={{ marginBottom: 4 }}>
        <Link href="/search">&larr; Change search</Link>
      </p>
      <h1 style={{ fontSize: 31, margin: "0 0 6px" }}>Confirm before spending anything</h1>
      <p style={{ color: "var(--ink-3)", margin: "0 0 22px" }}>
        Nothing has been searched yet — this is Stage 0 (Plan). Nothing is charged until you
        start discovery below.
      </p>

      {params.error && (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: 20,
            background: "var(--warn-bg)",
            border: "1px solid #d3ac71",
            borderRadius: 3,
            color: "var(--warn-ink)",
            fontSize: 16,
          }}
        >
          {params.error}
        </div>
      )}

      <div style={{ background: "var(--surface)", border: "1px solid var(--rule)", borderRadius: 3, padding: 24, marginBottom: 20 }}>
        <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 10, columnGap: 16, fontSize: 16 }}>
          <dt style={{ color: "var(--ink-3)" }}>{icp ? "ICP" : "Niche"}</dt>
          <dd style={{ margin: 0 }}>
            {icp ? (
              <>
                <strong>{icp.name}</strong>
                <div style={{ fontSize: 15, color: "var(--ink-3)" }}>
                  {searches} searches, one for each word: {icpTerms.join(", ")}
                </div>
              </>
            ) : (
              niche
            )}
          </dd>
          <dt style={{ color: "var(--ink-3)" }}>Location</dt>
          <dd style={{ margin: 0 }}>{location}</dd>
          <dt style={{ color: "var(--ink-3)" }}>Radius</dt>
          <dd style={{ margin: 0 }}>{radiusMiles} miles</dd>
          <dt style={{ color: "var(--ink-3)" }}>Grid cells (starting)</dt>
          <dd style={{ margin: 0 }}>{estimate.initialCells}</dd>
          <dt style={{ color: "var(--ink-3)" }}>Likely search requests</dt>
          <dd style={{ margin: 0 }}>
            {estimate.minRequests}&ndash;{estimate.maxRequestsWithoutSubdivision}
            <span style={{ color: "var(--ink-3)" }}> — {centsToDollars(requestsToCents(estimate.minRequests))}&ndash;
              {centsToDollars(requestsToCents(estimate.maxRequestsWithoutSubdivision))}</span>
          </dd>
        </dl>
        <p style={{ margin: "16px 0 0", fontSize: 14.5, color: "var(--ink-3)", borderTop: "1px solid var(--rule)", paddingTop: 14 }}>
          Google's free allowance is 1,000 Places searches + 10,000 geocoding lookups per month,
          so a run in the likely range above usually costs <strong>$0</strong> in practice.
        </p>
      </div>

      {/* The likely range assumes no cell saturates. Any cell that hits the 60-result cap splits
          and re-searches, which is how complete coverage is achieved — and it is uncapped by the
          range above. Showing only that range as if it were a maximum would be exactly the kind
          of false confidence spec §8 forbids, so the real ceiling gets its own block. */}
      <div
        style={{
          padding: "14px 18px",
          marginBottom: 20,
          background: hasSpendLimit ? "var(--surface-2)" : "var(--warn-bg)",
          border: `1px solid ${hasSpendLimit ? "var(--rule)" : "#d3ac71"}`,
          borderRadius: 3,
          fontSize: 15.5,
          color: hasSpendLimit ? "var(--ink-2)" : "var(--warn-ink)",
        }}
      >
        <strong>If dense areas subdivide, it can go higher.</strong> Where a cell finds more than
        60 businesses it splits into smaller cells and searches again — that is how you get
        complete data rather than the first 60. In the extreme (every cell saturating at every
        level, which no realistic niche does) this run could reach{" "}
        <strong>{estimate.ceilingRequests.toLocaleString()} requests &asymp;{" "}
        {centsToDollars(requestsToCents(estimate.ceilingRequests))}</strong>.
        <div style={{ marginTop: 8 }}>
          {hasSpendLimit ? (
            <>Your ${params.maxSpendDollars} spend limit stops the run well before that.</>
          ) : (
            <>
              <strong>No spend limit is set.</strong> Two things bound this in practice: the daily
              quota you set in Google Cloud (SETUP.md §8), and a spend limit on this run —{" "}
              <Link href={`/search?niche=${encodeURIComponent(niche)}&location=${encodeURIComponent(location)}&radiusMiles=${radiusMiles}`}>
                go back and set one
              </Link>
              .
            </>
          )}
        </div>
      </div>

      <form action={createRun} style={{ background: "var(--surface)", border: "1px solid var(--rule)", borderRadius: 3, padding: 24 }}>
        {icp ? (
          <input type="hidden" name="icp" value={icp.id} />
        ) : (
          <input type="hidden" name="niche" value={niche} />
        )}
        <input type="hidden" name="location" value={location} />
        <input type="hidden" name="radiusMiles" value={String(radiusMiles)} />
        {params.maxBusinesses && <input type="hidden" name="maxBusinesses" value={params.maxBusinesses} />}
        {params.maxSpendDollars && <input type="hidden" name="maxSpendDollars" value={params.maxSpendDollars} />}
        <p style={{ margin: "0 0 16px", fontSize: 16, color: "var(--ink-3)" }}>
          {params.maxBusinesses
            ? `Stops after ${params.maxBusinesses} businesses. `
            : "No business limit set — "}
          {params.maxSpendDollars
            ? `Stops at $${params.maxSpendDollars} spent.`
            : "no spend limit set."}{" "}
          A run that hits either limit stops cleanly and keeps everything already found (spec §10.3).
        </p>
        <button className="btn" type="submit">
          {searches > 1 ? `Start all ${searches} searches` : "Start discovery"}
        </button>
      </form>
    </main>
  );
}
