import { elapsedWords, type JobRun } from "@/lib/job-runs";
import { Money } from "./ui";

/**
 * What is running, on every screen, without a line of JavaScript.
 *
 * The operator's report was the whole specification: *"abhi hum koi bhi task chala te hain to pata
 * hi nhi hota ke task chala bhi hai ke nhi, ager chal gaya hai to kitna complete hai"*. Pressing a
 * button produced a redirect and a cheerful sentence, and then the screen went quiet for two
 * minutes whether the job was working, queued behind another, or dead.
 *
 * **The refresh is a `<meta>` tag, not a script.** This application ships zero client-side
 * JavaScript — forms are server actions and previews are GET submissions — and adding a polling
 * hook for this one banner would break that for the whole product.
 *
 * **And it is off wherever the operator might be typing.** A page that reloads itself every five
 * seconds would wipe a half-written checklist rule, a category description, or a call outcome
 * mid-sentence — turning a feature meant to reassure into one that destroys work. So reading
 * screens refresh themselves and writing screens do not; the writing screens still show the same
 * banner with a link to refresh when the operator is ready. Losing somebody's typing to show them
 * a progress bar would be a bad trade at any speed.
 */
export function RunningJobs({ jobs, autoRefresh = true }: { jobs: JobRun[]; autoRefresh?: boolean }) {
  if (jobs.length === 0) return null;

  return (
    <>
      {/* Only while something is running, and never on a screen with a form in it. */}
      {autoRefresh ? <meta httpEquiv="refresh" content="5" /> : null}

      <section
        aria-live="polite"
        style={{
          background: "var(--brand-bg)",
          border: "1px solid var(--brand)",
          borderRadius: "var(--radius)",
          padding: "14px 18px 16px",
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <Spinner />
          <strong style={{ fontSize: 17, color: "var(--brand-ink)" }}>
            {jobs.length === 1 ? "A task is running" : `${jobs.length} tasks are running`}
          </strong>
          <span style={{ marginLeft: "auto", fontSize: 14, color: "var(--ink-2)" }}>
            {autoRefresh ? (
              "This page refreshes itself every 5 seconds"
            ) : (
              <>
                Not refreshing on its own here, so nothing you are typing is lost.{" "}
                <a href="">Refresh now</a>
              </>
            )}
          </span>
        </div>

        {jobs.map((job) => (
          <JobLine key={job.id} job={job} />
        ))}
      </section>
    </>
  );
}

/** One job: what it is, how far along, how long it has been going, and what it has cost so far. */
export function JobLine({ job, compact = false }: { job: JobRun; compact?: boolean }) {
  const pct = job.total && job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : null;
  const done = job.status === "done" || job.status === "failed";
  const tone = job.status === "failed" ? "var(--bad)" : job.status === "done" ? "var(--good)" : "var(--brand)";

  return (
    <div style={{ marginTop: compact ? 10 : 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", fontSize: 15.5 }}>
        <strong style={{ color: "var(--ink)" }}>{job.label}</strong>

        <span style={{ color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
          {job.status === "queued"
            ? "waiting to start"
            : job.total !== null
              ? `${job.done} of ${job.total} done`
              : job.done > 0
                ? `${job.done} done`
                : "working"}
        </span>

        <span style={{ marginLeft: "auto", display: "flex", gap: 14, alignItems: "baseline" }}>
          {/* Spend while it is being spent, not after. The operator asked for every price to say
              what it is for; this one says it is this job, so far. */}
          {job.costCents > 0 && (
            <span style={{ fontSize: 14.5, color: "var(--money-ink)", fontWeight: 650 }}>
              <Money cents={job.costCents} /> so far
            </span>
          )}
          <span style={{ fontSize: 14.5, color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
            {elapsedWords(job.startedAt, job.finishedAt)}
          </span>
        </span>
      </div>

      {/*
       * A striped, moving bar when the size is unknown; a real one when it is known.
       *
       * The distinction matters more than it looks. A bar sitting at a made-up 50% tells the
       * operator something false about how long they will be waiting, and this codebase has been
       * bitten by inventing a value for "we do not know" often enough to stop doing it.
       */}
      <div
        style={{
          height: 9,
          marginTop: 6,
          background: "var(--surface-3)",
          borderRadius: 99,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: pct === null ? "100%" : `${pct}%`,
            height: "100%",
            borderRadius: 99,
            background:
              pct === null && !done
                ? `repeating-linear-gradient(115deg, ${tone} 0 12px, color-mix(in srgb, ${tone} 45%, #fff) 12px 24px)`
                : tone,
            opacity: pct === null && !done ? 0.75 : 1,
          }}
        />
      </div>

      {(job.step || job.detail) && (
        <div style={{ fontSize: 14.5, color: job.status === "failed" ? "var(--bad-ink)" : "var(--ink-2)", marginTop: 5, lineHeight: 1.5 }}>
          {job.step ?? job.detail}
        </div>
      )}
    </div>
  );
}

/**
 * A spinner made of CSS, because this application has no client-side JavaScript to animate one.
 *
 * The keyframes go in a `<style>` beside it rather than in globals.css so the whole component is
 * one thing to read and one thing to delete.
 */
function Spinner() {
  return (
    <>
      <style>{`@keyframes li-spin { to { transform: rotate(360deg) } }
        @media (prefers-reduced-motion: reduce) { .li-spin { animation: none !important } }`}</style>
      <span
        className="li-spin"
        aria-hidden
        style={{
          width: 16,
          height: 16,
          borderRadius: 99,
          border: "2.5px solid color-mix(in srgb, var(--brand) 30%, transparent)",
          borderTopColor: "var(--brand)",
          display: "inline-block",
          animation: "li-spin 0.8s linear infinite",
        }}
      />
    </>
  );
}
