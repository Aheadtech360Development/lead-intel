import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const sectionStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--rule)",
  borderRadius: 3,
  marginBottom: 20,
};
const sectionHeadStyle: React.CSSProperties = {
  padding: "12px 20px",
  borderBottom: "1px solid var(--rule)",
  background: "var(--surface-2)",
  fontSize: 14.5,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--ink-2)",
  fontWeight: 700,
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: 16,
  padding: "11px 20px",
  borderBottom: "1px solid var(--rule)",
  fontSize: 16,
};
const keyStyle: React.CSSProperties = { flex: "0 0 200px", color: "var(--ink-3)" };

interface RunCounters {
  cellsPending?: number;
  cellsDone?: number;
  cellsSaturated?: number;
  cellsFailed?: number;
  businessesFound?: number;
  businessesExcluded?: number;
}
interface RunSpend {
  totalCents?: number;
  providerCallCount?: number;
}

export default async function RunStatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ partial?: string; of?: string; started?: string }>;
}) {
  const { id } = await params;
  const { partial, of, started } = await searchParams;
  const supabase = await createClient();

  const { data: run } = await supabase.from("runs").select("*").eq("id", id).maybeSingle();
  if (!run) notFound();

  const counters = (run.counters ?? {}) as RunCounters;
  const spend = (run.spend ?? {}) as RunSpend;
  const errors = run.errors as Record<string, string> | null;

  return (
    <main style={{ padding: 24, maxWidth: 780, margin: "0 auto" }}>
      <p style={{ marginBottom: 4 }}>
        <Link href="/search">&larr; New search</Link>
      </p>

      {/* Searching an ICP starts one run per word, and some of them can fail to start while others
          run. Saying so here — on the run they were sent to — is the only place the operator would
          otherwise have no way of knowing a word was missed. */}
      {partial && (
        <div
          style={{
            padding: "12px 16px",
            marginBottom: 16,
            background: "var(--warn-bg)",
            border: "1px solid #d3ac71",
            borderRadius: 3,
            color: "var(--warn-ink)",
            fontSize: 15.5,
          }}
        >
          <strong>
            {started ?? "Some"} of {of ?? "the"} searches started.
          </strong>{" "}
          The rest did not: {decodeURIComponent(partial)} Nothing was charged for the ones that never
          started, and the ones running are unaffected.
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 31, margin: "0 0 6px" }}>
            {run.niche} near {run.location}
          </h1>
          <p style={{ margin: 0, color: "var(--ink-3)", fontSize: 16 }}>
            {run.radius_miles} mile radius · status: <strong>{run.status}</strong>
          </p>
        </div>
        <a href={`/search/runs/${id}`} className="btn-2 btn" style={{ marginLeft: "auto", textDecoration: "none" }}>
          Refresh
        </a>
      </div>

      {run.status === "planning" && (
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
          Still "planning" — this usually means Trigger.dev isn't configured yet
          (TRIGGER_SECRET_KEY missing, or the project doesn't exist). See SETUP.md's Phase 3
          section, then refresh this page after starting <code>npx trigger dev</code>.
        </div>
      )}

      {errors && Object.keys(errors).length > 0 && (
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
          {Object.entries(errors).map(([k, v]) => (
            <div key={k}>
              {k}: {v}
            </div>
          ))}
        </div>
      )}

      <section style={sectionStyle}>
        <div style={sectionHeadStyle}>Grid progress</div>
        <div style={rowStyle}>
          <span style={keyStyle}>Cells done</span>
          <span>{counters.cellsDone ?? 0}</span>
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Cells pending</span>
          <span>{counters.cellsPending ?? 0}</span>
        </div>
        <div style={rowStyle}>
          <span style={keyStyle}>Cells saturated</span>
          <span>
            {counters.cellsSaturated ?? 0}
            {(counters.cellsSaturated ?? 0) > 0 && (
              <span style={{ color: "var(--ink-3)", fontSize: 14.5 }}> — hit the 60-result cap; subdivided where the depth limit allowed</span>
            )}
          </span>
        </div>
        <div style={{ ...rowStyle, borderBottom: "none" }}>
          <span style={keyStyle}>Cells failed</span>
          <span>{counters.cellsFailed ?? 0}</span>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeadStyle}>Businesses</div>
        <div style={rowStyle}>
          <span style={keyStyle}>Found</span>
          <span>{counters.businessesFound ?? 0}</span>
        </div>
        <div style={{ ...rowStyle, borderBottom: "none" }}>
          <span style={keyStyle}>Excluded (existing client / do-not-contact)</span>
          <span>{counters.businessesExcluded ?? 0}</span>
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={sectionHeadStyle}>Spend</div>
        <div style={rowStyle}>
          <span style={keyStyle}>Total</span>
          <span>${((spend.totalCents ?? 0) / 100).toFixed(2)}</span>
        </div>
        <div style={{ ...rowStyle, borderBottom: "none" }}>
          <span style={keyStyle}>Provider calls</span>
          <span>{spend.providerCallCount ?? 0}</span>
        </div>
      </section>

      {counters.businessesFound ? (
        <p style={{ fontSize: 16 }}>
          <Link href="/records">View the companies list &rarr;</Link>
        </p>
      ) : null}
    </main>
  );
}
