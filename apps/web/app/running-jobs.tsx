import Link from "next/link";
import {
  elapsedWords,
  JOB_KINDS,
  JOB_STATE_WORDS,
  jobIsIdle,
  jobState,
  jobTarget,
  REFRESH_WHILE_RUNNING_SECONDS,
  type JobRun,
} from "@/lib/job-runs";
import { stopJobRun } from "./actions";
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

  /**
   * A job that has said nothing for a quarter of an hour is not working.
   *
   * Two discovery runs in this database said "running" for 28 hours, because a worker that dies
   * cannot write its own obituary. While they did, this banner sat on every screen and every
   * reading page reloaded itself behind it — so the one fault produced a product that looked
   * permanently busy and permanently reloading. The screen now reads the clock: it says what it
   * knows, stops claiming the job is working, and stops the refresh, because reloading a page to
   * watch a number that will never move again is the definition of wasted.
   */
  const stalled = jobs.filter((job) => job.stalled);
  const live = jobs.filter((job) => !job.stalled);
  const allStalled = live.length === 0;
  /**
   * "A task is running" was being printed over a row that had not started.
   *
   * The heading is the first thing read and it was the least true thing on the screen: a queued
   * task is not running, and saying it is turns a nine-minute wait into nine minutes of trusting
   * the wrong thing.
   */
  const working = live.filter((job) => !jobIsIdle(jobState(job)));
  const idle = live.filter((job) => jobIsIdle(jobState(job)));

  return (
    <>
      {/* Only while something is running, and never on a screen with a form in it. */}
      {/*
        * Once a minute, not every five seconds.
        *
        * Five seconds was chosen so a bar would visibly move, and it made the whole product feel
        * broken instead: every screen reloaded under the operator's cursor, a click landed on a
        * page that was already being replaced, and there was no calm moment to read anything. The
        * "Refresh now" link covers the case where they want to see progress immediately.
        */}
      {autoRefresh && !allStalled ? (
        <meta httpEquiv="refresh" content={String(REFRESH_WHILE_RUNNING_SECONDS)} />
      ) : null}

      <section
        aria-live="polite"
        style={{
          background: allStalled ? "var(--warn-bg)" : "var(--brand-bg)",
          border: `1px solid ${allStalled ? "var(--warn)" : "var(--brand)"}`,
          borderRadius: "var(--radius)",
          padding: "14px 18px 16px",
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          {allStalled ? <span aria-hidden>⚠</span> : working.length > 0 ? <Spinner /> : <span aria-hidden>◷</span>}
          <strong style={{ fontSize: 17, color: allStalled ? "var(--warn-ink)" : "var(--brand-ink)" }}>
            {allStalled
              ? stalled.length === 1
                ? "A task has gone quiet"
                : `${stalled.length} tasks have gone quiet`
              : working.length === 0
                ? idle.length === 1
                  ? "A task is waiting to start"
                  : `${idle.length} tasks are waiting to start`
                : working.length === 1
                  ? `A task is running${idle.length > 0 ? `, ${idle.length} waiting` : ""}`
                  : `${working.length} tasks are running${idle.length > 0 ? `, ${idle.length} waiting` : ""}`}
          </strong>
          <span style={{ marginLeft: "auto", fontSize: 14, color: "var(--ink-2)" }}>
            {allStalled
              ? "Nothing heard for over 15 minutes. It is not updating any more — press Stop to clear it. "
              : autoRefresh
                ? `Comes back on its own every ${REFRESH_WHILE_RUNNING_SECONDS} seconds, and tells you when it is done. `
                : "Not updating on its own here, so nothing you type is lost. "}
            <a href="" data-tip="Reload this page now to see how far the task has got">
              Refresh now
            </a>
          </span>
        </div>

        {jobs.map((job) => (
          <div key={job.id} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <JobLine job={job} />
            </div>
            <StopButton job={job} />
          </div>
        ))}

        <div style={{ marginTop: 10, fontSize: 13.5 }}>
          <Link href="/tasks">Every task, running and finished →</Link>
        </div>
      </section>
    </>
  );
}

/**
 * One job: **what state it is in**, what it was for, where to see the result, how far it got, how
 * long it has been, and what it has cost.
 *
 * The state comes first and is said in a word, because that was the question the old line could not
 * answer. It showed a label, a striped bar that moves whatever is happening, and "waiting to
 * start" — and that combination had been on screen for nineteen hours in front of an operator who
 * could not tell whether it was working, stuck or finished. A stripe that moves while nothing is
 * happening is not a neutral choice; it is the screen saying something untrue.
 */
export function JobLine({ job, compact = false }: { job: JobRun; compact?: boolean }) {
  const pct = job.total && job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : null;
  const state = jobState(job);
  const words = JOB_STATE_WORDS[state];
  const moving = state === "running";
  const kind = JOB_KINDS[job.kind];
  const target = jobTarget(job);
  const tone =
    words.tone === "good" ? "var(--good)" : words.tone === "warn" ? "var(--warn)" : words.tone === "bad" ? "var(--bad)" : "var(--accent)";

  return (
    <div style={{ marginTop: compact ? 10 : 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 14.5 }}>
        {/* The state, as a word, in the colour that means it. Never only a bar. */}
        <span className={`badge ${words.tone === "brand" ? "accent" : words.tone}`}>{words.word}</span>

        <strong style={{ color: "var(--ink)", fontSize: 15 }}>{job.label}</strong>

        <span style={{ color: "var(--ink-3)" }}>
          {state === "waiting" || state === "never_started"
            ? "nothing done yet"
            : job.total !== null
              ? `${job.done} of ${job.total} done`
              : job.done > 0
                ? `${job.done} done`
                : "no count"}
        </span>

        <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "baseline" }}>
          {/* Spend while it is being spent, not after. The operator asked for every price to say
              what it is for; this one says it is this job, so far. */}
          {job.costCents > 0 && (
            <span className="mono" style={{ fontSize: 13.5, color: "var(--money-ink)", fontWeight: 600 }}>
              <Money cents={job.costCents} /> so far
            </span>
          )}
          <span className="mono" style={{ fontSize: 13, color: "var(--ink-3)" }}>
            {elapsedWords(job.startedAt, job.finishedAt)}
          </span>
        </span>
      </div>

      {/*
       * A striped, moving bar when the size is unknown; a real one when it is known — and a still,
       * flat one whenever the job is not actually working.
       *
       * The distinction matters more than it looks. A bar sitting at a made-up 50% tells the
       * operator something false about how long they will be waiting, and a bar that keeps moving
       * while nothing is happening tells them something false about whether to wait at all.
       */}
      <div style={{ height: 8, marginTop: 7, background: "var(--surface-3)", borderRadius: 99, overflow: "hidden" }}>
        <div
          style={{
            width: pct === null ? "100%" : `${pct}%`,
            height: "100%",
            borderRadius: 99,
            background: moving && pct === null
              ? `repeating-linear-gradient(115deg, ${tone} 0 12px, color-mix(in srgb, ${tone} 45%, var(--surface)) 12px 24px)`
              : tone,
            opacity: state === "waiting" || state === "never_started" ? 0.35 : 1,
          }}
        />
      </div>

      {/* What this kind of task does, in the operator's words. A label names it; this explains it. */}
      {!compact && kind ? (
        <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 6, lineHeight: 1.5 }}>
          <strong style={{ color: "var(--ink-2)" }}>{kind.name}.</strong> {kind.what}
        </div>
      ) : null}

      {(job.step || job.detail) && (
        <div
          style={{
            fontSize: 13.5,
            color: job.status === "failed" ? "var(--bad-ink)" : "var(--ink-2)",
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          {job.step ?? job.detail}
        </div>
      )}

      {/* Why it is in this state, when the state is one that needs explaining. */}
      {state === "not_picked_up" ? (
        <div style={{ fontSize: 13, color: "var(--warn-ink)", marginTop: 4, lineHeight: 1.5 }}>
          Queued {elapsedWords(job.startedAt, null)} ago and nothing has taken it on yet. Either something ahead of
          it is still running, or no worker is running at all — a task started on this machine needs{" "}
          <code>trigger dev</code> going for anything to pick it up. Nothing has been spent.
        </div>
      ) : state === "never_started" ? (
        <div style={{ fontSize: 13, color: "var(--warn-ink)", marginTop: 4, lineHeight: 1.5 }}>
          It has been waiting {elapsedWords(job.startedAt, null)} and never began. Nothing picked it up — usually
          because no worker was running when the button was pressed. Nothing was spent. Press Stop to clear it,
          then start it again.
        </div>
      ) : state === "quiet" ? (
        <div style={{ fontSize: 13, color: "var(--warn-ink)", marginTop: 4, lineHeight: 1.5 }}>
          Last heard from {elapsedWords(job.updatedAt, null)} ago, so it is no longer reporting. Anything it had
          already finished is kept. Press Stop to clear it.
        </div>
      ) : null}

      {/* Where the result of this task lives. Almost never the screen it was started from. */}
      {!compact ? (
        <div style={{ marginTop: 8 }}>
          <Link href={target.href} className="btn secondary sm">
            {target.label}
          </Link>
        </div>
      ) : null}
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

/**
 * Stops one job. Shown only while it is still going.
 *
 * Jobs started before run ids were recorded can still be stopped: the button marks the row, and the
 * long loops check the row between batches. Only the platform-side cancel is skipped for those.
 */
export function StopButton({ job, back = "" }: { job: JobRun; back?: string }) {
  if (job.status !== "queued" && job.status !== "running") return null;
  return (
    <form action={stopJobRun} style={{ marginTop: 10 }}>
      <input type="hidden" name="jobRunId" value={job.id} />
      <input type="hidden" name="back" value={back || "/records"} />
      <button
        type="submit"
        className="btn-2 btn"
        style={{ fontSize: 14.5, padding: "5px 11px", color: "var(--bad-ink)", borderColor: "var(--bad)" }}
        data-tip="Stop this task. Whatever it has already read or bought is kept; nothing new starts."
      >
        Stop
      </button>
    </form>
  );
}

/**
 * "That finished" — said once, for five seconds, over whatever the operator is reading.
 *
 * Asked for alongside the ten-second refresh, and the two only work together: a page that quietly
 * comes back with new numbers on it looks exactly like a page that was always like that. This is
 * the sentence that makes the reload mean something.
 *
 * **No JavaScript, as everywhere else here.** It appears and then takes itself away through a CSS
 * animation with a five-second delay and `forwards`, so the last frame — invisible, and out of the
 * way of clicks — is where it stays. Nothing has to remember to remove it.
 */
export function FinishedToast({ jobs }: { jobs: JobRun[] }) {
  if (jobs.length === 0) return null;
  const job = jobs[0] as JobRun;
  const failed = job.status === "failed";
  const target = jobTarget(job);
  const more = jobs.length - 1;

  return (
    <div className="toast auto" data-tone={failed ? "bad" : "good"} role="status" aria-live="polite">
      <span aria-hidden style={{ fontSize: 16, lineHeight: 1 }}>
        {failed ? "⚠" : "✓"}
      </span>
      <div style={{ minWidth: 0 }}>
        <b>
          {failed ? "Task stopped" : "Task finished"}
          {more > 0 ? ` (and ${more} more)` : ""}
        </b>
        <span style={{ display: "block" }}>{job.label}</span>
        {job.detail ? (
          <span style={{ display: "block", marginTop: 2 }} className="clamp-2">
            {job.detail}
          </span>
        ) : null}
        <Link href={target.href} style={{ fontSize: 12.5, display: "inline-block", marginTop: 5 }}>
          {target.label} →
        </Link>
      </div>
    </div>
  );
}
