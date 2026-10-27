import type { ObjectionCategory, OutreachResult } from "@lead-intel/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { signOut } from "../actions";
import { AppShell, Badge, InfoBox, PANEL, SectionHeading, StatCard, TD, Th, type Tone } from "../ui";

/**
 * Every conversation logged, in one place.
 *
 * Calls were recorded per business and could only be read per business, so the product could not
 * answer the three questions a salesperson asks about their own week — *who have I spoken to, what
 * came of it, and what is due back*. The record was there; the screen was not.
 *
 * It is deliberately not a CRM. Four columns and a date: what happened, when, to whom, and what
 * happens next. Anything more belongs on the lead, where the findings are.
 */

const RESULT: Record<OutreachResult, { label: string; tone: Tone; next: string }> = {
  no_answer: { label: "No answer", tone: "plain", next: "Try again" },
  not_interested: { label: "Not interested", tone: "plain", next: "Nothing" },
  interested: { label: "Interested", tone: "good", next: "Follow up" },
  follow_up_requested: { label: "Asked me to follow up", tone: "warn", next: "Call back" },
  meeting_booked: { label: "Meeting booked", tone: "brand", next: "Turn up" },
  do_not_contact: { label: "Do not contact", tone: "bad", next: "Leave alone" },
  invalid_contact: { label: "Wrong or dead number", tone: "bad", next: "Find another number" },
};

const OBJECTION: Record<ObjectionCategory, string> = {
  none: "—",
  price: "Price",
  timing: "Timing",
  competition: "They use somebody else",
  authority: "Not the decision-maker",
  status_quo: "Happy as they are",
  technical: "Something technical",
};

function when(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return `Today ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const { show } = await searchParams;

  const supabase = await createClient();

  /**
   * A member sees their own calls and nobody else's.
   *
   * `outcomes.user_id` is written when a call is logged, so this is the one piece of per-person
   * scoping the database already supports without the ownership work. An administrator sees the
   * team's, which is the point of their version of this screen.
   */
  let query = supabase
    .from("outcomes")
    .select("id, business_id, channel, result, objection, notes, meeting_date, created_at, user_id")
    .order("created_at", { ascending: false })
    .limit(500);
  if (!viewer.isAdmin) query = query.eq("user_id", viewer.id);
  const { data: callRows } = await query;

  const calls = callRows ?? [];
  const businessIds = [...new Set(calls.map((c) => c.business_id as string))];

  const { data: businessRows } = businessIds.length
    ? await supabase.from("businesses").select("id, display_name, city, state, tier").in("id", businessIds)
    : { data: [] };

  const byId = new Map((businessRows ?? []).map((b) => [b.id as string, b]));

  const interested = calls.filter((c) => c.result === "interested" || c.result === "meeting_booked");
  const dueBack = calls.filter((c) => c.meeting_date !== null);
  const doNotContact = calls.filter((c) => c.result === "do_not_contact");

  const filtered =
    show === "interested"
      ? interested
      : show === "due"
        ? dueBack
        : show === "no_answer"
          ? calls.filter((c) => c.result === "no_answer")
          : calls;

  const mine = viewer.isAdmin ? "the team has" : "you have";

  return (
    <AppShell
      current="calls"
      email={viewer.email}
      signOutAction={signOut}
      title={viewer.isAdmin ? "Calls & history" : "My calls"}
      what={`Every conversation ${mine} logged — what happened, when, and what is due back. A call stays on the record for good, and survives if duplicate records are merged.`}
    >
      <>
        {calls.length === 0 ? (
          <div className="card empty">
            <span className="art" aria-hidden>
              ☎
            </span>
            <h3>No calls logged yet</h3>
            <p>
              Nothing has been recorded. Open a lead, read why it is worth calling and what to say, and the{" "}
              <strong>Log a call</strong> button is on the same screen — it takes about fifteen seconds and it is what
              teaches this product which openers actually work.
            </p>
            <Link href="/records" className="btn">
              Open the call list
            </Link>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
              <StatCard value={calls.length} label="Calls logged" explain={viewer.isAdmin ? "By everyone." : "By you, all time."} />
              <StatCard
                value={interested.length}
                tone={interested.length > 0 ? "good" : "plain"}
                label="Interested or booked"
                explain="The two results worth coming back to."
              />
              <StatCard
                value={dueBack.length}
                tone={dueBack.length > 0 ? "warn" : "plain"}
                label="Due back"
                explain="A date was set when the call was logged. There is no reminders screen in this product — this filter is how you find them."
              />
              <StatCard value={doNotContact.length} label="Do not contact" explain="These are left alone." />
            </div>

            <div className="filters" style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { key: "", label: `All ${calls.length}` },
                { key: "interested", label: `Interested ${interested.length}` },
                { key: "due", label: `Due back ${dueBack.length}` },
                { key: "no_answer", label: `No answer ${calls.filter((c) => c.result === "no_answer").length}` },
              ].map((chip) => (
                <Link
                  key={chip.key || "all"}
                  href={chip.key ? `/calls?show=${chip.key}` : "/calls"}
                  className="btn secondary sm"
                  aria-current={(show ?? "") === chip.key ? "page" : undefined}
                  style={
                    (show ?? "") === chip.key
                      ? { background: "var(--accent-sub)", borderColor: "var(--accent-line)", color: "var(--accent-ink)" }
                      : undefined
                  }
                >
                  {chip.label}
                </Link>
              ))}
            </div>

            <SectionHeading title={`${filtered.length} ${filtered.length === 1 ? "call" : "calls"}`} hint="Newest first." />
            <div style={PANEL}>
              <div style={{ overflowX: "auto" }}>
                <table className="data" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 860 }}>
                  <thead>
                    <tr>
                      <Th label="When" width={120} />
                      <Th label="Business" />
                      <Th label="How" width={90} />
                      <Th label="What happened" width={190} />
                      <Th label="Why not" explain="The objection recorded on the call. It is how the product learns which openers run into which walls." width={180} />
                      <Th label="What next" width={150} />
                      <Th label="" width={56} />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((call) => {
                      const business = byId.get(call.business_id as string);
                      const result = RESULT[call.result as OutreachResult] ?? {
                        label: String(call.result),
                        tone: "plain" as Tone,
                        next: "—",
                      };
                      return (
                        <tr key={call.id as string}>
                          <td style={{ ...TD, fontSize: 12, color: "var(--ink-2)" }}>{when(call.created_at as string)}</td>
                          <td style={TD}>
                            <b style={{ color: "var(--ink)" }}>{business?.display_name ?? "A business that has since been merged"}</b>
                            <div style={{ fontSize: 11.5, color: "var(--ink-2)" }}>
                              {[business?.city, business?.state].filter(Boolean).join(" ") || "—"}
                              {business?.tier ? ` · Priority ${business.tier}` : ""}
                            </div>
                          </td>
                          <td style={{ ...TD, fontSize: 12.5 }}>{call.channel === "message" ? "Message" : "Call"}</td>
                          <td style={TD}>
                            <Badge tone={result.tone}>{result.label}</Badge>
                          </td>
                          <td style={{ ...TD, fontSize: 12.5, color: "var(--ink-2)" }}>
                            {OBJECTION[call.objection as ObjectionCategory] ?? "—"}
                          </td>
                          <td style={TD}>
                            {call.meeting_date ? (
                              <Badge tone="warn">
                                {new Date(call.meeting_date as string).toLocaleDateString("en-GB", {
                                  weekday: "short",
                                  day: "numeric",
                                  month: "short",
                                })}
                              </Badge>
                            ) : (
                              <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{result.next}</span>
                            )}
                          </td>
                          <td style={TD}>
                            <Link href={`/records/${call.business_id}?tab=calls`} className="btn ghost sm">
                              Open
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <InfoBox title="What a call keeps" tone="info">
              The channel, the result, the objection, which opener you used, your notes and a date to come back on.
              Nothing else — and it is attached to the business for good, so if two records for the same business are
              ever merged, the conversation is not lost.
            </InfoBox>
          </>
        )}
      </>
    </AppShell>
  );
}
