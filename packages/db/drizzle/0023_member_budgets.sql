-- A spending limit per person.
--
-- Until now there was exactly one account, so "what has been spent" and "what may be spent" were
-- the same question and neither needed an owner. With members, they separate: a member may buy
-- paid data — that was the operator's decision — but only up to an amount the administrator sets.
--
-- The shape is deliberately small. One row per person, an amount in cents, and how often it comes
-- back. Everything else is derived: what has been spent in the current window is counted from
-- `provider_calls`, which is written **before** each paid call and therefore cannot flatter
-- itself. No running total is stored, because a stored total is a second source of truth that goes
-- quietly wrong the first time a row is deleted or backfilled.
--
-- `period` values:
--   once    — one allowance, never refilled. Raising it is a deliberate act by the administrator.
--   weekly  — the window starts every Monday.
--   monthly — the window starts on the 1st.
--
-- A person with **no row has no allowance**, which is the right default: a new member cannot spend
-- until somebody decides what they may spend. That is also why the web app treats a missing row as
-- zero rather than unlimited.

create table if not exists public.member_budgets (
  user_id uuid primary key,              -- references auth.users(id), Supabase-managed
  amount_cents integer not null default 0 check (amount_cents >= 0),
  period text not null default 'monthly' check (period in ('once', 'weekly', 'monthly')),
  -- Where the first window began. For 'once' this is simply when it was granted.
  starts_at timestamptz not null default now(),
  note text,
  created_by uuid,                       -- the administrator who set it
  updated_at timestamptz not null default now()
);

comment on table public.member_budgets is
  'What each person may spend on paid data. Spend itself is counted from provider_calls, never stored here.';

alter table public.member_budgets enable row level security;

-- A member may read their own allowance — the buying screens have to show what is left, and a
-- limit nobody can see is a limit that reads as a bug. They may read nobody else's.
create policy member_budgets_select on public.member_budgets
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

-- Only an administrator may set, change or remove one. A member raising their own limit would
-- make the whole thing decorative.
create policy member_budgets_insert on public.member_budgets
  for insert to authenticated
  with check ((select private.is_admin()));

create policy member_budgets_update on public.member_budgets
  for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));

create policy member_budgets_delete on public.member_budgets
  for delete to authenticated
  using ((select private.is_admin()));

-- Where a person's spend is counted from, and why it is not `provider_calls`.
--
-- `provider_calls` is the authoritative ledger and it has **no owner column**: it is written by the
-- worker, which runs as the service role and has no user session. Adding one would mean threading
-- a user id through six call sites in the worker for a number that already exists one level up —
-- `job_runs.cost_cents` is accumulated as a task runs, and `job_runs.created_by` is who started it.
--
-- So a member's spend is the sum of what their own tasks cost. The two agree, because every paid
-- call this product makes happens inside a task. The company-wide total on the administrator's
-- screen still comes from the ledger itself, which cannot flatter itself.
create index if not exists job_runs_created_by_started_at_idx
  on public.job_runs (created_by, started_at desc);
