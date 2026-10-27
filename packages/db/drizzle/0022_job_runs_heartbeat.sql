-- A job row that says "running" must be able to prove it still is.
--
-- Without this the web app cannot tell a job that is working from one whose worker died: the row
-- says running for ever, the banner shows on every screen, and every reading screen reloads itself
-- every five seconds behind it. Two discovery runs in this database sat "running" for 28 hours
-- before an operator stopped them by hand.
alter table job_runs add column if not exists updated_at timestamptz not null default now();

update job_runs set updated_at = coalesce(finished_at, started_at, now()) where updated_at is null;

comment on column job_runs.updated_at is
  'Last time the worker reported anything. A running row that has not moved for a long while is stalled, not busy.';
