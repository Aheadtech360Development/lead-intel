import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AppShell, Banner, InfoBox, Note, PANEL, Panel, SectionHeading, TD } from "../../ui";
import { confirmImport, discardImport, uploadImport } from "./actions";
import type { ImportPreview } from "./actions";

/**
 * Bringing a list of businesses in from a file.
 *
 * Two steps, and the first writes nothing to the lead list. Uploading parses the file and shows
 * what *would* happen — how many are new, how many already exist and will fold into the record
 * you have, and which rows could not be read and why. Only the confirm button creates anything.
 *
 * That split is the point. A silent import is one where the operator finds out weeks later that
 * eight rows never arrived, or that they now have two copies of the same salon.
 */

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ batch?: string; error?: string }>;
}) {
  const { batch: batchId, error } = await searchParams;
  const supabase = await createClient();

  let preview: ImportPreview | null = null;
  let filename: string | null = null;
  if (batchId) {
    const { data } = await supabase
      .from("import_batches")
      .select("parsed, filename, status")
      .eq("id", batchId)
      .maybeSingle();
    if (data && data.status === "pending") {
      preview = data.parsed as ImportPreview;
      filename = data.filename;
    }
  }

  return (
    <AppShell
      autoRefresh={false}
      current="import"
      title="Import a list"
      what="Upload a CSV and see exactly what would happen before anything is saved. Businesses you already have are recognised and merged, so importing the same file twice cannot create duplicates."
    >

      <>
        {error && (
          <Banner tone="bad">{decodeURIComponent(error)}</Banner>
        )}

        {!preview && (
          <>
            <Panel title="Choose your file">
              <form action={uploadImport} style={{ padding: "16px 18px" }}>
                <input type="file" name="file" accept=".csv,text/csv" required style={{ fontSize: 15.5 }} />
                <div style={{ marginTop: 14 }}>
                  <button className="btn" type="submit">
                    Read the file
                  </button>
                  <span style={{ marginLeft: 12, fontSize: 14.5, color: "var(--ink-3)" }}>
                    Nothing is saved yet.
                  </span>
                </div>
              </form>
            </Panel>

            <Panel
              title="What your file needs"
              hint="Only the business name is required. Column headings can be roughly anything sensible."
            >
              <div style={{ padding: "14px 18px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15.5 }}>
                  <tbody>
                    {[
                      ["Business name", "Required", "name · business · company · Company Name · shop"],
                      ["Website", "Optional", "website · url · domain · Web Address"],
                      ["Phone", "Optional", "phone · tel · Phone Number · contact number"],
                      ["Email", "Optional", "email · e-mail · Email Address"],
                      ["City / state", "Optional", "city · town · state · province"],
                      ["Address", "Optional", "address · street · Street Address"],
                    ].map(([field, need, aliases]) => (
                      <tr key={field}>
                        <td style={{ padding: "7px 0", width: 150, fontWeight: 600 }}>{field}</td>
                        <td
                          style={{
                            padding: "7px 0",
                            width: 90,
                            color: need === "Required" ? "var(--ink)" : "var(--ink-3)",
                          }}
                        >
                          {need}
                        </td>
                        <td style={{ padding: "7px 0", color: "var(--ink-3)", fontSize: 14.5 }}>{aliases}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Note>
                Anything we cannot read — a broken website address, a phone number that is not
                valid — is listed with its row number rather than silently dropped.{" "}
                <strong>Importing costs nothing:</strong> the websites are crawled and analysed for
                free, and paid lookups stay a separate choice you make on the leads list.
              </Note>
            </Panel>
          </>
        )}

        {preview && (
          <>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
              <Summary value={preview.willCreate.length} label="New businesses" tone="accent" />
              <Summary value={preview.willMerge.length} label="Already in your list" hint="These merge, not duplicate" />
              <Summary
                value={preview.possibleDuplicates?.length ?? 0}
                label="Possible duplicates"
                hint="Same name, same town — you decide"
                tone={(preview.possibleDuplicates?.length ?? 0) > 0 ? "warn" : "muted"}
              />
              <Summary value={preview.rejected.length} label="Could not be read" tone={preview.rejected.length > 0 ? "warn" : "muted"} />
              <Summary value={preview.totalDataRows} label="Rows in the file" tone="muted" />
            </div>

            <Panel
              title={`How we read ${filename ?? "your file"}`}
              hint="Check this is right before importing — a mis-matched column is the one mistake this preview exists to catch."
            >
              {Object.entries(preview.columnMapping).map(([field, column]) => (
                <div key={field} style={{ display: "flex", gap: 14, ...TD }}>
                  <span style={{ flex: "0 0 170px", color: "var(--ink-3)" }}>{field}</span>
                  <span style={{ flex: 1 }}>
                    read from your column <strong>&ldquo;{column}&rdquo;</strong>
                  </span>
                </div>
              ))}
              {preview.unmatchedColumns.length > 0 && (
                <Note>
                  Not used: {preview.unmatchedColumns.join(", ")}. These columns are ignored — the
                  system has nowhere to put them, and inventing a place would mean storing something
                  nothing can read back.
                </Note>
              )}
            </Panel>

            {preview.rejected.length > 0 && (
              <Panel title={`${preview.rejected.length} rows we could not read`} hint="These will not be imported.">
                {preview.rejected.slice(0, 30).map((r) => (
                  <div key={`${r.rowNumber}-${r.reason}`} style={{ display: "flex", gap: 14, ...TD }}>
                    <span style={{ flex: "0 0 90px", color: "var(--ink-3)" }}>Row {r.rowNumber}</span>
                    <span style={{ flex: 1 }}>{r.reason}</span>
                  </div>
                ))}
                {preview.rejected.length > 30 && (
                  <Note>…and {preview.rejected.length - 30} more.</Note>
                )}
              </Panel>
            )}

            {preview.willMerge.length > 0 && (
              <Panel
                title={`${preview.willMerge.length} are already in your list`}
                hint="Their details will be added to the record you already have — no duplicate is created."
              >
                {preview.willMerge.slice(0, 20).map((m) => (
                  <div key={m.row.rowNumber} style={{ display: "flex", gap: 14, ...TD }}>
                    <span style={{ flex: "0 0 90px", color: "var(--ink-3)" }}>Row {m.row.rowNumber}</span>
                    <span style={{ flex: 1 }}>
                      <strong>{m.row.name}</strong>
                      <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                        matches &ldquo;{m.existingName}&rdquo; on their {m.matchedOn}
                      </div>
                    </span>
                  </div>
                ))}
                {preview.willMerge.length > 20 && <Note>…and {preview.willMerge.length - 20} more.</Note>}
              </Panel>
            )}

            {(preview.possibleDuplicates?.length ?? 0) > 0 && (
              <Panel
                title={`${preview.possibleDuplicates.length} might already be in your list`}
                hint="Same name, same town — but nothing strong enough to be sure. These are created and flagged for you to look at, never merged automatically."
              >
                {preview.possibleDuplicates.slice(0, 20).map((d) => (
                  <div key={d.row.rowNumber} style={{ display: "flex", gap: 14, ...TD }}>
                    <span style={{ flex: "0 0 90px", color: "var(--ink-3)" }}>Row {d.row.rowNumber}</span>
                    <span style={{ flex: 1 }}>
                      <strong>{d.row.name}</strong>
                      <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                        looks like &ldquo;{d.existingName}&rdquo;, which you already have in{" "}
                        {d.row.city ?? "the same town"}
                      </div>
                    </span>
                  </div>
                ))}
                <Note>
                  A CSV has no map coordinates, so we cannot build the same identity key a Google
                  Maps result produces. Matching on name and town is real evidence but not proof —
                  two different shops can share a name in one city — so these are raised rather than
                  merged.
                </Note>
              </Panel>
            )}

            {(preview.sharedWebsites?.length ?? 0) > 0 && (
              <Panel
                title={`${preview.sharedWebsites!.length} list a chain or platform website`}
                hint="These import normally — but their website is not analysed, so they will not get a score."
              >
                {preview.sharedWebsites!.slice(0, 20).map((s) => (
                  <div key={s.row.rowNumber} style={{ display: "flex", gap: 14, ...TD }}>
                    <span style={{ flex: "0 0 90px", color: "var(--ink-3)" }}>Row {s.row.rowNumber}</span>
                    <span style={{ flex: 1 }}>
                      <strong>{s.row.name}</strong>
                      <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                        the website given is <strong>{s.matched}</strong> — the {s.kind}&rsquo;s own
                        address, shared by every location on it
                      </div>
                    </span>
                  </div>
                ))}
                <Note tone="warn">
                  Analysing that address would produce a page full of findings about the {" "}
                  {preview.sharedWebsites![0]?.kind === "chain" ? "chain" : "platform"} and file them
                  under this business. It is also why these rows are <strong>not</strong> merged into
                  one another: two franchises of the same brand share a domain without being the same
                  shop, so they are told apart by phone and town instead.
                </Note>
              </Panel>
            )}

            {preview.willCreate.length > 0 && (
              <Panel title={`${preview.willCreate.length} new businesses`} hint="A sample of what will be created.">
                {preview.willCreate.slice(0, 12).map((row) => (
                  <div key={row.rowNumber} style={{ display: "flex", gap: 14, ...TD }}>
                    <span style={{ flex: "0 0 90px", color: "var(--ink-3)" }}>Row {row.rowNumber}</span>
                    <span style={{ flex: 1 }}>
                      <strong>{row.name}</strong>
                      <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                        {[row.domain, row.phone, [row.city, row.state].filter(Boolean).join(", ")]
                          .filter(Boolean)
                          .join(" · ") || "name only"}
                      </div>
                    </span>
                  </div>
                ))}
                {preview.willCreate.length > 12 && <Note>…and {preview.willCreate.length - 12} more.</Note>}
              </Panel>
            )}

            {/* The plan. Asked here, before the import, because this is the moment the operator
                knows what the file is — an hour later it is just rows in a list. */}
            <SectionHeading
              title="What should we do with this file?"
              hint="Chosen once, saved with the file, and shown on its page afterwards so you can see what it was told to do."
            />

            <form action={confirmImport}>
              <input type="hidden" name="batch" value={batchId} />

              <Job
                name="analyseWebsites"
                defaultChecked
                icon="🌐"
                tone="brand"
                title="Read their websites and score them"
                price="Free"
                describes="Crawls each site — home page, contact, about, socials — runs all 51 checks, measures their speed, then works out a problem score, a priority and what to sell them. This is what turns a row in a spreadsheet into a lead."
              />

              <Job
                name="applyCategories"
                defaultChecked
                icon="🏷️"
                tone="social"
                title="Match them to my ICPs"
                price="Free"
                describes={
                  <>
                    Matches these businesses against your{" "}
                    <Link href="/icps" target="_blank">
                      ICPs
                    </Link>{" "}
                    once their websites have been read, so the file arrives already labelled. Runs
                    after the crawl, never alongside it — an ICP looking for a word on a website needs
                    the website read first.
                  </>
                }
              />

              <Job
                name="instagram"
                icon="📸"
                tone="money"
                title="Then go and get their Instagram"
                price="≈ $0.0026 each"
                describes="Follower count, the category Instagram publishes for the account, their bio and the link in it. Ticking this does not buy anything — it takes you to the price screen with this file already selected, and you confirm there."
                warning="Instagram publishes a follower count and never a list of followers. Who follows an account cannot be bought at any price."
              />

              <div style={{ ...PANEL, padding: "14px 16px" }}>
                <label style={{ display: "block", fontSize: 15, fontWeight: 600, marginBottom: 3 }}>
                  A note about this file — optional
                </label>
                <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginBottom: 6 }}>
                  Where it came from, what it is, why you imported it. Shown on the file&rsquo;s page.
                </div>
                <input
                  name="note"
                  placeholder="e.g. apparel brands pulled from Instantly, Texas, August"
                  style={{
                    width: "100%",
                    padding: "9px 11px",
                    fontSize: 16,
                    border: "1px solid var(--rule-2)",
                    borderRadius: 3,
                    background: "var(--surface)",
                    color: "var(--ink)",
                  }}
                />
              </div>

              <div style={{ ...PANEL, padding: 18, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn" type="submit" disabled={preview.willCreate.length + preview.willMerge.length === 0}>
                  Import {preview.willCreate.length + preview.willMerge.length} rows
                </button>
                <button className="btn-2 btn" type="submit" formAction={discardImport}>
                  Start over
                </button>
                <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                  Importing itself is free, and so is everything ticked above except Instagram —
                  which is priced on the next screen before anything is spent.
                </span>
              </div>
            </form>

            {/* Named so its absence is a decision rather than an omission. The operator asked for
                exactly this: ads are picked one business at a time, by hand. */}
            <InfoBox title="Facebook and Instagram ads are not on this list — on purpose" tone="warn">
              You said you would pick those yourself, business by business, so checking ads is never
              part of an import and never part of the analysis. It lives on the leads list: tick the
              handful you care about, and buy it for those. At about 11.6¢ each it is roughly{" "}
              <strong>45× the price of an Instagram profile</strong>, which is why it is a decision
              rather than a default.
            </InfoBox>
          </>
        )}
      </>
    </AppShell>
  );
}

/**
 * One thing the import can be told to do.
 *
 * A checkbox with its price on the same line, because "free" and "costs money" are the only two
 * facts that change how somebody reads the rest of the row.
 */
function Job({
  name,
  icon,
  tone,
  title,
  price,
  describes,
  warning,
  defaultChecked = false,
}: {
  name: string;
  icon: string;
  tone: "brand" | "social" | "money";
  title: string;
  price: string;
  describes: React.ReactNode;
  warning?: string;
  defaultChecked?: boolean;
}) {
  return (
    <div style={{ ...PANEL, padding: 0, overflow: "hidden" }}>
      <label style={{ display: "flex", gap: 13, padding: "15px 17px", cursor: "pointer", alignItems: "flex-start" }}>
        <input type="checkbox" name={name} defaultChecked={defaultChecked} style={{ width: 17, height: 17, marginTop: 3 }} />
        <span style={{ flex: 1 }}>
          <span style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <strong style={{ fontSize: 17 }}>
              <span style={{ marginRight: 7 }}>{icon}</span>
              {title}
            </strong>
            <strong
              style={{
                fontSize: 15,
                whiteSpace: "nowrap",
                color: tone === "money" ? "var(--money)" : "var(--good)",
              }}
            >
              {price}
            </strong>
          </span>
          <span style={{ display: "block", fontSize: 15, color: "var(--ink-2)", marginTop: 5, lineHeight: 1.55 }}>
            {describes}
          </span>
          {warning && (
            <span
              style={{
                display: "block",
                marginTop: 9,
                padding: "8px 10px",
                background: "var(--warn-bg)",
                color: "var(--warn-ink)",
                borderRadius: 4,
                fontSize: 14.5,
                lineHeight: 1.5,
              }}
            >
              ⚠ {warning}
            </span>
          )}
        </span>
      </label>
    </div>
  );
}

function Summary({
  value,
  label,
  hint,
  tone = "plain",
}: {
  value: number;
  label: string;
  hint?: string;
  tone?: "plain" | "accent" | "muted" | "warn";
}) {
  const colour =
    tone === "accent" ? "var(--accent)" : tone === "warn" ? "var(--bad)" : tone === "muted" ? "var(--ink-3)" : "var(--ink)";
  return (
    <div style={{ ...PANEL, marginBottom: 0, padding: "14px 16px", flex: "1 1 170px", minWidth: 160 }}>
      <div style={{ fontSize: 31, fontWeight: 700, lineHeight: 1.1, color: colour }}>{value}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink-2)", marginTop: 3 }}>{label}</div>
      {hint ? <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 3 }}>{hint}</div> : null}
    </div>
  );
}
