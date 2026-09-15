import {
  CHECKABLE_FIELDS,
  PAGE_TYPES,
  PAGE_TYPE_LABELS,
  TESTS,
  TEST_LABELS,
  runChecklist,
  type ChecklistRule,
  type PageStructure,
  type PageType,
} from "@lead-intel/core";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { AppShell, Badge, Banner, InfoBox, Note, PANEL, Panel, SectionHeading, TD, Th, StageStrip } from "../ui";
import { addExampleChecklists, deleteChecklistRule, saveChecklistRule } from "./actions";

/**
 * Where the operator writes down what a good page looks like.
 *
 * Built to the same shape as an ICP, because the risk is the same one: a rule that
 * sounds sensible and fires on almost everything is not a finding, it is a badly written rule. So
 * this screen shows, for every rule, **how many audited pages currently fail it** — and for a draft,
 * before it is saved.
 */

interface Params {
  edit?: string;
  /** "1" while the panel is open on a new rule. Editing carries `edit` instead. */
  add?: string;
  error?: string;
  saved?: string;
  preview?: string;
  name?: string;
  pageType?: string;
  industry?: string;
  field?: string;
  test?: string;
  value?: string;
  weight?: string;
  says?: string;
}

export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  const [{ data: rules }, { data: audits }, { data: categories }] = await Promise.all([
    supabase.from("page_checklists").select("*").order("page_type").order("name"),
    // Every audited page, with the industry of the business's ICP — the corpus a rule is measured on.
    supabase.from("page_audits").select("url, page_type, structure, layout, business_id").limit(5000),
    supabase.from("businesses").select("id, icps(industry)").eq("status", "active").limit(5000),
  ]);

  const industryOf = new Map(
    (categories ?? []).map((b) => [
      b.id as string,
      ((b as { icps?: { industry?: string } | null }).icps?.industry ?? null) as string | null,
    ]),
  );
  const pages = (audits ?? []).map((a) => ({
    pageType: a.page_type as PageType,
    industry: industryOf.get(a.business_id as string) ?? null,
    structure: (a.structure ?? null) as PageStructure | null,
    layout: (a.layout ?? null) as Record<string, unknown> | null,
  }));

  const all = (rules ?? []).map(toRule);
  const editing = params.edit ? all.find((r) => r.id === params.edit) : null;

  /** How many audited pages a rule fails, passes, and cannot be judged on. */
  function measure(rule: ChecklistRule) {
    let failed = 0;
    let passed = 0;
    let unknown = 0;
    let applied = 0;
    for (const page of pages) {
      const [result] = runChecklist([rule], page);
      if (!result) continue;
      applied += 1;
      if (result.outcome === "failed") failed += 1;
      else if (result.outcome === "passed") passed += 1;
      else unknown += 1;
    }
    return { failed, passed, unknown, applied };
  }

  // A draft arrived from the Preview button, carried in the query string exactly as the category
  // editor does it. Nothing is written; the form is refilled and the rule is measured.
  const draft: ChecklistRule | null = params.preview
    ? {
        id: params.edit ?? "draft",
        name: params.name || "This rule",
        pageType: (params.pageType || null) as PageType | null,
        industry: params.industry || null,
        field: params.field ?? "",
        test: (params.test ?? "present") as ChecklistRule["test"],
        value: params.value ? Number(params.value) : null,
        weight: Number(params.weight ?? 10) || 10,
        enabled: true,
        says: params.says ?? "",
      }
    : null;

  const draftMeasure = draft && CHECKABLE_FIELDS.some((f) => f.id === draft.field) ? measure(draft) : null;
  const form = draft ?? editing;

  /**
   * The form is a panel, closed until asked for — the same rule the ICPs screen follows.
   *
   * A form sitting open on a page is a question nobody asked. This one opens on + Add a rule, on
   * Edit, and on the way back from Preview, because all three are states this page can be in
   * without any JavaScript: each is a URL.
   */
  const panelOpen = params.add === "1" || Boolean(params.edit) || Boolean(params.preview);

  return (
    <AppShell
      autoRefresh={false}
      current="checklists"
      email={typeof claims?.email === "string" ? claims.email : null}
      signOutAction={signOut}
      title="Checklists"
      actions={
        <Link href="/checklists?add=1" className="btn" style={{ textDecoration: "none" }}>
          + Add a rule
        </Link>
      }
      what={
        <>
          What a good page looks like, in your words. Every rule is checked against the pages already
          audited — <strong>so you can see what it would catch before you save it</strong>.
        </>
      }
    >
      <>
        <StageStrip current="analysis" />
        {params.error && <Banner tone="bad">{decodeURIComponent(params.error)}</Banner>}
        {params.saved && (
          <Banner tone="good">
            Saved. Every scorecard uses it immediately &mdash; verdicts are worked out when you open
            a record, so there is nothing to re-run.
          </Banner>
        )}

        {pages.length === 0 && (
          <Banner tone="warn">
            No website has been audited yet, so these rules have nothing to be measured against. The
            counts below will stay at zero until the page-by-page audit has run.
          </Banner>
        )}

        {all.length === 0 && (
          <div style={{ ...PANEL, padding: "40px 24px", textAlign: "center" }}>
            <h3 style={{ fontSize: 20.5, margin: "0 0 8px" }}>No rules yet</h3>
            <p style={{ maxWidth: 560, margin: "0 auto 16px", fontSize: 15.5, color: "var(--ink-3)", lineHeight: 1.55 }}>
              Start from twelve written for printing and apparel. Four apply to any page on any site,
              five to particular kinds of page, and three assume your trade &mdash; those are the ones
              to rewrite first if you move into another.
            </p>
            <form action={addExampleChecklists}>
              <button className="btn" type="submit">
                Start with twelve rules
              </button>
            </form>
          </div>
        )}

        {all.length > 0 && (
          <Panel
            title={`${all.length} rules`}
            hint={`Measured against ${pages.length} audited pages. A rule failing almost everything is usually a rule, not a finding.`}
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead style={{ background: "var(--surface-2)" }}>
                  <tr>
                    <Th label="Rule" width={230} />
                    <Th label="Applies to" width={190} />
                    <Th label="Checks that" />
                    <Th label="Failing" explain="Of the pages it applies to" width={130} />
                    <Th label="" width={110} />
                  </tr>
                </thead>
                <tbody>
                  {all.map((rule) => {
                    const m = measure(rule);
                    const share = m.applied > 0 ? m.failed / m.applied : 0;
                    const field = CHECKABLE_FIELDS.find((f) => f.id === rule.field);
                    return (
                      <tr key={rule.id} style={{ opacity: rule.enabled ? 1 : 0.5 }}>
                        <td style={TD}>
                          <strong>{rule.name}</strong>
                          <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 2 }}>weight {rule.weight}</div>
                          {!rule.enabled && <Badge tone="plain">turned off</Badge>}
                        </td>
                        <td style={{ ...TD, fontSize: 15 }}>
                          {rule.pageType ? PAGE_TYPE_LABELS[rule.pageType] : "Any page"}
                          <div style={{ color: "var(--ink-3)", fontSize: 14.5 }}>
                            {rule.industry ?? "any industry"}
                          </div>
                        </td>
                        <td style={{ ...TD, fontSize: 15 }}>
                          {field?.label ?? rule.field} <em style={{ color: "var(--ink-3)" }}>{TEST_LABELS[rule.test]}</em>
                          {rule.value !== null ? ` ${rule.value}` : ""}
                        </td>
                        <td style={TD}>
                          {m.applied === 0 ? (
                            <span style={{ color: "var(--ink-3)", fontSize: 14.5 }}>no pages yet</span>
                          ) : (
                            <>
                              <strong
                                style={{
                                  fontVariantNumeric: "tabular-nums",
                                  color: share > 0.8 ? "var(--bad)" : share > 0.5 ? "var(--warn)" : "var(--ink)",
                                }}
                              >
                                {m.failed} / {m.applied}
                              </strong>
                              {m.unknown > 0 && (
                                <div style={{ fontSize: 14, color: "var(--ink-3)" }}>
                                  {m.unknown} not checkable
                                </div>
                              )}
                            </>
                          )}
                        </td>
                        <td style={TD}>
                          <Link href={`/checklists?edit=${rule.id}`} style={{ fontSize: 15, marginRight: 10 }}>
                            Edit
                          </Link>
                          <form action={deleteChecklistRule} style={{ display: "inline" }}>
                            <input type="hidden" name="id" value={rule.id} />
                            <button
                              type="submit"
                              style={{ background: "none", border: 0, color: "var(--bad)", fontSize: 15, cursor: "pointer", padding: 0 }}
                            >
                              Delete
                            </button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {panelOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 60 }}>
            <Link
              href="/checklists"
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
                    {editing ? `Edit “${editing.name}”` : "Add a rule"}
                  </div>
                  <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 3 }}>
                    Nothing is saved until you press the button at the bottom.
                  </div>
                </div>
                <Link href="/checklists" className="btn-2 btn" style={{ textDecoration: "none", whiteSpace: "nowrap" }}>
                  ✕ Close
                </Link>
              </div>

        <SectionHeading
          title={editing ? `Edit “${editing.name}”` : "Write a rule"}
          hint="Pick something the system measures, say what it should be, and write the sentence you would say on a call."
        />

        {draftMeasure && (
          <div
            style={{
              ...PANEL,
              padding: "15px 18px",
              borderColor: draftMeasure.failed / Math.max(1, draftMeasure.applied) > 0.8 ? "var(--bad)" : "var(--good)",
            }}
          >
            <strong style={{ fontSize: 17.5 }}>
              This rule would flag {draftMeasure.failed} of the {draftMeasure.applied} pages it applies to
            </strong>
            <div style={{ fontSize: 15.5, color: "var(--ink-2)", marginTop: 5, lineHeight: 1.55 }}>
              {draftMeasure.applied === 0
                ? "It applies to no audited page yet, so there is nothing to check it against."
                : draftMeasure.failed / draftMeasure.applied > 0.8
                  ? "Nearly everything fails it. That is usually a rule set too strictly rather than a fault every business shares — and a finding on every record is a finding nobody reads."
                  : draftMeasure.failed === 0
                    ? "Nothing fails it. Either every page is already fine on this, or the rule cannot catch what you meant."
                    : "That looks like a rule that separates good pages from bad ones."}
              {draftMeasure.unknown > 0 && ` ${draftMeasure.unknown} pages could not be checked at all.`}
            </div>
            <div style={{ fontSize: 14, color: "var(--ink-3)", marginTop: 7 }}>Nothing has been saved.</div>
          </div>
        )}

        <Panel title="" hint="">
          <form action={saveChecklistRule} style={{ padding: "16px 18px", display: "grid", gap: 16 }}>
            {editing && <input type="hidden" name="id" value={editing.id} />}
            {editing && <input type="hidden" name="edit" value={editing.id} />}
            {/* Preview is a GET submit of this form; without this the panel would close on the way
                back and take a half-written rule with it. */}
            {!editing && <input type="hidden" name="add" value="1" />}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
              <Field label="Name it" hint="For you, in the rules table">
                <input name="name" defaultValue={form?.name ?? ""} required style={INPUT} />
              </Field>
              <Field label="Which pages" hint="Leave as Any for a universal rule">
                <select name="pageType" defaultValue={form?.pageType ?? ""} style={INPUT}>
                  <option value="">Any page</option>
                  {PAGE_TYPES.filter((t) => t !== "other").map((t) => (
                    <option key={t} value={t}>
                      {PAGE_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Which industry" hint="Blank means every industry — where universal rules live">
                <input name="industry" defaultValue={form?.industry ?? ""} placeholder="e.g. Printing" style={INPUT} />
              </Field>
              <Field label="Weight" hint="How much it matters, 1–50">
                <input name="weight" type="number" defaultValue={form?.weight ?? 10} style={INPUT} />
              </Field>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
              <Field label="Check that" hint="Only things the system actually measures">
                <select name="field" defaultValue={form?.field ?? "header.phone"} style={INPUT}>
                  {CHECKABLE_FIELDS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="…and that it" hint="">
                <select name="test" defaultValue={form?.test ?? "present"} style={INPUT}>
                  {TESTS.map((t) => (
                    <option key={t} value={t}>
                      {TEST_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Number" hint="Only for is at least / at most / exactly">
                <input name="value" type="number" defaultValue={form?.value ?? ""} style={INPUT} />
              </Field>
            </div>

            <Field
              label="What to say when it fails"
              hint="The operator reads this, and may repeat it on a call. Write it as a plain sentence about the business, not about the rule."
            >
              <textarea
                name="says"
                rows={2}
                defaultValue={form?.says ?? ""}
                required
                placeholder="There is no tap-to-call number in the header, so a visitor who wants to ring has to go looking."
                style={{ ...INPUT, resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
              />
            </Field>

            <label style={{ fontSize: 15.5, display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" name="enabled" defaultChecked={form ? form.enabled : true} />
              Use this rule
            </label>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn-2 btn" type="submit" formMethod="get" formAction="/checklists" name="preview" value="1">
                Preview — what would this flag?
              </button>
              <button className="btn" type="submit">
                {editing ? "Save changes" : "Save this rule"}
              </button>
              {(editing || draft) && (
                <Link href="/checklists" style={{ fontSize: 15.5 }}>
                  Start a fresh rule
                </Link>
              )}
            </div>
          </form>
          <Note>
            A rule can also answer <strong>&ldquo;I do not know&rdquo;</strong>. If a page never
            rendered, a rule about its layout is reported as not checkable rather than failed &mdash;
            the scorecard says so, and the score is worked out only from what was actually judged.
          </Note>
        </Panel>
            </div>
          </div>
        )}

        <details style={{ marginTop: 20 }}>
          <summary style={{ cursor: "pointer", fontSize: 16, fontWeight: 600, padding: "6px 0" }}>
            📖 Everything a rule can check
          </summary>
          <InfoBox tone="info">
            <p style={{ margin: "0 0 10px" }}>
              This list is closed on purpose. A rule that could name anything would let a typo save
              cleanly and then never fire, silently, for ever. It grows when the audit learns to
              measure something new.
            </p>
            <div style={{ display: "grid", gap: 6 }}>
              {CHECKABLE_FIELDS.map((f) => (
                <div key={f.id} style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 15 }}>
                  <strong style={{ flex: "0 0 230px" }}>{f.label}</strong>
                  <span style={{ flex: 1, minWidth: 220, color: "var(--ink-2)" }}>
                    {f.hint}
                    {f.source === "layout" && (
                      <em style={{ color: "var(--ink-3)" }}> Needs the page to have rendered.</em>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </InfoBox>
        </details>
      </>
    </AppShell>
  );
}

function toRule(row: Record<string, unknown>): ChecklistRule {
  return {
    id: row.id as string,
    name: row.name as string,
    pageType: (row.page_type ?? null) as PageType | null,
    industry: (row.industry ?? null) as string | null,
    field: row.field as string,
    test: row.test as ChecklistRule["test"],
    value: (row.value ?? null) as number | null,
    weight: row.weight as number,
    enabled: row.enabled as boolean,
    says: row.says as string,
  };
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
