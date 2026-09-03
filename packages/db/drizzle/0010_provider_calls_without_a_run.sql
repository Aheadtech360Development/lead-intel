-- A paid call does not always belong to a discovery run.
--
-- `run_id` has been NOT NULL since Phase 1, when every provider call came from one: a run searched
-- the grid, and everything bought was bought on its behalf. Two things have happened since. The
-- operator can buy data for businesses they tick by hand on the leads list, which belongs to no
-- run. And businesses can arrive from a CSV, which gives them no `discovered_in_run` at all — so
-- for those there is not even a run to borrow.
--
-- Instagram is the first source that will routinely be bought for imported businesses, and it
-- would have failed on the not-null constraint at the moment of purchase. The honest shape is a
-- nullable column: null means "not part of a run", which is true, rather than a run id invented to
-- satisfy a constraint.
alter table public.provider_calls alter column run_id drop not null;

comment on column public.provider_calls.run_id is
  'The discovery run this call was made for, or null when it was not part of one — an operator '
  'buying data for businesses they selected by hand, or for a business that arrived from a file.';
