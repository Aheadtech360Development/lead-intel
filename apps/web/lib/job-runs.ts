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
  finishedAt: string | null;
}

const COLUMNS =
  "id, kind, label, status, total, done, step, detail, business_id, cost_cents, started_at, finished_at";

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
    })
    .select("id")
    .single();

  return error ? null : (data?.id ?? null);
}

/** Marks a job finished from the web side — used when the enqueue itself fails. */
export async function failJobRun(supabase: Supabase, id: string | null, detail: string): Promise<void> {
  if (!id) return;
  await supabase.from("job_runs").update({ status: "failed", detail, finished_at: new Date().toISOString() }).eq("id", id);
}

/**
 * Everything currently queued or running.
 *
 * Shown on every page, because a job the operator started on the leads screen is still running when
 * they navigate to a lead, and "did that finish?" should never require going back to find out.
 */
export async function loadRunningJobs(supabase?: Supabase): Promise<JobRun[]> {
  const client = supabase ?? (await createClient());
  const { data } = await client
    .from("job_runs")
    .select(COLUMNS)
    .in("status", ["queued", "running"])
    .order("started_at", { ascending: false })
    .limit(8);

  return (data ?? []).map(toJobRun);
}

/** The last few finished jobs, so "did that work?" has an answer after the banner has gone. */
export async function loadRecentJobs(supabase: Supabase, limit = 12): Promise<JobRun[]> {
  const { data } = await supabase
    .from("job_runs")
    .select(COLUMNS)
    .order("started_at", { ascending: false })
    .limit(limit);

  return (data ?? []).map(toJobRun);
}

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
    finishedAt: (row.finished_at as string | null) ?? null,
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
