import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../../../actions";
import type { ImportPlan, ImportPreview } from "../../import/actions";
import { AppShell, Note, PANEL, Panel, TD, Th } from "../../../ui";

/**
 * One imported file, in full.
 *
 * Everything here was already stored — `import_batches.parsed` holds the exact preview the
 * operator approved, which is why the confirm step imports the same object it showed rather than
 * re-parsing the bytes. Nothing read it back until now, so a file's rejected rows and their
 * reasons existed and could not be looked at once the redirect had gone.
 */

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const { data: batch } = await supabase
    .from("import_batches")
    .select("id, filename, status, row_count, created_at, completed_at, parsed, plan")
    .eq("id", id)
    .maybeSingle();
  if (!batch) notFound();

  const preview = batch.parsed as ImportPreview;
  // Null for every file imported before the plan existed. Shown as "not recorded" rather than as a
  // set of unticked boxes, which would claim the operator chose not to do things they were never
  // asked about.
  const plan = (batch.plan ?? null) as ImportPlan | null;

  const { data: madeRows } = await supabase
    .from("businesses")
    .select("id, display_name, city, state, tier, problem_score, passed_gate")
    .eq("import_batch_id", id)
    .order("tier", { ascending: true, nullsFirst: false })
    .limit(1000);
  const made = madeRows ?? [];

  return (
    <AppShell
      back={{ href: "/records/imports", label: "All imported files" }}
      email={typeof claims?.email === "string" ? claims.email : null}
      signOutAction={signOut}
    >

      <>
        <h1 style={{ fontSize: 27, margin: "0 0 4px" }}>{batch.filename ?? "an uploaded file"}</h1>
        <p style={{ color: "var(--ink-3)", margin: "0 0 20px", fontSize: 15.5 }}>
          Uploaded {new Date(batch.created_at).toLocaleString("en-GB")} ·{" "}
          {batch.status === "imported" ? "imported" : batch.status === "discarded" ? "discarded" : "never confirmed"}
        </p>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
          <Fig value={preview?.totalDataRows ?? batch.row_count} label="Rows in the file" />
          <Fig value={made.length} label="Businesses created" tone="accent" />
          <Fig value={preview?.willMerge?.length ?? 0} label="Merged into existing" />
          <Fig value={preview?.possibleDuplicates?.length ?? 0} label="Flagged as possible duplicates" />
          <Fig value={preview?.rejected?.length ?? 0} label="Could not be read" tone={(preview?.rejected?.length ?? 0) > 0 ? "warn" : "muted"} />
        </div>

        <Panel
          title="What this file was told to do"
          hint="Chosen at the moment of import, so it is a record of the decision rather than a guess from what exists now."
        >
          {plan === null ? (
            <div style={{ padding: "14px 18px", fontSize: 15.5, color: "var(--ink-3)", lineHeight: 1.6 }}>
              Not recorded. This file was imported before the product asked what to do with a file —
              it was analysed and scored, which is what every import did then. Files imported from
              now on carry their own answer here.
            </div>
          ) : (
            <>
              <Did on={plan.analyseWebsites} label="Read their websites and score them" note="Free" />
              <Did on={plan.applyCategories} label="Matched to your ICPs" note="Free" />
              <Did
                on={plan.instagram}
                label="Go on to buy their Instagram"
                note={
                  plan.instagram
                    ? "You were taken to the price screen — whether you confirmed there is recorded on Data & spend, not here."
                    : "Not asked for"
                }
              />
              <div style={{ ...TD, color: "var(--ink-3)", fontSize: 14.5 }}>
                ✕ Facebook / Instagram ads — never part of an import. Picked business by business.
              </div>
              {plan.note && (
                <div style={{ ...TD }}>
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginBottom: 2 }}>Your note</div>
                  <div style={{ fontSize: 16 }}>{plan.note}</div>
                </div>
              )}
            </>
          )}
        </Panel>

        {preview?.columnMapping && Object.keys(preview.columnMapping).length > 0 && (
          <Panel title="How the file was read" hint="Which of your columns became which field.">
            {Object.entries(preview.columnMapping).map(([field, column]) => (
              <div key={field} style={{ display: "flex", gap: 14, ...TD }}>
                <span style={{ flex: "0 0 170px", color: "var(--ink-3)" }}>{field}</span>
                <span style={{ flex: 1 }}>
                  from your column <strong>&ldquo;{column}&rdquo;</strong>
                </span>
              </div>
            ))}
            {(preview.unmatchedColumns?.length ?? 0) > 0 && (
              <Note>Columns not used: {preview.unmatchedColumns.join(", ")}.</Note>
            )}
          </Panel>
        )}

        {(preview?.rejected?.length ?? 0) > 0 && (
          <Panel
            title={`${preview.rejected.length} rows could not be read`}
            hint="Kept with their row numbers so you can find them in your spreadsheet."
          >
            {preview.rejected.slice(0, 100).map((r) => (
              <div key={`${r.rowNumber}-${r.reason}`} style={{ display: "flex", gap: 14, ...TD }}>
                <span style={{ flex: "0 0 90px", color: "var(--ink-3)" }}>Row {r.rowNumber}</span>
                <span style={{ flex: 1 }}>{r.reason}</span>
              </div>
            ))}
            {preview.rejected.length > 100 && <Note>…and {preview.rejected.length - 100} more.</Note>}
          </Panel>
        )}

        {(preview?.willMerge?.length ?? 0) > 0 && (
          <Panel
            title={`${preview.willMerge.length} rows merged into businesses you already had`}
            hint="These did not create a second record. They stay under 'Found by search', because that is where they came from."
          >
            {preview.willMerge.slice(0, 60).map((m) => (
              <div key={m.row.rowNumber} style={{ display: "flex", gap: 14, ...TD }}>
                <span style={{ flex: "0 0 90px", color: "var(--ink-3)" }}>Row {m.row.rowNumber}</span>
                <span style={{ flex: 1 }}>
                  <strong>{m.row.name}</strong>
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                    matched &ldquo;{m.existingName}&rdquo; on their {m.matchedOn}
                  </div>
                </span>
              </div>
            ))}
          </Panel>
        )}

        {made.length > 0 && (
          <Panel title={`${made.length} businesses this file created`} hint="Ordered best first, same as the leads list.">
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ background: "var(--surface-2)" }}>
                <tr>
                  <Th label="Business" />
                  <Th label="Where" width={180} />
                  <Th label="Priority" width={90} />
                  <Th label="Problem" width={90} />
                  <Th label="Worth calling" width={120} />
                </tr>
              </thead>
              <tbody>
                {made.slice(0, 300).map((b) => (
                  <tr key={b.id}>
                    <td style={TD}>
                      <Link href={`/records/${b.id}`} style={{ fontWeight: 600 }}>
                        {b.display_name}
                      </Link>
                    </td>
                    <td style={{ ...TD, color: "var(--ink-3)", fontSize: 15 }}>
                      {[b.city, b.state].filter(Boolean).join(", ") || "Unknown"}
                    </td>
                    <td style={TD}>{b.tier ?? <span style={{ color: "var(--ink-3)" }}>—</span>}</td>
                    <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>
                      {b.problem_score ?? <span style={{ color: "var(--ink-3)" }}>—</span>}
                    </td>
                    <td style={TD}>{b.passed_gate ? "Yes" : <span style={{ color: "var(--ink-3)" }}>No</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {made.length > 300 && <Note>Showing the first 300.</Note>}
          </Panel>
        )}
      </>
    </AppShell>
  );
}

/** One line of the plan: whether it was asked for, and what that meant. */
function Did({ on, label, note }: { on: boolean; label: string; note: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline", ...TD }}>
      <span style={{ flex: "0 0 22px", color: on ? "var(--good)" : "var(--ink-3)", fontWeight: 700 }}>
        {on ? "✓" : "✕"}
      </span>
      <span style={{ flex: 1, color: on ? "var(--ink)" : "var(--ink-3)" }}>
        {label}
        <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 2 }}>{note}</div>
      </span>
    </div>
  );
}

function Fig({ value, label, tone = "plain" }: { value: number; label: string; tone?: "plain" | "accent" | "muted" | "warn" }) {
  const colour =
    tone === "accent" ? "var(--accent)" : tone === "warn" ? "var(--bad)" : tone === "muted" ? "var(--ink-3)" : "var(--ink)";
  return (
    <div style={{ ...PANEL, marginBottom: 0, padding: "14px 16px", flex: "1 1 165px", minWidth: 155 }}>
      <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, color: colour, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink-2)", marginTop: 3 }}>{label}</div>
    </div>
  );
}
