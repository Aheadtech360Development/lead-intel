-- Phase 3 — Google Places discovery: run limits + grid cell tracking
--
-- Applied directly via Supabase MCP apply_migration (no local DATABASE_URL configured in this
-- environment — same path Phase 1/2's 0000-0002 took). Written by hand to mirror what
-- drizzle-kit generate would produce from packages/db/src/schema.ts's runs/run_grid_cells
-- changes, plus a hand-maintained RLS section (drizzle-kit cannot express policies), matching
-- the split already established between 0000/0001 (schema) and 0002 (RLS).

-- ---------- runs: run limits (spec §10.3) ----------

alter table public.runs add column max_businesses integer;
alter table public.runs add column max_spend_cents integer;

-- ---------- run_grid_cells ----------

create type public.grid_cell_status as enum ('pending', 'done', 'saturated', 'failed');

create table public.run_grid_cells (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runs(id),
  parent_cell_id uuid, -- no FK — informational lineage only, matching businesses.merged_into
  depth smallint not null,
  center_lat double precision not null,
  center_lng double precision not null,
  radius_meters integer not null,
  status public.grid_cell_status not null default 'pending',
  result_count integer,
  searched_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create index run_grid_cells_run_id_idx on public.run_grid_cells (run_id);
create index run_grid_cells_run_status_idx on public.run_grid_cells (run_id, status);
create index run_grid_cells_parent_cell_id_idx on public.run_grid_cells (parent_cell_id);

-- ---------- RLS ----------
-- Same treatment as provider_calls: internal pipeline detail, written by the discovery job
-- (service role, bypasses RLS entirely), not something a member needs row-level access to for
-- day-to-day work — the run's own aggregate counters/stage_status (already select-visible to
-- everyone via the existing runs_select policy) is what the UI shows. Admin-only covers the rare
-- case of a human inspecting cell-level detail directly.

alter table public.run_grid_cells enable row level security;

create policy run_grid_cells_admin_only on public.run_grid_cells
  for all to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
