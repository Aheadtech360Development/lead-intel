import { BUSINESS_ORIGIN_LABELS } from "@lead-intel/shared";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../../actions";
import { AppShell, Banner, Note, PANEL, Panel, TD, Th, StageStrip } from "../../ui";
import { deleteImportBatch } from "./actions";

/**
 * Every file ever imported, and what became of it.
 *
 * The importer used to be a one-way door: upload, confirm, and the file was gone. A month later
 * "where did these 121 businesses come from" had no answer beyond a filename printed once on a
 * redirect. The batch row was already being kept — the parse is stored so the preview an operator
 * approves and the rows that get written are literally the same object — so the history was there
 * all along with nothing reading it.
 */

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const { error, done } = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const [{ data: batches }, { data: businessRows }] = await Promise.all([
    supabase
      .from("import_batches")
      .select("id, filename, status, row_count, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(200),
    // How many businesses each batch actually created — the number that matters, and the one that
    // differs from `row_count` whenever rows merged into records that already existed.
    supabase.from("businesses").select("import_batch_id").not("import_batch_id", "is", null).limit(20000),
  ]);

  const created = new Map<string, number>();
  for (const row of businessRows ?? []) {
    const id = row.import_batch_id as string;
    created.set(id, (created.get(id) ?? 0) + 1);
  }

  const rows = batches ?? [];
  const imported = rows.filter((b) => b.status === "imported");

  return (
    <AppShell
      current="import"
      email={typeof claims?.email === "string" ? claims.email : null}
      signOutAction={signOut}
      title="Imported files"
      what="Every list you have uploaded, and exactly what each one produced. Click a file to see the whole thing — the rows that merged into businesses you already had, the ones flagged as possible duplicates, and every row that could not be read, with its reason."
      actions={
        <Link href="/records/import" className="btn">
          Import another file
        </Link>
      }
    >
      <>
        <StageStrip current="sourcing" />
        {error && (
          <Banner tone="bad">{decodeURIComponent(error)}</Banner>
        )}
        {done && (
          <Banner tone="good">{decodeURIComponent(done)}</Banner>
        )}

        {imported.length === 0 && rows.length === 0 && (
          <div style={{ ...PANEL, padding: "56px 24px", textAlign: "center", color: "var(--ink-3)" }}>
            <h3 style={{ color: "var(--ink)", fontSize: 20.5, margin: "0 0 8px" }}>No files yet</h3>
            <p style={{ maxWidth: 460, margin: "0 auto 14px", fontSize: 15.5 }}>
              Upload a CSV of businesses and it will appear here with everything that happened to it.
            </p>
            <Link href="/records/import" className="btn" style={{ textDecoration: "none" }}>
              Import a list
            </Link>
          </div>
        )}

        {rows.length > 0 && (
          <Panel
            title={`${imported.length} imported`}
            hint="A file that was uploaded but never confirmed is shown too, so nothing looks like it vanished."
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ background: "var(--surface-2)" }}>
                <tr>
                  <Th label="File" explain="Click to see everything in it" />
                  <Th label="When" width={150} />
                  <Th label="Rows" explain="Readable rows in the file" width={90} />
                  <Th label="Businesses" explain="New records it created" width={120} />
                  <Th label="Status" width={120} />
                  <Th label="" width={130} />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id}>
                    <td style={TD}>
                      <Link href={`/records/imports/${b.id}`} style={{ fontWeight: 600 }}>
                        {b.filename ?? "an uploaded file"}
                      </Link>
                    </td>
                    <td style={{ ...TD, color: "var(--ink-3)", fontSize: 15 }}>
                      {new Date(b.created_at).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{b.row_count}</td>
                    <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>
                      {b.status === "imported" ? (created.get(b.id) ?? 0) : <span style={{ color: "var(--ink-3)" }}>—</span>}
                    </td>
                    <td style={TD}>
                      <StatusBadge status={b.status} />
                    </td>
                    <td style={TD}>
                      {(created.get(b.id) ?? 0) > 0 ? (
                        <Link href={`/records?view=everything&from=imported&batch=${b.id}`} style={{ fontSize: 15 }}>
                          Show its {created.get(b.id)} leads
                        </Link>
                      ) : (
                        // Offered only when the file owns nothing. A file that created businesses
                        // keeps them tied to it; see actions.ts for why detaching them silently is
                        // the outcome worth preventing.
                        <form action={deleteImportBatch} style={{ display: "inline" }}>
                          <input type="hidden" name="batch" value={b.id} />
                          <button
                            type="submit"
                            style={{
                              background: "none",
                              border: 0,
                              color: "var(--bad)",
                              fontSize: 15,
                              cursor: "pointer",
                              padding: 0,
                            }}
                          >
                            Delete
                          </button>
                          <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>created nothing</div>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Note>
              Businesses created from a file are also filtered on the leads list under{" "}
              <strong>{BUSINESS_ORIGIN_LABELS.imported.label}</strong>. They carry no Google
              listing, so reviews and local-search checks cannot run on them — their score comes
              from four areas rather than six.
            </Note>
            <Note tone="warn">
              <strong>Deleting a file.</strong> A file that created no businesses — uploaded and
              never confirmed, discarded, or one where every row merged into records you already had
              — can be deleted outright; there is nothing behind it. A file that <em>did</em> create
              businesses cannot, because those businesses point at it: remove the file and they would
              still say they came from an import, with no import left to open. Delete or archive
              those businesses first if you want the file gone.
            </Note>
          </Panel>
        )}
      </>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === "imported" ? "Imported" : status === "discarded" ? "Discarded" : "Uploaded, not confirmed";
  const colour = status === "imported" ? "var(--accent)" : "var(--ink-3)";
  return <span style={{ fontSize: 14.5, color: colour, fontWeight: status === "imported" ? 600 : 400 }}>{label}</span>;
}
