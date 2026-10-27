import { ICP_SOURCE_LABELS, ICP_SOURCES, riskyTerms, type Icp } from "@lead-intel/core";
import Link from "next/link";
import { previewRule, type RulePreview } from "@/lib/rule-preview";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { signOut } from "../actions";
import { refreshWebsiteText } from "../records/analyse-actions";
import { AppShell, Banner, Badge, InfoBox, Note, PANEL, Panel, SectionHeading, TD, Th, StageStrip } from "../ui";
import { addExampleRules, applyRules, deleteRule, saveRule, suggestRule } from "./actions";

/**
 * The operator's own taxonomy, the rules that assign it, and — new here — the two questions a rule
 * can ask separately.
 *
 * Instagram publishes one category per account and no second level, so "t-shirts within fashion" is
 * not something to fetch; it is something to decide. What the earlier version of this screen could
 * not express was a rule about *two* sources at once. One word list searched everywhere, so
 * "embroidery on their website and a clothing brand on Instagram" and "either word anywhere" were
 * the same rule. They are not the same rule, and the second one is much less useful.
 *
 * So the form now has three boxes — anywhere, their website, their Instagram — and a switch that
 * turns them from alternatives into a conjunction. That switch is the feature: it is how a website
 * gets related to an Instagram account rather than merely searched alongside it.
 */

interface Params {
  edit?: string;
  error?: string;
  saved?: string;
  applied?: string;
  bought?: string;
  /**
   * A draft rule, sent here by the form's Preview button as an ordinary GET submit.
   *
   * The whole app runs without client-side JavaScript, so "show me what this would catch" cannot be
   * a live calculation. A second submit button with `formMethod="get"` puts every field the
   * operator has typed into the query string and reloads this page, which then matches the draft
   * and fills the form back in. No script, no draft saved to the database, and the preview is
   * computed by the same matcher the real pass uses.
   */
  preview?: string;
  name?: string;
  /** "1" while the panel is open on a new ICP. Editing carries `edit` instead. */
  add?: string;
  industry?: string;
  searchTerms?: string;
  requiresWebsite?: string;
  minReviews?: string;
  places?: string;
  priority?: string;
  anyOf?: string;
  websiteAnyOf?: string;
  instagramAnyOf?: string;
  noneOf?: string;
  requireAll?: string;
  minFollowers?: string;
  maxFollowers?: string;
  sources?: string | string[];
  /** Set when the draft came from the model rather than from the operator typing it. */
  ai?: string;
  aiUnderstood?: string;
  aiReasons?: string;
  aiCost?: string;
}

/** Comma or newline separated, the same reading `saveRule` gives these fields. */
function terms(value: string | undefined): string[] {
  return String(value ?? "")
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function optionalNumber(value: string | undefined): number | null {
  const n = Number(String(value ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export default async function IcpsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const viewer = await getViewer();
  const claims = viewer ? { sub: viewer.id, email: viewer.email } : null;

  /**
   * Members read these; the administrator writes them.
   *
   * The agreed model (`specs/multi-user/spec.md` §2) makes ICPs read-only for a member, so that
   * one lead means the same thing to everybody on the team. Applying them is left available,
   * because matching is free, re-runnable and changes no rule — it only re-sorts.
   */
  const canEdit = viewer?.isAdmin ?? false;

  const [
    { data: rules },
    { data: matched },
    { count: total },
    { count: withInstagram },
    { count: withSiteText },
    { count: withWebsite },
  ] = await Promise.all([
    supabase.from("icps").select("*").order("priority").order("created_at"),
    supabase
      .from("businesses")
      .select("icp_name, icp_id")
      .eq("status", "active")
      .not("icp_name", "is", null)
      .limit(20000),
    supabase.from("businesses").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase
      .from("field_metadata")
      .select("business_id", { count: "exact", head: true })
      .eq("field_name", "instagram_followers"),
    // What the website half of every rule actually has to read. The crawler stores a 2,000-character
    // digest of the pages, but only started doing so when these rules were built — so businesses
    // crawled before that have findings and no text, and a rule looking for a word on their website
    // silently has nowhere to look.
    supabase.from("field_metadata").select("business_id", { count: "exact", head: true }).eq("field_name", "site_text"),
    supabase.from("field_metadata").select("business_id", { count: "exact", head: true }).eq("field_name", "website_url"),
  ]);

  const all = rules ?? [];
  const editing = params.edit ? all.find((r) => r.id === params.edit) : null;

  // A draft arrived from the Preview button. Everything the operator typed is in the query string;
  // nothing has been written anywhere. `draft` also re-fills the form so pressing Preview does not
  // wipe the work — losing a half-written rule to a preview would make the button not worth using.
  const draft: Icp | null = params.preview
    ? {
        id: params.edit ?? "draft",
        name: params.name ?? "this ICP",
        industry: params.industry ?? "",
        priority: Number(params.priority ?? 100) || 100,
        enabled: true,
        sources: (Array.isArray(params.sources) ? params.sources : params.sources ? [params.sources] : []).filter(Boolean),
        anyOf: terms(params.anyOf),
        noneOf: terms(params.noneOf),
        websiteAnyOf: terms(params.websiteAnyOf),
        instagramAnyOf: terms(params.instagramAnyOf),
        requireAll: params.requireAll === "on",
        minFollowers: optionalNumber(params.minFollowers),
        maxFollowers: optionalNumber(params.maxFollowers),
        searchTerms: terms(params.searchTerms),
        requiresWebsite: params.requiresWebsite === "on",
        minReviews: optionalNumber(params.minReviews),
        places: terms(params.places),
      }
    : null;

  const preview = draft ? await previewRule(supabase, draft) : null;

  /**
   * The form is a panel, and it is closed until asked for.
   *
   * The operator's words: a form for adding something should not sit open on the page when there
   * is nothing to add. It opens on + Add an ICP, on Edit, and on the way back from Preview or from
   * a suggestion — all of which are states this page can be in without any JavaScript, because
   * each one is a URL.
   */
  const panelOpen = params.add === "1" || Boolean(params.edit) || Boolean(params.preview);

  // Everything the model said about its own suggestion. Parsed defensively: a malformed reasons map
  // must cost the operator the explanations, never the page.
  const aiUnderstood = params.ai && params.aiUnderstood ? params.aiUnderstood : null;
  const aiReasons: Record<string, string> = (() => {
    if (!params.ai || !params.aiReasons) return {};
    try {
      const parsed: unknown = JSON.parse(params.aiReasons);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  })();
  const risky = draft && params.ai ? riskyTerms(draft) : [];

  /** What the form shows: the draft if one came back from Preview, otherwise the saved rule. */
  const form = draft ?? {
    name: editing?.name ?? "",
    industry: editing?.industry ?? "",
    priority: editing?.priority ?? 100,
    sources: editing?.sources ?? [],
    anyOf: editing?.any_of ?? [],
    noneOf: editing?.none_of ?? [],
    websiteAnyOf: editing?.website_any_of ?? [],
    instagramAnyOf: editing?.instagram_any_of ?? [],
    requireAll: editing?.require_all ?? false,
    minFollowers: editing?.min_followers ?? null,
    maxFollowers: editing?.max_followers ?? null,
    searchTerms: editing?.search_terms ?? [],
    requiresWebsite: editing?.requires_website ?? false,
    minReviews: editing?.min_reviews ?? null,
    places: editing?.places ?? [],
  };

  const perRule = new Map<string, number>();
  const buckets = new Map<string, number>();
  for (const b of matched ?? []) {
    const id = b.icp_id as string | null;
    if (id) perRule.set(id, (perRule.get(id) ?? 0) + 1);
    const key = String(b.icp_name);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  const sorted = (matched ?? []).length;
  const unsorted = Math.max(0, (total ?? 0) - sorted);
  // Rules that ask something of Instagram cannot answer for a business nobody has looked up.
  // Counting them is the honest version of "why did this rule not fire".
  const instagramRules = all.filter((r) => (r.instagram_any_of ?? []).length > 0 || r.min_followers || r.max_followers);
  const textMissing = Math.max(0, (withWebsite ?? 0) - (withSiteText ?? 0));

  return (
    <AppShell
      autoRefresh={false}
      current="icps"
      email={viewer?.email ?? null}
      signOutAction={signOut}
      title="ICPs"
      actions={
        canEdit ? (
          <Link href="/icps?add=1" className="btn" style={{ textDecoration: "none" }}>
            + Add an ICP
          </Link>
        ) : (
          <Link href="/records?view=everything" className="btn secondary" style={{ textDecoration: "none" }}>
            See how your leads were sorted
          </Link>
        )
      }
      what={
        <>
          Who you want to sell to. An ICP holds both halves of that: the words it is{" "}
          <strong>searched for</strong> on Google Maps, and the words and conditions that{" "}
          <strong>recognise</strong> one in your list — with a note saying which ICP decided and
          what word it matched.

        </>
      }
    >
      <>
        <StageStrip current="filtering" />
        {params.error && (
          <Banner tone="bad">{decodeURIComponent(params.error)}</Banner>
        )}
        {/* Saving redirected here with `saved=1` and nothing rendered it, so a successful save
            reloaded a page that looked identical and said nothing. There is no way to tell that
            apart from a save that failed — and the operator reasonably read it as one. */}
        {params.saved && (
          <div style={{ ...PANEL, padding: "13px 16px", borderColor: "var(--good)", fontSize: 15.5 }}>
            <strong>Saved.</strong> The rules table above shows it. Nothing is re-sorted until you
            press <strong>Apply</strong> — so change as many rules as you like first, then apply once.
          </div>
        )}
        {params.bought && (
          <Banner tone="good">{decodeURIComponent(params.bought)}</Banner>
        )}
        {params.applied && (
          <Banner tone="good">Re-sorting every business through these rules now. Refresh in a moment to see the counts
            move. It costs nothing.</Banner>
        )}


        {/* The operator asked, in these words: how do categories work, and where are they used?
            Answering it on the screen itself rather than in a reply means the answer is still here
            in three weeks. */}

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "18px 0" }}>
          <Fig value={all.length} label="ICPs you have written" tone="brand" />
          <Fig value={sorted} label="Businesses in an ICP" tone="good" />
          <Fig value={unsorted} label="In no ICP" tone={unsorted > 0 ? "warn" : "plain"} />
          <Fig value={new Set(all.map((r) => r.industry)).size} label="Industries covered" tone="social" />
        </div>

        {unsorted > 0 && all.length > 0 && (
          <div
            style={{
              ...PANEL,
              padding: "14px 18px",
              display: "flex",
              gap: 14,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16.5, fontWeight: 700 }}>
                {unsorted.toLocaleString()} businesses match no ICP
              </div>
              <div style={{ fontSize: 14.5, color: "var(--ink-2)" }}>
                They came from a search or a file, but none of your ICPs describe them. They are kept,
                not deleted.
              </div>
            </div>
            <Link href="/records?view=everything" className="btn-2 btn" style={{ marginLeft: "auto", textDecoration: "none" }}>
              Show them in Leads
            </Link>
          </div>
        )}

        {all.length === 0 && (
          <div style={{ ...PANEL, padding: "40px 24px", textAlign: "center" }}>
            <h3 style={{ fontSize: 20.5, margin: "0 0 8px" }}>No ICPs yet</h3>
            <p style={{ maxWidth: 560, margin: "0 auto 16px", fontSize: 15.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
              Start from a set written for printing and apparel — DTF, screen printing, embroidery,
              apparel brands, and one example that uses the website and Instagram together — then
              change them to suit what you sell. Nothing is applied until you press Apply.
            </p>
            {canEdit ? (
              <form action={addExampleRules}>
                <button className="btn" type="submit">
                  Start with five example ICPs
                </button>
              </form>
            ) : (
              <p style={{ fontSize: 14, color: "var(--ink-2)", margin: 0 }}>
                The administrator writes these for the whole team. Until one exists, every lead is reported as being in
                no ICP — which is a statement about the rules, not about the business.
              </p>
            )}
          </div>
        )}

        {all.length > 0 && (
          <Panel
            title="Your ICPs"
            hint="Checked from the top down. The first ICP that matches wins, so put the most specific ones first."
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
                <thead style={{ background: "var(--surface-2)" }}>
                  <tr>
                    <Th label="Order" width={70} />
                    <Th label="ICP" width={180} />
                    <Th label="Industry" width={120} />
                    <Th label="Searched on Google Maps" width={200} />
                    <Th label="Recognised by" />
                    <Th label="In it" width={80} />
                    <Th label="" width={120} />
                  </tr>
                </thead>
                <tbody>
                  {all.map((r) => (
                    <tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                      <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>{r.priority}</td>
                      <td style={TD}>
                        <strong>{r.name}</strong>
                        {!r.enabled && <div style={{ fontSize: 14.5, color: "var(--ink-3)" }}>turned off</div>}
                        {r.require_all && (
                          <div style={{ marginTop: 4 }}>
                            <Badge tone="warn">must match every box</Badge>
                          </div>
                        )}
                      </td>
                      <td style={TD}>{r.industry}</td>
                      <td style={{ ...TD, fontSize: 14.5 }}>
                        {(r.search_terms ?? []).length > 0 ? (
                          <span>{(r.search_terms as string[]).join(", ")}</span>
                        ) : (
                          <span style={{ color: "var(--ink-3)" }}>
                            never searched — only matched
                          </span>
                        )}
                      </td>
                      <td style={{ ...TD, fontSize: 14.5 }}>
                        <Group
                          icon="•"
                          tone="plain"
                          label="Anywhere"
                          terms={r.any_of ?? []}
                          suffix={
                            (r.sources ?? []).length === 0
                              ? undefined
                              : (r.sources as string[])
                                  .map((s) => ICP_SOURCE_LABELS[s as keyof typeof ICP_SOURCE_LABELS] ?? s)
                                  .join(", ")
                          }
                        />
                        <Group icon="🌐" tone="brand" label="On their website" terms={r.website_any_of ?? []} />
                        <Group icon="📸" tone="social" label="On their Instagram" terms={r.instagram_any_of ?? []} />
                        {(r.none_of ?? []).length > 0 && (
                          <div style={{ color: "var(--bad-ink)", marginTop: 2 }}>
                            ✕ never: {(r.none_of as string[]).join(", ")}
                          </div>
                        )}
                        {(r.min_followers || r.max_followers) && (
                          <div style={{ color: "var(--social-ink)", marginTop: 2 }}>
                            👥 followers {(r.min_followers ?? 0).toLocaleString()}–
                            {r.max_followers ? r.max_followers.toLocaleString() : "any"}
                          </div>
                        )}
                        {r.requires_website && (
                          <div style={{ color: "var(--ink-2)", marginTop: 2 }}>🌐 must have a working website</div>
                        )}
                        {r.min_reviews ? (
                          <div style={{ color: "var(--ink-2)", marginTop: 2 }}>⭐ {r.min_reviews}+ Google reviews</div>
                        ) : null}
                        {(r.places ?? []).length > 0 && (
                          <div style={{ color: "var(--ink-2)", marginTop: 2 }}>
                            📍 only in {(r.places as string[]).join(", ")}
                          </div>
                        )}
                      </td>
                      <td style={{ ...TD, fontVariantNumeric: "tabular-nums" }}>
                        {perRule.get(r.id) ? (
                          <Link href={`/records?view=everything&rule=${r.id}`}>{perRule.get(r.id)}</Link>
                        ) : (
                          <span style={{ color: "var(--ink-3)" }}>0</span>
                        )}
                      </td>
                      <td style={TD}>
                        {!canEdit ? (
                          <Link href={`/records?view=everything&rule=${r.id}`} style={{ fontSize: 15 }}>
                            See the leads
                          </Link>
                        ) : null}
                        <Link
                          href={`/icps?edit=${r.id}`}
                          style={{ fontSize: 15, marginRight: 10, display: canEdit ? undefined : "none" }}
                        >
                          Edit
                        </Link>
                        <form action={deleteRule} style={{ display: canEdit ? "inline" : "none" }}>
                          <input type="hidden" name="id" value={r.id} />
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
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "14px 18px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <form action={applyRules}>
                <button className="btn" type="submit">
                  Match every business again
                </button>
              </form>
              <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                Free. A business that no longer fits any ICP has it removed rather than keeping a
                stale one.
              </span>
            </div>
            {instagramRules.length > 0 && (withInstagram ?? 0) === 0 && (
              <Note tone="warn">
                {instagramRules.length} of these ask something about Instagram — a word in the bio, or
                a follower range — and <strong>no Instagram account has been looked up yet</strong>,
                so those rules cannot fire for anyone. They are not broken; there is nothing for them
                to read. Instagram data is bought per business from the Leads list.
              </Note>
            )}
          </Panel>
        )}


        {/* The gap that makes the website half of every ICP silent. Under the table rather than
            above it: it matters to the ICPs that read website words, and at the top it read as the
            headline of the whole page. */}
        {textMissing > 0 && (
          <div
            style={{
              ...PANEL,
              padding: "17px 19px",
              borderColor: "var(--warn)",
              background: "var(--warn-bg)",
            }}
          >
            <h3 style={{ margin: "0 0 7px", fontSize: 18 }}>
              ⚠ ICPs that look at <span style={{ color: "var(--brand)" }}>🌐 website</span> words have
              almost nothing to read yet
            </h3>
            <p style={{ margin: "0 0 10px", fontSize: 15.5, lineHeight: 1.6, maxWidth: 780 }}>
              The crawler keeps a short digest of what each site says, and rules match against it —
              but it only started keeping that digest recently.{" "}
              <strong>
                {textMissing.toLocaleString()} of your {(withWebsite ?? 0).toLocaleString()} businesses
                with a website were read before then
              </strong>
              , so for those a website rule can currently only see their web address, not a single
              word from their pages.
            </p>
            <p style={{ margin: "0 0 13px", fontSize: 15.5, lineHeight: 1.6, maxWidth: 780 }}>
              This is <strong>not</strong> what the &ldquo;Analyse them now&rdquo; button on the leads
              list fixes — that one looks for businesses nobody has ever analysed, and there are
              none. Re-reading is its own thing, and this is the button for it.
            </p>
            <form action={refreshWebsiteText} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="back" value="/icps" />
              <button className="btn" type="submit">
                Re-read {textMissing.toLocaleString()} websites — free
              </button>
              <span style={{ fontSize: 14.5, color: "var(--ink-2)" }}>
                Costs nothing. Takes a few minutes. Matches everyone against your ICPs again afterwards.
              </span>
            </form>
          </div>
        )}

        {/*
          The form is a panel over the page, and it is closed until asked for.

          Fixed rather than inline so the list stays exactly where it was: the operator presses Add
          on a row of ICPs and comes back to the same row, rather than to a page that has grown a
          form in the middle of it. The backdrop is a link back to /icps, which is what closes it —
          no JavaScript is involved in any of this, only the URL.
        */}
        {panelOpen && canEdit && (
          <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
            <Link
              href="/icps"
              aria-label="Close without saving"
              style={{ position: "absolute", inset: 0, background: "rgba(16, 20, 28, 0.45)" }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                right: 0,
                bottom: 0,
                width: "min(760px, 100%)",
                background: "var(--paper)",
                borderLeft: "2px solid var(--rule)",
                overflowY: "auto",
                padding: "20px 22px 60px",
                display: "grid",
                gap: 16,
                alignContent: "start",
                boxShadow: "0 0 60px -10px rgba(16, 20, 28, 0.45)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>
                    {editing ? `Edit “${editing.name}”` : "Add an ICP"}
                  </div>
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 3 }}>
                    Nothing is saved until you press the button at the bottom.
                  </div>
                </div>
                <Link href="/icps" className="btn-2 btn" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
                  ✕ Close
                </Link>
              </div>


        {/* Describe it in words and let the model pick the terms. Deliberately placed above the
            form rather than inside it: its output *is* the form below, filled in, so it reads as a
            step that happens first rather than as a field of the thing it fills. */}
        {canEdit ? (
        <Panel
          title="✨ Not sure what words to use? Describe it instead"
          hint="Write what kind of business you want in plain English or Roman Urdu. The model picks keywords from how businesses in your own list actually write, fills the form below, and shows you what it would catch — before anything is saved."
        >
          <form action={suggestRule} style={{ padding: "14px 18px" }}>
            <textarea
              name="description"
              rows={3}
              placeholder="e.g. mujhe wo log chahiye jo apna clothing brand chalate hain aur khud print bhi karte hain — wholesale supplier nahi"
              style={{ ...INPUT, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
            />
            <div style={{ marginTop: 11, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn" type="submit">
                Suggest a rule
              </button>
              <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>
                About a third of a cent. Nothing is saved — it fills the form and you edit it.
              </span>
            </div>
          </form>
        </Panel>
        ) : null}

        {aiUnderstood !== null && (
          <div style={{ ...PANEL, padding: "15px 18px", borderColor: "var(--info)", background: "var(--info-bg)" }}>
            <div style={{ fontSize: 14.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--info)" }}>
              What the model understood
            </div>
            <div style={{ fontSize: 16, marginTop: 5, lineHeight: 1.55 }}>{aiUnderstood}</div>
            <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 7 }}>
              If that is not what you meant, the rest of the suggestion is wrong too — rewrite the
              description and ask again rather than fixing the words by hand.
            </div>
          </div>
        )}

        {risky.length > 0 && (
          <div style={{ ...PANEL, padding: "15px 18px", borderColor: "var(--warn)", background: "var(--warn-bg)" }}>
            <strong style={{ fontSize: 16 }}>⚠ {risky.length} of these words look too broad</strong>
            <div style={{ marginTop: 7, display: "grid", gap: 5 }}>
              {risky.map((r) => (
                <div key={r.term} style={{ fontSize: 15 }}>
                  <strong>&ldquo;{r.term}&rdquo;</strong>{" "}
                  <span style={{ color: "var(--ink-2)" }}>— {r.why}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 8 }}>
              Checked mechanically, not by the model — a model asked to criticise its own answer
              usually agrees with itself. Look at the count below to see whether it actually matters.
            </div>
          </div>
        )}

        {!canEdit ? (
          <InfoBox title="You can read these, not change them" tone="info">
            The administrator writes the ICPs for the whole team, so one lead means the same thing to everybody. If an
            ICP is wrong for the leads you are working, say so — it is a two-minute change at their end.
          </InfoBox>
        ) : null}
        <SectionHeading
          title={editing ? `Edit “${editing.name}”` : "Write a rule"}
          hint="Three boxes. Fill in the ones you want the rule to ask about, and leave the rest empty."
        />

        {preview && <PreviewPanel preview={preview} name={form.name || "This rule"} />}

        <Panel title="" hint="">
          <form action={saveRule} style={{ padding: "16px 18px", display: "grid", gap: 18 }}>
            {/* Two names for the same id, and both are needed.
                `id` is what saveRule reads to decide update-or-create. `edit` is what this page
                reads to know which rule is being edited — and Preview is a GET submit of this very
                form, so without `edit` in it the round trip loses the rule: `params.edit` comes
                back undefined, `editing` becomes null, the `id` field stops being rendered, and the
                next press of Save quietly creates a second rule instead of updating the first.
                Which looks, from the operator's side, exactly like "it will not save". */}
            {editing && (
              <>
                <input type="hidden" name="id" value={editing.id} />
                <input type="hidden" name="edit" value={editing.id} />
              </>
            )}
            {/* Preview is a GET submit of this form, so without this the panel would close on the
                way back and the operator would lose a half-written ICP to the button meant to
                help them. */}
            {!editing && <input type="hidden" name="add" value="1" />}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
              <Field label="Name it" hint="For you, not the business">
                <input name="name" defaultValue={form.name} required style={INPUT} />
              </Field>
              <Field label="Industry" hint="e.g. Printing">
                <input name="industry" defaultValue={form.industry} required style={INPUT} />
              </Field>
              <Field label="Order" hint="Lower is checked first">
                <input name="priority" type="number" defaultValue={form.priority} style={INPUT} />
              </Field>
            </div>

            {/* The sourcing half. It takes no part in matching, which is why it is stated plainly
                rather than left to look like another word box. */}
            <Field
              label="Words to find them on Google Maps"
              hint="What you would type into Maps to find this kind of business — e.g. dtf transfers, embroidery shop. Find businesses runs all of them for this ICP. Separate with commas."
            >
              <input
                name="searchTerms"
                defaultValue={form.searchTerms.join(", ")}
                placeholder="dtf transfers, direct to film printing"
                style={INPUT}
              />
            </Field>

            {/* The three boxes. Separated visually as well as structurally, because the whole point
                is that they are questions about different things. */}
            <TargetBox
              icon="🌐"
              tone="brand"
              title="On their website, look for…"
              explain="Read from the pages we crawled and their web address. Free — every business with a working site already has this text."
            >
              <input
                name="websiteAnyOf"
                defaultValue={form.websiteAnyOf.join(", ")}
                placeholder="embroidery, screen print, gang sheet"
                style={INPUT}
              />
              <Reasons terms={form.websiteAnyOf} reasons={aiReasons} />
            </TargetBox>

            <TargetBox
              icon="📸"
              tone="social"
              title="On their Instagram, look for…"
              explain="Read from their bio, their username, and the category Instagram publishes for the account. Only works for businesses whose Instagram you have bought — a rule asking about Instagram stays silent for everyone else rather than counting them as a miss."
            >
              <input
                name="instagramAnyOf"
                defaultValue={form.instagramAnyOf.join(", ")}
                placeholder="clothing brand, apparel, streetwear"
                style={INPUT}
              />
              <Reasons terms={form.instagramAnyOf} reasons={aiReasons} />
            </TargetBox>

            <TargetBox
              icon="•"
              tone="plain"
              title="Anywhere, look for…"
              explain="The catch-all: their business name, website, Instagram and ad wording all at once. This is the box to use when you do not care where the word turns up."
            >
              <input
                name="anyOf"
                defaultValue={form.anyOf.join(", ")}
                placeholder="dtf, direct to film"
                style={INPUT}
              />
              <Reasons terms={form.anyOf} reasons={aiReasons} />
              <details style={{ marginTop: 10 }}>
                <summary style={{ fontSize: 14.5, color: "var(--ink-3)", cursor: "pointer" }}>
                  Narrow &ldquo;anywhere&rdquo; to particular places
                </summary>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
                  {ICP_SOURCES.map((s) => (
                    <label key={s} style={{ fontSize: 15, display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        name="sources"
                        value={s}
                        defaultChecked={form.sources.includes(s)}
                      />
                      {ICP_SOURCE_LABELS[s]}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 6 }}>
                  Tick none to look everywhere, which is usually what you want. This only affects the
                  &ldquo;anywhere&rdquo; box — the other two are already pinned to one side.
                </div>
              </details>
            </TargetBox>

            <div
              style={{
                border: "1px solid var(--warn)",
                background: "var(--warn-bg)",
                borderRadius: 6,
                padding: "13px 15px",
              }}
            >
              <label style={{ fontSize: 16, fontWeight: 600, display: "flex", gap: 9, alignItems: "flex-start" }}>
                <input type="checkbox" name="requireAll" defaultChecked={form.requireAll} style={{ marginTop: 3 }} />
                <span>
                  Must match <strong>every</strong> box I filled in
                  <div style={{ fontWeight: 400, fontSize: 14.5, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.55 }}>
                    This is how you tie a website to an Instagram account. Off, the rule fires when
                    any one box hits — &ldquo;embroidery on the site <em>or</em> a clothing brand on
                    Instagram&rdquo;. On, both have to be true of the same business, which is a much
                    smaller and much more useful set. Needs at least two boxes filled in.
                  </div>
                </span>
              </label>
            </div>

            <Field label="…but never these words" hint="Checked across everything this rule reads. e.g. equipment, repair, wholesale">
              <input name="noneOf" defaultValue={form.noneOf.join(", ")} style={INPUT} />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
              <Field label="Fewest followers" hint="Optional. Needs their Instagram bought first.">
                <input name="minFollowers" type="number" defaultValue={form.minFollowers ?? ""} style={INPUT} />
              </Field>
              <Field label="Most followers" hint="Optional">
                <input name="maxFollowers" type="number" defaultValue={form.maxFollowers ?? ""} style={INPUT} />
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
              <Field label="Fewest Google reviews" hint="Optional. Only counts businesses whose listing you have bought.">
                <input name="minReviews" type="number" defaultValue={form.minReviews ?? ""} style={INPUT} />
              </Field>
              <Field label="Only in these places" hint="Optional. Towns or states, separated by commas. Empty means anywhere.">
                <input name="places" defaultValue={form.places.join(", ")} placeholder="Texas, Miami" style={INPUT} />
              </Field>
            </div>

            <label style={{ fontSize: 15.5, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" name="requiresWebsite" defaultChecked={form.requiresWebsite} style={{ marginTop: 4 }} />
              <span>
                They must have a working website
                <span style={{ display: "block", fontSize: 14.5, color: "var(--ink-3)" }}>
                  A business whose site could not be reached is left out rather than guessed at.
                </span>
              </span>
            </label>

            {/*
              Budget and revenue: shown, switched off, and saying why on hover.

              The operator asked for exactly this rather than for the fields to be hidden — a field
              that is missing looks like something nobody thought of, and one that is greyed out
              with a reason looks like a decision. Nobody publishes what a small private business
              earns or spends, so there is nothing to fill these with today.
            */}
            <fieldset
              disabled
              style={{
                border: "1.5px dashed var(--rule-2)",
                borderRadius: 10,
                padding: "12px 14px 14px",
                background: "var(--surface-2)",
                margin: 0,
              }}
            >
              <legend style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-3)", padding: "0 6px" }}>
                Money — not available yet
              </legend>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
                <div
                  data-tip="Switched off: no provider publishes what a small business spends, and nothing on their own website says it. Filling this in would be inventing the number."
                  tabIndex={0}
                >
                  <Field label="Budget range" hint="Hover to see why this is off">
                    <input placeholder="$500 – $5,000 a month" style={{ ...INPUT, color: "var(--ink-3)" }} readOnly />
                  </Field>
                </div>
                <div
                  data-tip="Switched off: revenue for small private businesses is not published anywhere. It can be bought per business from a data provider later, and the price will be shown before anything is spent."
                  tabIndex={0}
                >
                  <Field label="Approximate revenue" hint="Hover to see why this is off">
                    <input placeholder="$1M – $5M a year" style={{ ...INPUT, color: "var(--ink-3)" }} readOnly />
                  </Field>
                </div>
              </div>
            </fieldset>

            <label style={{ fontSize: 15.5, display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="enabled" defaultChecked={editing ? editing.enabled : true} />
              Use this ICP
            </label>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              {/* Preview first, deliberately. It is the cheaper of the two and the one that stops a
                  bad rule reaching the list — putting Save first would make the safe button the
                  one nobody notices. `formMethod="get"` reloads this page with every field in the
                  query string, which is how a no-JavaScript app previews anything. */}
              <button className="btn-2 btn" type="submit" formMethod="get" formAction="/icps" name="preview" value="1">
                Preview — what would this catch?
              </button>
              <button className="btn" type="submit">
                {editing ? "Save changes" : "Save this ICP"}
              </button>
              <Link href="/icps" style={{ fontSize: 15.5 }}>
                Cancel
              </Link>
              <span style={{ fontSize: 14.5, color: "var(--ink-3)", flexBasis: "100%" }}>
                Preview saves nothing and costs nothing — it matches your draft against all{" "}
                {(total ?? 0).toLocaleString()} businesses and shows you what it would take.
              </span>
            </div>
          </form>
          <Note>
            A follower range only matches businesses whose Instagram you have already bought — a rule
            saying &ldquo;at least 5,000 followers&rdquo; will never fire on a business whose follower
            count nobody has looked up, rather than treating unknown as zero.
          </Note>
        </Panel>
            </div>
          </div>
        )}



        {/* Reference, not work. Moved to the bottom because these two answered questions the
            operator asked once, and while they sat at the top every visit began by scrolling
            past them to reach the rules. */}
        <SectionHeading title="How this works" hint="Open these if you need them; they are here for reference, not for every visit." />
        <details style={{ marginBottom: 14 }}>
          <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 600, padding: "6px 0" }}>
            📖 What an ICP is, and where it shows up
          </summary>
          <InfoBox tone="social">
          <p style={{ margin: "0 0 10px" }}>
            An ICP is <strong>your</strong> description of a customer you want — not
            Instagram&rsquo;s category and not Google&rsquo;s. Instagram gives an account one word
            — &ldquo;Clothing brand&rdquo;, &ldquo;Local business&rdquo; — and no second level, and
            Google&rsquo;s is just as blunt. Neither can tell you the thing you sell against:{" "}
            <em>this one prints DTF transfers, that one embroiders caps, that one is a brand who buys
            printing.</em> So you write it down once, and it does two jobs: Find businesses searches
            Google Maps with its words, and every business in the list is matched against it.
          </p>
          <p style={{ margin: "0 0 10px" }}>
            <strong>Nothing is guessed.</strong> A rule fires because a word you wrote was found in
            text the system already holds, or a condition you set was met. The record then shows
            the ICP and the word, so an answer you disagree with can be traced to the line that
            caused it and fixed in one edit.
          </p>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            <Where
              where="On the Leads list"
              how="An ICP column, and ICP as the first filter menu — “show me only the D2C brands”, then call those."
            />
            <Where
              where="On the Dashboard"
              how="A breakdown of how your list splits, so you can see which kind of business you actually have most of."
            />
            <Where
              where="On the Instagram screen"
              how="Your ICP shown next to Instagram’s own category, which is how you tell whether Instagram’s label is any use."
            />
            <Where
              where="In the CSV you download"
              how="The ICP is a column, so a list you hand to someone else carries your sorting with it."
            />
            <Where
              where="Find businesses"
              how="Pick an ICP and every word in it is searched on Google Maps, one run each."
            />
            <Where
              where="Deciding what to import"
              how="An import can be told to sort its rows as soon as they arrive, so a new file lands already labelled."
            />
          </div>
          <p style={{ margin: "12px 0 0" }}>
            Matching is <strong>free and repeatable</strong>. It reads what is already stored — no
            crawl, no provider, no cost — so edit an ICP, match again, look, edit again.
          </p>
          </InfoBox>
        </details>

        {/* The question the screen could not previously answer: does this run by itself, or do I
            have to remember to? Both, and it matters which is which. */}
        <details style={{ marginBottom: 18 }}>
          <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 600, padding: "6px 0" }}>
            ⏱ When does the matching actually happen?
          </summary>
          <InfoBox tone="brand">
          <p style={{ margin: "0 0 10px" }}>
            <strong>Automatically, three times</strong> — you do not have to remember:
          </p>
          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            <Where where="After you import a file" how="If “Match them to my ICPs” was ticked on the import — it is ticked by default. Runs after their websites are read, never before." />
            <Where where="After a Find-businesses search" how="Every business the search brought in is matched once it has been crawled and scored." />
            <Where where="After “Analyse them now”" how="Analysing from the leads list matches them too, so a business is never left analysed but without an ICP." />
          </div>
          <p style={{ margin: "0 0 10px" }}>
            <strong>By hand, whenever you change an ICP.</strong> That is what the Match every
            business again button is for. Editing an ICP does not re-match anything on its own — you
            might be writing three in a row, and having the whole list shift under each one would
            make them impossible to write.
          </p>
          <div
            style={{
              padding: "11px 13px",
              background: "var(--warn-bg)",
              borderRadius: 5,
              fontSize: 15,
              lineHeight: 1.6,
            }}
          >
            <strong>One thing worth being clear about:</strong> matching <em>labels</em>, it does
            not <em>fetch</em>, and it does not <em>exclude</em>. Everything in a file is imported and
            everything a search finds is kept — the ICP is a label added afterwards so you can
            filter. And matching cannot go and get anything: it only reads what is already here.
            That is why an ICP that asks about Instagram or reviews stays silent until that data is
            bought — there is nothing for it to read yet.
          </div>
          </InfoBox>
        </details>
      </>
    </AppShell>
  );
}

/**
 * What the draft rule would catch, shown before it is saved.
 *
 * The number is the point. A rule containing "shop" takes 187 of 330 businesses, and no amount of
 * reasoning about the word conveys that the way the figure does — which is why this is the answer
 * to "what if a wrong word gets in", rather than being careful about the words.
 *
 * The share is judged rather than merely displayed. An operator who does not yet know what a normal
 * proportion looks like will read "187" as a large number without knowing it is *too* large, and
 * the whole value of the check evaporates.
 */
function PreviewPanel({ preview, name }: { preview: RulePreview; name: string }) {
  if (preview.impossible) {
    return (
      <div style={{ ...PANEL, padding: "16px 18px", borderColor: "var(--warn)", background: "var(--warn-bg)" }}>
        <strong style={{ fontSize: 16.5 }}>This rule cannot match anything yet</strong>
        <div style={{ fontSize: 15.5, color: "var(--ink-2)", marginTop: 5 }}>{preview.impossible}</div>
      </div>
    );
  }

  const share = preview.outOf > 0 ? preview.total / preview.outOf : 0;
  const tone = preview.total === 0 ? "warn" : share > 0.4 ? "bad" : share > 0.2 ? "warn" : "good";
  const verdict =
    preview.total === 0
      ? "Nothing matched. Either the words are not in your data, or the source they look at has not been fetched yet — a website box needs the page text, and an Instagram box needs that account bought."
      : share > 0.4
        ? `That is ${Math.round(share * 100)}% of everything you have. A rule that takes nearly half the list is almost always one common word doing all the work — check what matched below.`
        : share > 0.2
          ? `That is ${Math.round(share * 100)}% of your list. Worth glancing at what matched to be sure the words are as specific as you meant.`
          : "That looks like a specific rule.";

  return (
    <div style={{ ...PANEL, padding: 0, borderColor: `var(--${tone})`, overflow: "hidden" }}>
      <div style={{ background: `var(--${tone}-bg)`, padding: "15px 18px" }}>
        <div style={{ fontSize: 18.5, fontWeight: 700 }}>
          {name} would catch{" "}
          <span style={{ color: `var(--${tone})` }}>
            {preview.total.toLocaleString()} of {preview.outOf.toLocaleString()}
          </span>{" "}
          businesses
        </div>
        <div style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 4, lineHeight: 1.55 }}>{verdict}</div>
        <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 6 }}>
          Nothing has been saved. This is your draft matched against your real data.
        </div>
      </div>

      {preview.stolenFrom.length > 0 && (
        <div style={{ ...TD, background: "var(--surface-2)", fontSize: 15 }}>
          <strong>It would take these from rules you already have:</strong>{" "}
          {preview.stolenFrom.map((s) => `${s.count} from “${s.ruleName}”`).join(", ")}. Whether that
          happens depends on the Order number — lower wins.
        </div>
      )}

      {preview.matched.length > 0 && (
        <div>
          {preview.matched.map((m) => (
            <div key={m.id} style={{ display: "flex", gap: 12, alignItems: "baseline", ...TD }}>
              <Link href={`/records/${m.id}`} style={{ flex: "1 1 220px", fontWeight: 600 }}>
                {m.name}
              </Link>
              <span style={{ flex: "1 1 260px", fontSize: 14.5, color: "var(--ink-3)" }}>
                matched <strong style={{ color: "var(--ink-2)" }}>&ldquo;{m.term}&rdquo;</strong> in{" "}
                {ICP_SOURCE_LABELS[m.where as keyof typeof ICP_SOURCE_LABELS] ?? m.where}
              </span>
            </div>
          ))}
          {preview.total > preview.matched.length && (
            <Note>…and {(preview.total - preview.matched.length).toLocaleString()} more.</Note>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Why each suggested word is in the box, one line each.
 *
 * The model is required to justify every term it proposes, and this is where that lands. Without it
 * an operator inherits a word list they cannot maintain — the whole reason a hand-written rule is
 * trustworthy is that its author remembers why each word is there.
 */
function Reasons({ terms, reasons }: { terms: string[]; reasons: Record<string, string> }) {
  const explained = terms.filter((t) => reasons[t]);
  if (explained.length === 0) return null;
  return (
    <div style={{ marginTop: 9, display: "grid", gap: 4 }}>
      {explained.map((t) => (
        <div key={t} style={{ fontSize: 14.5, color: "var(--ink-3)", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--ink-2)" }}>{t}</strong> — {reasons[t]}
        </div>
      ))}
    </div>
  );
}

/** One "where an ICP shows up" line. */
function Where({ where, how }: { where: string; how: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
      <strong style={{ flex: "0 0 190px", fontSize: 15 }}>{where}</strong>
      <span style={{ flex: 1, minWidth: 240, fontSize: 15, color: "var(--ink-2)" }}>{how}</span>
    </div>
  );
}

/** One of the three labelled term boxes in the rule form. */
function TargetBox({
  icon,
  tone,
  title,
  explain,
  children,
}: {
  icon: string;
  tone: "brand" | "social" | "plain";
  title: string;
  explain: string;
  children: React.ReactNode;
}) {
  const border = tone === "plain" ? "var(--rule-2)" : `var(--${tone})`;
  const bg = tone === "plain" ? "var(--surface-2)" : `var(--${tone}-bg)`;
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden" }}>
      <div style={{ background: bg, padding: "10px 14px" }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          <span style={{ marginRight: 7 }}>{icon}</span>
          {title}
        </div>
        <div style={{ fontSize: 14.5, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.5 }}>{explain}</div>
      </div>
      <div style={{ padding: "12px 14px" }}>{children}</div>
    </div>
  );
}

/** One group's terms in the rules table, or nothing when the group is empty. */
function Group({
  icon,
  tone,
  label,
  terms,
  suffix,
}: {
  icon: string;
  tone: "brand" | "social" | "plain";
  label: string;
  terms: string[];
  suffix?: string;
}) {
  if (terms.length === 0) return null;
  return (
    <div style={{ marginBottom: 2 }}>
      <span style={{ color: tone === "plain" ? "var(--ink-3)" : `var(--${tone}-ink)`, fontWeight: 600 }}>
        {icon} {label}:
      </span>{" "}
      {terms.join(", ")}
      {suffix ? <span style={{ color: "var(--ink-3)" }}> (only in: {suffix})</span> : null}
    </div>
  );
}

function Fig({ value, label, tone }: { value: number; label: string; tone: "brand" | "good" | "warn" | "social" | "plain" }) {
  const colour = tone === "plain" ? "var(--ink)" : `var(--${tone})`;
  return (
    <div style={{ ...PANEL, marginBottom: 0, padding: "14px 16px", flex: "1 1 170px", minWidth: 160 }}>
      <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: colour, fontVariantNumeric: "tabular-nums" }}>
        {value.toLocaleString()}
      </div>
      <div style={{ fontSize: 14.5, fontWeight: 600, color: "var(--ink-2)", marginTop: 3 }}>{label}</div>
    </div>
  );
}

const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "9px 11px",
  fontSize: 16,
  border: "1px solid var(--rule-2)",
  borderRadius: 3,
  background: "var(--surface)",
  color: "var(--ink)",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 15, fontWeight: 600, marginBottom: 3 }}>{label}</span>
      {hint ? <span style={{ display: "block", fontSize: 14.5, color: "var(--ink-3)", marginBottom: 5 }}>{hint}</span> : null}
      {children}
    </label>
  );
}
