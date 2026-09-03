-- Phase 4 — findings: one row per §5 check per business
--
-- Applied directly via Supabase MCP apply_migration, matching the path 0000-0003 took. Written
-- by hand to mirror packages/db/src/schema.ts, plus a hand-maintained RLS section (drizzle-kit
-- cannot express policies), following the split already established in this directory.

-- ---------- enums ----------
-- Values mirror packages/shared/src/enums.ts exactly (CHECK_FAMILIES, CHECK_OUTCOMES,
-- CHECK_COST_CLASSES), which is the single source of truth for both sides.

create type public.check_family as enum ('W', 'K', 'S', 'R', 'O', 'D', 'N');
create type public.check_outcome as enum ('fired', 'passed', 'not_measured', 'not_applicable');
create type public.check_cost_class as enum ('FREE', 'PAID', 'BEST_EFFORT');

-- ---------- findings ----------

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  check_id text not null, -- "W4", "K1", ... — catalogue lives in packages/core, not in an enum
  family public.check_family not null,
  area public.service_area, -- null for the N (Intent) family, which feeds no service area
  outcome public.check_outcome not null,
  cost_class public.check_cost_class not null,
  points integer not null default 0,
  max_points integer not null default 0,
  evidence text,
  detail jsonb,
  source_name text not null,
  run_id uuid references public.runs(id),
  measured_at timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  -- Spec §6.1: "A check that could not run — blocked, timed out, not applicable — is left out of
  -- BOTH sides. It never counts as a pass and never counts against the business." That is the
  -- rule this constraint makes unwritable-around, rather than a promise application code keeps:
  --   fired          -> 0 < points <= max_points   (both sides)
  --   passed         -> points = 0, max_points > 0 (denominator only)
  --   not_measured   -> zero, zero                 (neither side)
  --   not_applicable -> zero, zero                 (neither side)
  constraint findings_points_match_outcome check (
    (outcome in ('not_measured', 'not_applicable') and points = 0 and max_points = 0)
    or (outcome = 'passed' and points = 0 and max_points > 0)
    or (outcome = 'fired' and points > 0 and points <= max_points)
  )
);

-- One current result per (business, check). Re-auditing replaces a finding; findings are the
-- current state of what we know, not an append-only log — the same model as field_metadata.
create unique index findings_business_check_unique on public.findings (business_id, check_id);
create index findings_business_id_idx on public.findings (business_id);
create index findings_business_area_idx on public.findings (business_id, area);
create index findings_run_id_idx on public.findings (run_id);

-- ---------- RLS ----------
-- Same shape as field_metadata: findings are what the operator reads on the business page and
-- what the opening line is drawn from, so every signed-in user can see and write them. Deleting
-- one is admin-only — removing a finding changes a score, and that should be deliberate.

alter table public.findings enable row level security;

create policy findings_select on public.findings
  for select to authenticated
  using (true);

create policy findings_insert on public.findings
  for insert to authenticated
  with check (true);

create policy findings_update on public.findings
  for update to authenticated
  using (true)
  with check (true);

create policy findings_delete on public.findings
  for delete to authenticated
  using ((select private.is_admin()));
