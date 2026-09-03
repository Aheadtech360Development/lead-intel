import { BUSINESS_ORIGIN_LABELS, type BusinessOrigin } from "@lead-intel/shared";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * CSV export of the working list (spec §12 Phase 2: "the team can work entirely from the tool").
 *
 * Reads through the **user's own session**, so Row Level Security decides what is exported exactly
 * as it decides what is displayed. An export route that used the service role would quietly become
 * a way to read past the policies that protect every other view of this data.
 *
 * Every column that can be unknown is written as a labelled state rather than an empty cell, per
 * §8.3: "`Unknown` and `Not found` are shown as labelled states, never as a blank cell." A blank
 * in a spreadsheet reads as zero, or as nothing to worry about, and neither is what null means
 * here — it means we could not measure it.
 */
export async function GET(request: Request) {
  const supabase = await createClient();

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const url = new URL(request.url);
  const website = url.searchParams.get("website");
  const tier = url.searchParams.get("tier");
  const route = url.searchParams.get("route");
  const from = url.searchParams.get("from");
  // The list links here with its own query string, so the names have to be the ones the list
  // uses. `gated` was this route's own invention and nothing ever sent it: the list says
  // `view=everything` for "show all" and omits it for "only worth calling", which is the exact
  // opposite polarity. The result was a download that ignored the filter on screen and said
  // nothing about it — the quietest kind of wrong answer, because the file looks fine.
  const gated = url.searchParams.get("gated");
  const onlyWorthCalling = gated === "true" || url.searchParams.get("view") !== "everything";

  let query = supabase
    .from("businesses")
    .select(
      "id, display_name, city, state, website_status, tier, problem_score, intent_score, route, route_reason, passed_gate, manual_review_status, manual_review_reasons, claim_status, created_at, origin",
    )
    .eq("status", "active");

  if (website) query = query.eq("website_status", website);
  if (tier) query = query.eq("tier", Number(tier));
  if (route) query = query.eq("route", route);
  if (from) query = query.eq("origin", from);
  if (onlyWorthCalling) query = query.eq("passed_gate", true);

  const { data, error } = await query
    .order("tier", { ascending: true, nullsFirst: false })
    .order("problem_score", { ascending: false, nullsFirst: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Contacts live in field_metadata rather than on the business row, so they are fetched
  // separately and joined here. One extra query rather than a column on `businesses`, because a
  // contact has provenance — where it came from and when it was last confirmed — and that is what
  // field_metadata exists to carry.
  const ids = (data ?? []).map((b) => b.id);
  const { data: contactRows } = await supabase
    .from("field_metadata")
    .select("business_id, field_name, value")
    .in("business_id", ids.length > 0 ? ids : ["00000000-0000-0000-0000-000000000000"])
    .in("field_name", ["contact_email", "contact_name", "contact_phone_web"]);

  const contacts = new Map<string, Record<string, string>>();
  for (const row of contactRows ?? []) {
    const existing = contacts.get(row.business_id) ?? {};
    existing[row.field_name] = row.value ?? "";
    contacts.set(row.business_id, existing);
  }

  const header = [
    "Business",
    "City",
    "State",
    "Phone",
    "Email",
    "Who to ask for",
    "Website",
    "Tier",
    "Problem",
    "Intent",
    "Recommended service",
    "Why",
    "Past the gate",
    "Needs review",
    "Review reasons",
    "Claim",
    // Once the file leaves the tool the filter chip is gone, so the distinction has to travel
    // with the rows. It also warns the reader that a Problem score on an imported row was built
    // from four areas rather than six.
    "Where from",
    "Found",
  ];

  const rows = (data ?? []).map((b) => [
    b.display_name,
    b.city ?? "Unknown",
    b.state ?? "Unknown",
    contacts.get(b.id)?.contact_phone_web ?? "Not found",
    contacts.get(b.id)?.contact_email ?? "Not found",
    contacts.get(b.id)?.contact_name ?? "Not found",
    b.website_status.replace(/_/g, " "),
    // "Not scored" rather than blank: §6.1 leaves an area unscored when too little was measured,
    // and a spreadsheet blank would read as a zero.
    b.tier === null ? "Not scored" : String(b.tier),
    b.problem_score === null ? "Not scored" : String(b.problem_score),
    b.intent_score === null ? "Not scored" : String(b.intent_score),
    b.route ? b.route.replace(/_/g, " ") : "Needs a look",
    b.route_reason ?? "",
    b.passed_gate === null ? "Not evaluated" : b.passed_gate ? "Yes" : "No",
    b.manual_review_status ? "Yes" : "No",
    (b.manual_review_reasons ?? []).join("; "),
    b.claim_status,
    BUSINESS_ORIGIN_LABELS[b.origin as BusinessOrigin]?.label ?? b.origin,
    new Date(b.created_at).toISOString().slice(0, 10),
  ]);

  const csv = [header, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  const stamp = new Date().toISOString().slice(0, 10);

  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Quotes a field for CSV. The leading apostrophe on anything starting with `=`, `+`, `-` or `@`
 * is deliberate: spreadsheet software treats those as the start of a formula, so a business
 * legitimately named "+1 Printing" would otherwise be executed rather than displayed. This data
 * comes from Google listings and from web pages, which is to say from strangers.
 */
function escapeCsv(value: string): string {
  const text = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}
