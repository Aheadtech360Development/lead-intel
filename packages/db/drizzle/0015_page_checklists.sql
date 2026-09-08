-- What the operator says a good page looks like.
--
-- Keyed by page type AND category, not page type alone. A services page for a print shop and a
-- services page for a dentist are judged on different things, and this list will not stay
-- printing-only — the operator said so outright while planning. A rule with a null category is
-- universal, which is where "every page needs exactly one h1" belongs.
--
-- `field` is constrained by the application, not the database: CHECKABLE_FIELDS in
-- packages/core/src/pages/checklist.ts is the closed list the editor offers, and a rule naming
-- anything else reports itself as broken rather than silently never firing.

create table public.page_checklists (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,

  name text not null,
  -- null = applies to every page type
  page_type text,
  -- null = applies to every category
  category text,

  field text not null,
  -- present | absent | is_true | is_false | at_least | at_most | equals
  test text not null,
  value integer,

  weight integer not null default 10,
  enabled boolean not null default true,
  -- The sentence an operator reads when this fails, and may repeat on a call. Written by them.
  says text not null,

  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index page_checklists_lookup on public.page_checklists (enabled, page_type, category);

alter table public.page_checklists enable row level security;

create policy page_checklists_select on public.page_checklists
  for select to authenticated using (true);
create policy page_checklists_insert on public.page_checklists
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy page_checklists_update on public.page_checklists
  for update to authenticated using (true) with check (true);
create policy page_checklists_delete on public.page_checklists
  for delete to authenticated using (true);
