-- ICPs replace categories.
--
-- Applied to the project database as migration 0020_icps_replace_categories. Kept here so the
-- schema's history reads in one place.
--
-- An ICP is the operator's own description of a customer they want, and it now carries both halves
-- of that in one row: the words it is searched for on Google Maps, and the words and conditions
-- that decide whether a business already in the list is one. Categories were the same idea under a
-- narrower name and with no sourcing terms.
--
-- `subcategory` is dropped rather than carried: in every rule the operator had written it repeated
-- the rule's own name ("Embroidery" / "Embroidery"), so it held nothing the ICP name does not.
-- `businesses.icp_name` is corrected in the same step, because the old column held the industry
-- ("Printing") rather than the thing that decided it.

alter table public.category_rules rename to icps;
alter index category_rules_order_idx rename to icps_order_idx;
alter policy category_rules_select on public.icps rename to icps_select;
alter policy category_rules_insert on public.icps rename to icps_insert;
alter policy category_rules_update on public.icps rename to icps_update;
alter policy category_rules_delete on public.icps rename to icps_delete;

alter table public.icps rename column category to industry;
alter table public.icps drop column subcategory;

alter table public.icps
  add column search_terms text[] not null default '{}',
  add column requires_website boolean not null default false,
  add column min_reviews integer,
  add column places text[] not null default '{}';

alter table public.businesses rename column category to icp_name;
alter table public.businesses rename column category_rule_id to icp_id;
alter table public.businesses rename column categorised_at to icp_matched_at;
alter table public.businesses drop column subcategory;

update public.businesses b
set icp_name = i.name
from public.icps i
where b.icp_id = i.id;
