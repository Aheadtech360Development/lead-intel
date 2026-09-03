-- CSV import — a short-lived record of one uploaded file.
--
-- Exists so the preview an operator approves and the rows that actually get imported are the same
-- object, rather than the file being parsed once to show a preview and again to do the work. Two
-- parses of the same bytes should agree, but "should" is not a guarantee worth resting an import
-- on, and holding the parse also lets the confirm step happen without any client-side JavaScript.

create type public.import_batch_status as enum ('pending', 'imported', 'discarded');

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,
  filename text,
  parsed jsonb not null,
  status public.import_batch_status not null default 'pending',
  row_count integer not null default 0,
  created_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone
);

create index import_batches_created_by_idx on public.import_batches (created_by, created_at desc);

-- A batch is one person's work in progress, not shared team data: only its creator may see or act
-- on it. Everything it eventually produces lands in `businesses`, which has its own policies.
alter table public.import_batches enable row level security;

create policy import_batches_own_select on public.import_batches
  for select to authenticated using (created_by = (select auth.uid()));
create policy import_batches_own_insert on public.import_batches
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy import_batches_own_update on public.import_batches
  for update to authenticated using (created_by = (select auth.uid())) with check (created_by = (select auth.uid()));
create policy import_batches_own_delete on public.import_batches
  for delete to authenticated using (created_by = (select auth.uid()));
