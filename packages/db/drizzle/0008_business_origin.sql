-- Where each business came from.
--
-- The operator asked for this directly: "usko 209 business ke saath nahi milana, alag se rakhna,
-- taake mujhe pata ho ke konse files se diye aur konse khud nikal kar analyse karaye". Until now
-- a business found by a Maps search and one typed out of a spreadsheet were indistinguishable in
-- the list, which matters more than tidiness — the two are not scored on the same evidence. An
-- imported record has no Google `place_id`, so its SEO and REP areas can never clear the coverage
-- floor, and a Problem score built from four areas looks identical to one built from six.
--
-- Provenance already existed per *field* (`field_metadata.source_name`), but not per business, and
-- a field-level answer cannot be filtered on or counted.

create type public.business_origin as enum ('discovered', 'imported', 'manual');

alter table public.businesses
  add column origin public.business_origin not null default 'discovered',
  -- Which file. Null for everything else. `on delete set null` because a batch is a short-lived
  -- record of an upload and the businesses it created must outlive it.
  add column import_batch_id uuid references public.import_batches (id) on delete set null;

-- Backfill from evidence rather than assumption. `discovered_in_run` is set only by the discovery
-- job, so its absence is the record of a business that arrived some other way. At the time of
-- writing that is 207 with a run and 2 without — "Aheadtech360" and "AF Apparel", both carrying
-- `manual_entry` field sources, which is exactly what the rule below claims about them.
update public.businesses
   set origin = (case when discovered_in_run is null then 'manual' else 'discovered' end)::public.business_origin;

-- The list filters on this and counts by it, so it is worth an index alongside the status filter
-- that every one of those queries also carries.
create index businesses_origin_idx on public.businesses (origin, status);

comment on column public.businesses.origin is
  'Where this record was created: a Maps search, a CSV import, or typed by hand. A row that was '
  'created by discovery and later topped up from a file stays ''discovered'' — the import added '
  'fields to it, it did not create it, and field_metadata.source_name records that separately.';
