-- A checklist rule is scoped by industry, which is what that column has always held.
--
-- Applied as migration 0021_checklists_scope_by_industry.
--
-- Its values are industries ("Printing"), not the names of the operator's rules. Now that a
-- business carries its ICP's name, leaving the column called `category` would have left three
-- working rules silently matching nothing. Renamed instead, so every rule keeps judging exactly
-- the businesses it judged before: the industry lives on the ICP, and the ICP is on the business.

alter table public.page_checklists rename column category to industry;
