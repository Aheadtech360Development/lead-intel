import { estimateEnrichment, formatCents, type EnrichmentCandidate } from "@lead-intel/core";
import {
  DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
  ENRICHMENT_DEFINITIONS,
  ENRICHMENT_ORDER,
  isEnrichmentSource,
  type EnrichmentSource,
} from "@lead-intel/shared";
import Link from "next/link";
import { instagramCandidateIds } from "@/lib/instagram-candidates";
import { createClient } from "@/lib/supabase/server";
import { AppShell, Banner, Money, Note, PANEL, Panel } from "../../ui";
import { buyEnrichment } from "./actions";

/**
 * The screen that stands between choosing businesses and spending money.
 *
 * **Nothing on this page buys anything.** It counts what was selected, asks the ledger what has
 * already been paid for, prices the rest, and shows the total. The only way past it is a form
 * submission the operator makes deliberately.
 *
 * The counts come from the same `gatherCandidates` the run itself uses, so the number quoted here
 * is the number that will be spent. A confirm screen that is merely usually right is worse than
 * no confirm screen, because the operator stops reading it.
 */

interface Params {
  id?: string | string[];
  scope?: string;
  f_view?: string;
  f_tier?: string;
  f_route?: string;
  f_website?: string;
  /**
   * Where the businesses came from. Reading this is not optional: the button that sends people
   * here says "Get paid data for all 121 shown", and while this filter was missing that query
   * returned all 330 — the screen would have offered to buy data for businesses the operator had
   * deliberately filtered out, and quoted the price of doing so as though it were what they asked
   * for. Every filter the list can apply has to be applied here too, or the two disagree about
   * what "shown" means while money is on the line.
   */
  f_from?: string;
  /** One imported file. Set when an import's plan asked for Instagram and carried the batch here. */
  f_batch?: string;
  /** Narrows the offered sources to one, so an import's "then get Instagram" arrives on point. */
  only?: string;
  /** With `scope=instagram`: include accounts already looked up rather than only the missing ones. */
  ig_all?: string;
  /** Carried from the import so its result is not lost behind this screen. */
  note?: string;
  error?: string;
}

/**
 * Sources that may only ever be bought for businesses picked out one at a time.
 *
 * Not a price rule — a rule about intent. The operator was explicit that Facebook and Instagram ads
 * get chosen business by business and never as part of a batch, so "buy this for all 121 shown" must
 * not be able to include it. Hiding it when the arrival was by filter is a stronger guarantee than
 * leaving it unticked: an unticked box is one mis-click from a $14 run.
 */
const HAND_PICKED_ONLY: EnrichmentSource[] = ["meta_ads"];

export default async function EnrichPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const supabase = await createClient();

  // Two ways to arrive: specific rows ticked, or "everything matching the filter I was looking
  // at". The second re-runs the same query rather than trusting a count from the previous page.
  let businessIds: string[] = [];
  let arrivedBy: "ticked" | "filter" = "ticked";

  if (params.scope === "instagram") {
    // Arrived from the Instagram screen. The set is decided by the same function that labelled the
    // button there, so the count the operator pressed and the count priced here cannot disagree.
    arrivedBy = "filter";
    businessIds = await instagramCandidateIds(supabase, {
      from: params.f_from,
      batch: params.f_batch,
      onlyMissing: params.ig_all !== "1",
    });
  } else if (params.scope === "filtered") {
    arrivedBy = "filter";
    let query = supabase.from("businesses").select("id").eq("status", "active");
    // Only the "worth calling" view narrows to the gate. `everything` and `unanalysed` both show
    // businesses that have not passed it, and applying the gate to those would quietly select a
    // different set than the one on screen.
    if (params.f_view === undefined) query = query.eq("passed_gate", true);
    if (params.f_tier) query = query.eq("tier", Number(params.f_tier));
    if (params.f_route) query = query.eq("route", params.f_route);
    if (params.f_website) query = query.eq("website_status", params.f_website);
    if (params.f_from) query = query.eq("origin", params.f_from);
    if (params.f_batch) query = query.eq("import_batch_id", params.f_batch);
    const { data } = await query;
    businessIds = (data ?? []).map((b) => b.id);
  } else {
    businessIds = typeof params.id === "string" ? [params.id] : (params.id ?? []);
  }

  if (businessIds.length === 0) {
    return (
      <Shell>
        <Panel title="Nothing selected">
          <div style={{ padding: 20, fontSize: 16, color: "var(--ink-2)" }}>
            Tick the businesses you want paid data for, then press the button.{" "}
            <Link href="/records">Back to the list</Link>
          </div>
        </Panel>
      </Shell>
    );
  }

  // What this screen is allowed to offer. Three things narrow it, in order: a source that may only
  // be hand-picked disappears when the arrival was by filter; an `only` parameter (an import saying
  // "then get their Instagram") narrows to one; everything else stays.
  //
  // `only` is checked against the registry before it narrows anything. A typo in a URL that left
  // this screen offering nothing at all would look like "there is nothing to buy for these
  // businesses", which is a different and much more discouraging statement than the truth.
  const only = params.only && isEnrichmentSource(params.only) ? params.only : null;
  const offered = ENRICHMENT_ORDER.filter((source) => {
    if (arrivedBy === "filter" && HAND_PICKED_ONLY.includes(source)) return false;
    if (only && only !== source) return false;
    return true;
  });
  const hiddenByHand = arrivedBy === "filter" ? HAND_PICKED_ONLY : [];

  // Which businesses already have each source, and which have nothing to look it up with. Asked
  // of the ledger and the identity keys — never assumed.
  const candidatesBySource: Partial<Record<EnrichmentSource, EnrichmentCandidate[]>> = {};
  for (const source of offered) {
    candidatesBySource[source] = await candidatesFor(supabase, source, businessIds);
  }

  const estimate = estimateEnrichment({
    candidatesBySource,
    sources: offered,
    selectedBusinesses: businessIds.length,
    capCents: DEFAULT_ENRICHMENT_SPEND_CAP_CENTS,
    // Read on the server, where the page renders. A source whose key is missing is shown with
    // its real price and disabled, so the operator can see the option without being able to
    // start a purchase that would fail halfway through a paid batch.
    availableEnvVars: Object.keys(process.env).filter((k) => Boolean(process.env[k])),
  });

  return (
    <Shell>
      <h1 style={{ fontSize: 27, margin: "0 0 4px" }}>Buy extra data for {businessIds.length} businesses</h1>
      <p style={{ color: "var(--ink-3)", margin: "0 0 20px", fontSize: 16, maxWidth: 760 }}>
        {arrivedBy === "filter"
          ? "Everything currently matching your filter. "
          : "The ones you ticked. "}
        Nothing has been bought yet — tick what you want below and the exact price is shown before
        anything is spent.
      </p>

      {/* The import's own result, carried through rather than lost behind this screen. An operator
          who imported 129 rows and landed here should still be told the import worked. */}
      {params.note && (
        <Banner tone="good">{decodeURIComponent(params.note)}</Banner>
      )}

      {params.error && (
        <Banner tone="bad">{decodeURIComponent(params.error)}</Banner>
      )}

      <form action={buyEnrichment}>
        {businessIds.map((id) => (
          <input key={id} type="hidden" name="id" value={id} />
        ))}

        {estimate.perSource.map((source) => {
          const definition = ENRICHMENT_DEFINITIONS[source.source];
          const buyable = source.willBuy > 0 && !source.unavailable;
          return (
            <div key={source.source} style={{ ...PANEL, padding: "16px 18px" }}>
              <label style={{ display: "flex", gap: 12, alignItems: "flex-start", cursor: buyable ? "pointer" : "default" }}>
                <input
                  type="checkbox"
                  name="source"
                  value={source.source}
                  disabled={!buyable}
                  defaultChecked={source.source === "places_details" && buyable}
                  style={{ width: 17, height: 17, marginTop: 3 }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 17.5 }}>{source.label}</strong>
                    {/*
                      * The sum written out, not just its answer.
                      *
                      * "$0.47" on its own is the thing the operator said they could not read - it
                      * does not say what is being bought, for how many, or by whom. Written as
                      * "0.26c each x 47 businesses = $0.13, billed by Apify" there is nothing left
                      * to guess at.
                      *
                      * The unit price is shown exactly; the total is rounded UP, because a confirm
                      * screen must never quote less than what will actually be charged.
                      */}
                    <span style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {source.willBuy === 0 ? (
                        <span style={{ color: "var(--ink-2)", fontSize: 16 }}>Nothing left to buy</span>
                      ) : (
                        <>
                          <strong style={{ fontSize: 19, color: source.unavailable ? "var(--ink-3)" : "var(--money-ink)" }}>
                            {formatCents(source.wouldCostCents)}
                          </strong>
                          <span style={{ display: "block", fontSize: 14.5, color: "var(--ink-2)", fontWeight: 400 }}>
                            <Money cents={source.costCentsEach} /> each &times; {source.willBuy}{" "}
                            {source.willBuy === 1 ? "business" : "businesses"}
                          </span>
                          <span style={{ display: "block", fontSize: 14, color: "var(--ink-2)", fontWeight: 400 }}>
                            billed by <strong style={{ color: "var(--ink)" }}>{source.provider}</strong>
                          </span>
                        </>
                      )}
                    </span>
                  </span>

                  <div style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 4 }}>{source.describes}</div>
                  <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 3 }}>
                    Fills in {source.fills.join(", ")}
                  </div>

                  <div style={{ marginTop: 9, display: "flex", gap: 18, flexWrap: "wrap", fontSize: 14.5 }}>
                    {source.alreadyHave > 0 && (
                      <span style={{ color: "var(--good-ink)", fontWeight: 650 }}>
                        ✓ {source.alreadyHave} already paid for &mdash; they cost nothing again
                      </span>
                    )}
                    {source.cannotBuy > 0 && (
                      <span style={{ color: "var(--ink-2)" }}>
                        {source.cannotBuy} have nothing to look up, so they are skipped
                      </span>
                    )}
                  </div>

                  {definition.warning && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "9px 11px",
                        background: "var(--accent-bg)",
                        borderRadius: 4,
                        fontSize: 14.5,
                        color: "var(--warn-ink)",
                      }}
                    >
                      ⚠ {definition.warning}
                    </div>
                  )}
                  {definition.requiresEnvVar && (
                    <div style={{ marginTop: 8, fontSize: 14.5, color: "var(--ink-3)" }}>
                      Not connected yet — needs <code>{definition.requiresEnvVar}</code> in{" "}
                      <code>apps/jobs/.env</code>. It is listed here so you can see the option and
                      the price; it cannot be bought until the key is in place.
                    </div>
                  )}
                </span>
              </label>
            </div>
          );
        })}

        {hiddenByHand.length > 0 && (
          <div style={{ ...PANEL, padding: "14px 17px", fontSize: 15, color: "var(--ink-2)", lineHeight: 1.6 }}>
            <strong>
              {hiddenByHand.map((s) => ENRICHMENT_DEFINITIONS[s].label).join(", ")} is not offered here.
            </strong>{" "}
            You asked to choose that one business by business rather than for a whole filter at once,
            so it only appears when you have ticked specific rows on the leads list. At{" "}
            {formatCents(ENRICHMENT_DEFINITIONS.meta_ads.costCents)} each it is the most expensive
            thing in the product per business — buying it for {businessIds.length} at once would cost{" "}
            {formatCents(ENRICHMENT_DEFINITIONS.meta_ads.costCents * businessIds.length)}.
          </div>
        )}

        <div style={{ ...PANEL, padding: "18px" }}>
          <div style={{ display: "flex", gap: 22, alignItems: "flex-end", flexWrap: "wrap" }}>
            <span>
              <div style={{ fontSize: 14.5, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-3)" }}>
                Never spend more than
              </div>
              <input
                type="number"
                name="capDollars"
                min="0.01"
                step="0.01"
                defaultValue={(DEFAULT_ENRICHMENT_SPEND_CAP_CENTS / 100).toFixed(2)}
                style={{
                  padding: "8px 10px",
                  fontSize: 16.5,
                  width: 120,
                  border: "1px solid var(--rule)",
                  borderRadius: 4,
                  marginTop: 4,
                }}
              />
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "center" }}>
              <Link href="/records" style={{ fontSize: 16 }}>
                Cancel
              </Link>
              <button className="btn" type="submit">
                Buy the ticked data
              </button>
            </span>
          </div>
          <Note>
            The run stops the moment it would go past your limit, and keeps everything already
            bought. Anything already on a record costs nothing to select again — the ledger is
            checked before every single call.
          </Note>
        </div>
      </form>
    </Shell>
  );
}

/** Mirrors apps/jobs' `gatherCandidates`, through the operator's own session so RLS applies. */
async function candidatesFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  source: EnrichmentSource,
  businessIds: string[],
): Promise<EnrichmentCandidate[]> {
  const requiredKeyType = source === "places_details" ? "place_id" : "domain";
  const endpoint =
    source === "places_details" ? "places.details" : source === "owner_mobile" ? "lusha.contact" : "dataforseo.traffic";

  const [{ data: keys }, { data: calls }] = await Promise.all([
    supabase.from("identity_keys").select("business_id").eq("key_type", requiredKeyType).in("business_id", businessIds),
    supabase
      .from("provider_calls")
      .select("business_id, status, endpoint")
      .eq("endpoint", endpoint)
      .eq("status", "succeeded")
      .in("business_id", businessIds),
  ]);

  const hasKey = new Set((keys ?? []).map((k) => k.business_id));
  const bought = new Set((calls ?? []).map((c) => c.business_id));

  return businessIds.map((businessId) => {
    if (bought.has(businessId)) return { businessId, alreadyBought: true, eligible: true };
    if (!hasKey.has(businessId)) {
      return {
        businessId,
        alreadyBought: false,
        eligible: false,
        ineligibleReason: requiredKeyType === "place_id" ? "no Google listing" : "no website",
      };
    }
    return { businessId, alreadyBought: false, eligible: true };
  });
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      autoRefresh={false}
      back={{ href: "/records", label: "Back to leads" }}
      title="Buy extra data"
      what="Nothing here is bought until you confirm. Anything already bought is shown as free, and a spend cap stops a run that goes further than you expected."
    >
      {children}
    </AppShell>
  );
}
