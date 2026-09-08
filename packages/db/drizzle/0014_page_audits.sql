-- One row per page audited, per business.
--
-- Separate from `findings` on purpose. A finding is one check's verdict about a business; this is a
-- description of one page, and several checks will eventually read from it. Folding page structure
-- into findings would mean re-deriving the header every time a rule asks about it, and would make
-- "what does their contact page look like" a query nobody can write.
--
-- `structure` and `layout` are jsonb rather than columns because both are shapes that will change
-- as checklists ask new questions. The alternative is a migration every time the operator wants a
-- rule about something the extractor already saw — see PageStructure and LayoutFacts for what they
-- hold today.

create table public.page_audits (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,

  url text not null,
  final_url text,
  -- home | services | products | pricing | about | contact | reviews | blog | other
  page_type text not null,
  -- certain | likely | guess. A checklist may want to skip anything it only guessed at.
  type_confidence text not null,
  -- Why this page was fetched and why it was typed that way, in words, so a wrong audit can be
  -- traced rather than argued with.
  chosen_because text,
  type_because text,

  -- ok | unreachable | http_error | timeout | blocked_by_robots | browser_failed
  outcome text not null,
  http_status integer,
  -- Null for anything but `ok`. A partial page produces findings about a page that never loaded.
  structure jsonb,
  layout jsonb,
  -- Kept for home and product pages only; every other page's screenshot is shown to the model and
  -- discarded. Storage is the constraint that arrives first.
  screenshot_path text,

  console_errors jsonb,
  failed_requests jsonb,

  elapsed_ms integer,
  detail text,
  rendered_at timestamp with time zone not null default now()
);

-- One audit per page per business. Re-auditing updates rather than accumulating, so a record never
-- shows the same page twice with two different verdicts.
create unique index page_audits_business_url_unique on public.page_audits (business_id, url);
create index page_audits_business_idx on public.page_audits (business_id, page_type);

alter table public.page_audits enable row level security;

-- Read by everyone signed in, written by the worker. Same shape as `findings`: the audit is team
-- data, and nothing an operator does in the browser should be able to rewrite what was measured.
create policy page_audits_select on public.page_audits
  for select to authenticated using (true);
create policy page_audits_insert on public.page_audits
  for insert to authenticated with check (true);
create policy page_audits_update on public.page_audits
  for update to authenticated using (true) with check (true);
