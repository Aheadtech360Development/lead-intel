import Link from "next/link";
import {
  elapsedWords,
  JOB_KINDS,
  JOB_STATE_WORDS,
  jobState,
  jobTarget,
  loadRecentJobs,
  reconcileStuckJobs,
  type JobRun,
} from "@/lib/job-runs";
import { createClient } from "@/lib/supabase/server";
import { getViewer } from "@/lib/viewer";
import { signOut } from "../actions";
import { StopButton } from "../running-jobs";
import { AppShell, Money, PANEL } from "../ui";

/**
 * Every task, running and finished, with what it was for and where its result went.
 *
 * It exists because of a gap the operator ran into directly: a banner had been on screen for
 * nineteen hours and they could not tell whether the task was working, stuck or long finished —
 * and once a task *does* finish, the banner disappears and there was nowhere at all to look it up
 * afterwards. "Did that import actually work?" had no answer in the product.
 *
 * So this screen is deliberately a **record** rather than a dashboard. Every row says the state in
 * a word, what that kind of task does, what it produced or why it ended, what it cost, and carries
 * a link to the screen where its result lives.
 */
export default async function TasksPage() {
  const supabase = await createClient();
  const viewer = await getViewer();

  /**
   * Yours only, unless you are the administrator.
   *
   * `job_runs.created_by` is stamped when the task is started, so this is the whole of the
   * scoping — no join, no guesswork about which business it touched.
   */
  const mine = viewer?.isAdmin ? undefined : viewer?.id;

  // Same check as the banner: a row that stopped reporting is asked about before it is listed.
  await reconcileStuckJobs(supabase, await loadRecentJobs(supabase, 60, mine));
  const jobs = await loadRecentJobs(supabase, 60, mine);
  const live = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const finished = jobs.filter((job) => job.status === "done" || job.status === "failed");

  return (
    <AppShell
      current="tasks"
      email={viewer?.email ?? null}
      signOutAction={signOut}
      title={viewer?.isAdmin ? "Tasks" : "My tasks"}
      what={
        viewer?.isAdmin
          ? "Everything this product has been asked to do, newest first — what it was for, how it ended, and where to see the result."
          : "Everything you have started, newest first — what it was for, how it ended, what it cost, and where to see the result. Another person's tasks are not here."
      }
      autoRefresh={live.length > 0}
    >
      <>
        {jobs.length === 0 ? (
          <div className="card empty">
            <span className="art" aria-hidden>
              ⏱
            </span>
            <h3>No tasks yet</h3>
            <p>
              Nothing has been run. Analysing websites, sorting into ICPs and re-scoring are all free —
              buying data is the only thing that costs, and it always asks first.
            </p>
            <Link href="/records" className="btn">
              Go to the leads
            </Link>
          </div>
        ) : null}

        {live.length > 0 ? (
          <>
            <h2 style={{ fontSize: 16.5, margin: "4px 0 10px" }}>Going on now</h2>
            {live.map((job) => (
              <TaskCard key={job.id} job={job} />
            ))}
          </>
        ) : null}

        {finished.length > 0 ? (
          <>
            <h2 style={{ fontSize: 16.5, margin: "26px 0 10px" }}>Finished</h2>
            {finished.map((job) => (
              <TaskCard key={job.id} job={job} />
            ))}
          </>
        ) : null}
      </>
    </AppShell>
  );
}

/**
 * One task, as a record of something that happened.
 *
 * The order of the lines is the order the questions get asked: what state is it in, what was it,
 * what was it about, what did it produce, what did it cost, where do I go now.
 */
function TaskCard({ job }: { job: JobRun }) {
  const state = jobState(job);
  const words = JOB_STATE_WORDS[state];
  const kind = JOB_KINDS[job.kind];
  const target = jobTarget(job);
  const pct = job.total && job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : null;

  return (
    <section style={{ ...PANEL, padding: "14px 16px", display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`badge ${words.tone === "brand" ? "accent" : words.tone}`}>{words.word}</span>
        <strong style={{ fontSize: 15, color: "var(--ink)" }}>{job.label}</strong>
        <span style={{ marginLeft: "auto", display: "flex", gap: 12, alignItems: "baseline" }}>
          {job.costCents > 0 ? (
            <span className="mono" style={{ fontSize: 13.5, color: "var(--money-ink)", fontWeight: 600 }}>
              <Money cents={job.costCents} />
            </span>
          ) : (
            <span style={{ fontSize: 13, color: "var(--good-ink)" }}>Free</span>
          )}
          <span className="mono" style={{ fontSize: 13, color: "var(--ink-3)" }}>
            {elapsedWords(job.startedAt, job.finishedAt)}
          </span>
        </span>
      </div>

      {/* What this kind of task is. A label names one run; this explains the kind. */}
      {kind ? (
        <div style={{ fontSize: 13, color: "var(--ink-3)", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--ink-2)" }}>{kind.name}.</strong> {kind.what}
        </div>
      ) : null}

      {/* What it produced, or why it ended. Never blank on a finished row — see jobProgress.finish. */}
      {job.detail || job.step ? (
        <div
          style={{
            fontSize: 14,
            color: job.status === "failed" ? "var(--bad-ink)" : "var(--ink-2)",
            lineHeight: 1.55,
          }}
        >
          {job.detail ?? job.step}
        </div>
      ) : null}

      {pct !== null && state !== "done" ? (
        <div className="meter" style={{ height: 6 }}>
          <i style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      {state === "never_started" ? (
        <div style={{ fontSize: 13, color: "var(--warn-ink)", lineHeight: 1.5 }}>
          Waited {elapsedWords(job.startedAt, null)} and never began — nothing picked it up, usually because no
          worker was running. Nothing was spent.
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Link href={target.href} className="btn secondary sm">
          {target.label}
        </Link>
        <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>
          Started {new Date(job.startedAt).toLocaleString()}
          {job.finishedAt ? ` · ended ${new Date(job.finishedAt).toLocaleString()}` : ""}
        </span>
        {state === "waiting" || state === "running" || state === "quiet" || state === "never_started" ? (
          <span style={{ marginLeft: "auto" }}>
            <StopButton job={job} back="/tasks" />
          </span>
        ) : null}
      </div>
    </section>
  );
}
