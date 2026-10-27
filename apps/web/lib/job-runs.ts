import { runs } from "@trigger.dev/sdk";
import { createClient } from "@/lib/supabase/server";

/**
 * The record of what the operator has started.
 *
 * Written **here, at the moment of enqueue**, rather than by the worker when it picks the job up.
 * A Trigger.dev queue can be a minute deep, and for that minute the worker-written version would
 * show nothing at all — which is exactly the complaint this exists to answer: press the button,
 * get a sentence, and then have no way to tell whether anything is happening.
 */

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface JobRun {
  id: string;
  kind: string;
  label: string;
  status: JobStatus;
  total: number | null;
  done: number;
  step: string | null;
  detail: string | null;
  businessId: string | null;
  costCents: number;
  startedAt: string;
  /** Last time the worker said anything. See the stalled note below. */
  updatedAt: string;
  finishedAt: string | null;
  /**
   * True when a running job has said nothing for a long time.
   *
   * A job whose worker died leaves its row saying "running" for ever — two discovery runs sat like
   * that for 28 hours — and while it does, the banner is on every screen and every reading page
   * reloads itself every five seconds behind it. The row cannot be trusted to end itself, so the
   * screen reads the clock instead and says plainly that nothing has been heard.
   */
  stalled: boolean;
  /** Null for jobs started before run ids were recorded; those cannot be stopped. */
  triggerRunId: string | null;
}

const COLUMNS =
  "id, kind, label, status, total, done, step, detail, business_id, cost_cents, started_at, updated_at, finished_at, trigger_run_id";

/**
 * Silence longer than this means stalled, not busy.
 *
 * Generous on purpose: the slowest single unit of work in the product is one site opened in a real
 * browser and judged by a model, which runs under a ten-minute cap. Fifteen minutes of total
 * silence is therefore outside anything healthy, and the screen says so rather than guessing.
 */
export const STALLED_AFTER_MS = 15 * 60 * 1000;

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Creates the row, and returns its id so the caller can hand it to the task.
 *
 * Returns null rather than throwing if the write fails. Losing the ability to *watch* a job is a
 * far smaller harm than refusing to *run* it, and the caller is about to enqueue real work.
 */
export async function startJobRun(
  supabase: Supabase,
  params: { kind: string; label: string; total?: number | null; businessId?: string | null },
): Promise<string | null> {
  /**
   * Who started it.
   *
   * The column has existed since the table did and nothing ever wrote it — so every row said the
   * task belonged to nobody, and "my tasks" and "my spend" were empty for everybody. Read from the
   * session here rather than passed in, because every caller already has the session and the one
   * that forgot would be the one whose spend went uncounted.
   */
  const { data: claims } = await supabase.auth.getClaims();
  const startedBy = claims?.claims?.sub ? String(claims.claims.sub) : null;

  const { data, error } = await supabase
    .from("job_runs")
    .insert({
      kind: params.kind,
      label: params.label,
      status: "queued",
      // Null when the size is genuinely not known yet. A bar that invents its denominator is worse
      // than one that admits it cannot draw itself.
      total: params.total ?? null,
      business_id: params.businessId ?? null,
      created_by: startedBy,
    })
    .select("id")
    .single();

  return error ? null : (data?.id ?? null);
}

/**
 * Remembers which Trigger.dev run is doing this job, so it can be stopped later.
 *
 * Best effort: a job whose run id could not be stored still runs, it just cannot be cancelled from
 * the product — which is the state every job was in before this existed.
 */
export async function attachTriggerRun(supabase: Supabase, id: string | null, runId: string | undefined): Promise<void> {
  if (!id || !runId) return;
  await supabase.from("job_runs").update({ trigger_run_id: runId }).eq("id", id);
}

/** Marks a job finished from the web side — used when the enqueue itself fails. */
export async function failJobRun(supabase: Supabase, id: string | null, detail: string): Promise<void> {
  if (!id) return;
  await supabase.from("job_runs").update({ status: "failed", detail, finished_at: new Date().toISOString() }).eq("id", id);
}

/**
 * What each kind of task actually is, and where its result lives.
 *
 * The operator's report, looking at a banner that had been up for nineteen hours: *"mujhe nhi pata
 * ye chal raha hai ya ruk gaya hai ya complete ho chuka hai or ab mujhe ye bhi nhi pata ke ye kis
 * cheez ka chalaya tha"*. All three are the same omission — a job row carried a label and a
 * percentage and never said what it was for or where to look when it finished.
 *
 * `where` is the screen the work shows up on, which is almost never the screen it was started
 * from. A job about one business beats this and links to that business instead.
 */
export const JOB_KINDS: Record<string, { name: string; what: string; where: string; whereLabel: string }> = {
  "analyse-run": {
    name: "Website analysis",
    what: "Reads their websites, runs the checks, measures page speed and scores them again. Free.",
    where: "/records",
    whereLabel: "See the leads",
  },
  "audit-site": {
    name: "Reading one site in a browser",
    what: "Opens each page in a real browser, keeps screenshots, finds social links, then asks the model what the measurements miss.",
    where: "/records",
    whereLabel: "See the leads",
  },
  "audit-site-run": {
    name: "Reading sites in a browser",
    what: "The same, for several businesses at once.",
    where: "/records",
    whereLabel: "See the leads",
  },
  discovery: {
    name: "Finding businesses",
    what: "Searches Google Maps for one of your ICPs and adds what it finds. This one costs money.",
    where: "/search",
    whereLabel: "Go to Find businesses",
  },
  "enrich-run": {
    name: "Buying extra data",
    what: "Buys the Google listing, Instagram or Meta ads for businesses you picked. This one costs money.",
    where: "/spend",
    whereLabel: "See what it cost",
  },
  "match-icps-run": {
    name: "Sorting into ICPs",
    what: "Works out again which ICP every business belongs to, from text already stored. Free.",
    where: "/icps",
    whereLabel: "Go to ICPs",
  },
  "score-run": {
    name: "Re-scoring",
    what: "Works the scores and priorities out again from the checks already stored. Free.",
    where: "/records",
    whereLabel: "See the leads",
  },
};

/** Where to go to see what a task was about, and what to call that place. */
export function jobTarget(job: JobRun): { href: string; label: string } {
  if (job.businessId) return { href: `/records/${job.businessId}`, label: "Open this business" };
  const kind = JOB_KINDS[job.kind];
  return kind ? { href: kind.where, label: kind.whereLabel } : { href: "/tasks", label: "See all tasks" };
}

/**
 * The state, in the words the operator used to ask for it: is it running, has it stopped, is it
 * finished.
 *
 * `never_started` is the one worth having separately. A row that has sat **queued** for hours has
 * not slowed down — nothing ever picked it up, which usually means no worker was running when the
 * button was pressed. "Waiting to start" under a moving stripe says the opposite of that.
 */
export type JobState = "waiting" | "not_picked_up" | "never_started" | "running" | "quiet" | "done" | "stopped";

/**
 * A queued job that has not begun within this is already worth remarking on.
 *
 * Two minutes, not fifteen. When a worker is running, a task is picked up in seconds — so the
 * operator who watched "Waiting to start" for nine and a half minutes was being told nothing by a
 * screen that already knew something was wrong. Short enough to be useful, long enough that a
 * genuine queue behind a four-at-a-time browser pass is not called a fault.
 */
export const NOT_PICKED_UP_AFTER_MS = 2 * 60 * 1000;

export function jobState(job: JobRun): JobState {
  if (job.status === "done") return "done";
  if (job.status === "failed") return "stopped";
  if (job.status === "queued") {
    if (job.stalled) return "never_started";
    return Date.now() - new Date(job.startedAt).getTime() > NOT_PICKED_UP_AFTER_MS ? "not_picked_up" : "waiting";
  }
  return job.stalled ? "quiet" : "running";
}

export const JOB_STATE_WORDS: Record<JobState, { word: string; tone: "brand" | "good" | "warn" | "bad" }> = {
  waiting: { word: "Waiting to start", tone: "brand" },
  not_picked_up: { word: "Not picked up yet", tone: "warn" },
  never_started: { word: "Never started", tone: "warn" },
  running: { word: "Running", tone: "brand" },
  quiet: { word: "Gone quiet", tone: "warn" },
  done: { word: "Finished", tone: "good" },
  stopped: { word: "Stopped", tone: "bad" },
};

/** True while the task is not actually doing anything, whatever the row says. */
export function jobIsIdle(state: JobState): boolean {
  return state === "waiting" || state === "not_picked_up" || state === "never_started";
}

/**
 * Everything currently queued or running.
 *
 * Shown on every page, because a job the operator started on the leads screen is still running when
 * they navigate to a lead, and "did that finish?" should never require going back to find out.
 */
/**
 * Whose tasks these are.
 *
 * `job_runs.created_by` is written when the task is started, so a member sees the banner for their
 * own work and nobody else's — including on every screen, where the banner is drawn by the shell.
 * Passing `undefined` means no filter, which is the administrator's view.
 */
export async function loadRunningJobs(supabase?: Supabase, createdBy?: string): Promise<JobRun[]> {
  const client = supabase ?? (await createClient());
  let query = client
    .from("job_runs")
    .select(COLUMNS)
    .in("status", ["queued", "running"])
    .order("started_at", { ascending: false })
    .limit(8);
  if (createdBy) query = query.eq("created_by", createdBy);
  const { data } = await query;

  return (data ?? []).map(toJobRun);
}

/**
 * Asks Trigger.dev what actually happened to a job that stopped reporting, and writes the answer
 * down.
 *
 * This is the fault that produced the operator's question — *"abhi tak start hi ker raha hai abhi
 * tak start nhi kia??"* — and the cause was not what either of us would have guessed. The task had
 * been handed to Trigger.dev properly. No worker was listening, so ten minutes later **the platform
 * expired the run**: `Run expired because the TTL (10m) was reached`. The run was dead. Our row
 * knew nothing about it and sat saying "queued" for nineteen hours, then another nine minutes on
 * the next attempt.
 *
 * A job row cannot report its own death — whatever would have written the obituary is the thing
 * that is gone. So the screen asks the one place that does know. Only for rows that look wrong
 * (queued or running, with nothing heard for two minutes), and at most a handful at a time, so a
 * healthy product makes no API calls here at all.
 */
export async function reconcileStuckJobs(supabase: Supabase, jobs: JobRun[]): Promise<JobRun[]> {
  const suspicious = jobs.filter(
    (job) =>
      (job.status === "queued" || job.status === "running") &&
      job.triggerRunId !== null &&
      Date.now() - new Date(job.updatedAt).getTime() > NOT_PICKED_UP_AFTER_MS,
  );
  if (suspicious.length === 0) return jobs;

  const settled = new Map<string, { status: "done" | "failed"; detail: string }>();

  for (const job of suspicious.slice(0, 4)) {
    try {
      const run = await runs.retrieve(job.triggerRunId as string);
      const outcome = settlePlatformStatus(String(run.status), run.error);
      if (outcome) settled.set(job.id, outcome);
    } catch {
      // The platform is unreachable or the run is unknown. Saying nothing is right: a network
      // failure here must never be recorded as a failed job.
    }
  }

  if (settled.size === 0) return jobs;

  const finishedAt = new Date().toISOString();
  await Promise.all(
    [...settled.entries()].map(([id, outcome]) =>
      supabase
        .from("job_runs")
        .update({ status: outcome.status, detail: outcome.detail, step: null, finished_at: finishedAt })
        .eq("id", id)
        .in("status", ["queued", "running"]),
    ),
  );

  // The caller is about to render. Return the corrected rows rather than the stale ones, so the
  // fix shows on this page load instead of the next.
  return jobs.filter((job) => !settled.has(job.id));
}

/**
 * What a Trigger.dev run status means for our row — and, as always, in the operator's words.
 *
 * `null` means "still legitimately in flight", so nothing is written. Only the states that are
 * genuinely over end a row, because marking a slow job dead is the same lie in the other
 * direction.
 */
function settlePlatformStatus(
  status: string,
  error?: { message?: string } | null,
): { status: "done" | "failed"; detail: string } | null {
  if (status === "COMPLETED") {
    return { status: "done", detail: "Finished. The task ended before it could write its own summary." };
  }
  if (status === "EXPIRED") {
    return {
      status: "failed",
      detail:
        "Never started — it waited ten minutes for a worker and then expired. Nothing was read, bought or spent. Start it again with the worker running.",
    };
  }
  if (status === "CANCELED") {
    return { status: "failed", detail: "Cancelled. Anything already done is kept." };
  }
  if (["FAILED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT", "INTERRUPTED"].includes(status)) {
    return {
      status: "failed",
      detail: error?.message
        ? `It stopped with an error: ${error.message}`
        : "It stopped with an error and could not say what it was. Anything already done is kept.",
    };
  }
  return null;
}

/** The last few finished jobs, so "did that work?" has an answer after the banner has gone. */
export async function loadRecentJobs(supabase: Supabase, limit = 12, createdBy?: string): Promise<JobRun[]> {
  let query = supabase.from("job_runs").select(COLUMNS).order("started_at", { ascending: false }).limit(limit);
  if (createdBy) query = query.eq("created_by", createdBy);
  const { data } = await query;

  return (data ?? []).map(toJobRun);
}

/**
 * Jobs that ended in the last little while, so the screen can say so out loud.
 *
 * The operator asked for two things together — the page should come back on its own when a task
 * finishes, and it should say that it finished — and the second is what makes the first worth
 * anything. A page that quietly reloads with new numbers on it is indistinguishable from a page
 * that was always like that.
 *
 * The window is short on purpose. This announces something that **just** happened; anything older
 * belongs on the Tasks screen, not in a box over the page the operator is reading.
 */
export async function loadJustFinishedJobs(
  supabase: Supabase,
  withinMs = JUST_FINISHED_MS,
  createdBy?: string,
): Promise<JobRun[]> {
  const since = new Date(Date.now() - withinMs).toISOString();
  let query = supabase
    .from("job_runs")
    .select(COLUMNS)
    .in("status", ["done", "failed"])
    .gt("finished_at", since)
    .order("finished_at", { ascending: false })
    .limit(3);
  if (createdBy) query = query.eq("created_by", createdBy);
  const { data } = await query;

  return (data ?? []).map(toJobRun);
}

/** How recently a job must have ended to be worth announcing. */
export const JUST_FINISHED_MS = 45_000;

/**
 * How often a screen should come back for news while something is running.
 *
 * Ten seconds, not sixty: the operator asked for the page to return on its own when a task
 * finishes, and a minute of staring at a finished task is most of why they asked. Not five, which
 * was tried and made the whole product feel broken — every screen reloading under the cursor, with
 * no calm moment to read anything. And never on a screen with a form in it, whatever this says.
 */
export const REFRESH_WHILE_RUNNING_SECONDS = 10;

/** Every job about one business, for its own record page. */
export async function loadJobsForBusiness(supabase: Supabase, businessId: string): Promise<JobRun[]> {
  const { data } = await supabase
    .from("job_runs")
    .select(COLUMNS)
    .eq("business_id", businessId)
    .order("started_at", { ascending: false })
    .limit(6);

  return (data ?? []).map(toJobRun);
}

function toJobRun(row: Record<string, unknown>): JobRun {
  return {
    id: String(row.id),
    kind: String(row.kind),
    label: String(row.label),
    status: row.status as JobStatus,
    total: row.total === null || row.total === undefined ? null : Number(row.total),
    done: Number(row.done ?? 0),
    step: (row.step as string | null) ?? null,
    detail: (row.detail as string | null) ?? null,
    businessId: (row.business_id as string | null) ?? null,
    // Postgres `numeric` arrives as a string through PostgREST. Reading it as a number without
    // saying so is how 160 Instagram lookups were once recorded as free.
    costCents: Number(row.cost_cents ?? 0),
    startedAt: String(row.started_at),
    updatedAt: String(row.updated_at ?? row.started_at),
    finishedAt: (row.finished_at as string | null) ?? null,
    stalled:
      (row.status === "running" || row.status === "queued") &&
      Date.now() - new Date(String(row.updated_at ?? row.started_at)).getTime() > STALLED_AFTER_MS,
    triggerRunId: (row.trigger_run_id as string | null) ?? null,
  };
}

/** How long it has been going, in words. */
export function elapsedWords(from: string, to: string | null): string {
  const seconds = Math.max(0, Math.round((new Date(to ?? Date.now()).getTime() - new Date(from).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
