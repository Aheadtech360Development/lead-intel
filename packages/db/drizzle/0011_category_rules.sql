-- Categories the operator defines, and the rules that assign them.
--
-- Instagram publishes exactly one category per account — "Clothing (Brand)", "Shopping & Retail" —
-- chosen by the owner from Meta's own list. There is no second level, so "t-shirts, within
-- fashion" does not exist anywhere to be fetched. The operator asked to define that themselves and
-- to control how a business gets sorted into it, which is what this table is.
--
-- Rules are ordered and the first match wins. `businesses.category_rule_id` records **which** rule
-- decided, so a category on a record is never something the operator has to take on trust — they
-- can see the rule, change it, and re-run.

create table public.category_rules (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null,

  -- What this rule is for, in the operator's words.
  name text not null,
  category text not null,
  subcategory text,

  -- Lower runs first, and the first rule that matches wins. Ties break on created_at so the order
  -- is always total and never depends on row order.
  priority integer not null default 100,
  enabled boolean not null default true,

  /*
   * Where to look. Any subset of: business_name, website_text, website_domain, instagram_bio,
   * instagram_category, instagram_handle, meta_ads_text.
   *
   * Empty means every source, which is the useful default — an operator writing their first rule
   * is thinking about the word, not about which field carries it.
   */
  sources text[] not null default '{}',

  -- Matches when ANY of these appear. Case-insensitive, whole-word where the term is a word.
  any_of text[] not null default '{}',
  -- ...and NONE of these do. The escape hatch for a term that is right except in one context.
  none_of text[] not null default '{}',

  -- Optional numeric gates, so "fashion brands with a real following" is expressible.
  min_followers integer,
  max_followers integer,

  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index category_rules_order_idx on public.category_rules (enabled, priority, created_at);

alter table public.businesses
  add column category text,
  add column subcategory text,
  -- Which rule decided. `on delete set null` because deleting a rule must not delete businesses,
  -- and a category whose rule is gone is exactly the thing worth showing as stale.
  add column category_rule_id uuid references public.category_rules (id) on delete set null,
  add column categorised_at timestamp with time zone;

create index businesses_category_idx on public.businesses (category, subcategory);

comment on column public.businesses.category_rule_id is
  'The rule that assigned this category. Null when no rule matched, or when the rule that matched '
  'has since been deleted — both of which mean the category should be re-evaluated, not trusted.';

-- Rules are team-wide settings rather than one person''s working notes: everyone signed in reads
-- the same categories, because two operators sorting the same business differently is the problem
-- this table exists to remove.
alter table public.category_rules enable row level security;

create policy category_rules_select on public.category_rules
  for select to authenticated using (true);
create policy category_rules_insert on public.category_rules
  for insert to authenticated with check (created_by = (select auth.uid()));
create policy category_rules_update on public.category_rules
  for update to authenticated using (true) with check (true);
create policy category_rules_delete on public.category_rules
  for delete to authenticated using (true);
