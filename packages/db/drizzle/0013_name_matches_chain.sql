-- A chain the domain guard cannot see, because it has no domain.
--
-- `shared_domain` catches a national chain by its website: one domain belongs to one company, so
-- matching on it is safe. That guard is blind to a chain whose Google listing carries no website at
-- all — and the demand rule added alongside this migration promotes exactly those businesses, since
-- "no website plus proven demand" is its whole premise.
--
-- It surfaced immediately. "Office Depot Print & Copy Services" reached Tier 1 on 4.3 stars from 77
-- reviews with no domain for `sharedPlatformDomain` to match, sitting among eighteen genuine local
-- leads.
--
-- This reason is raised and never acted on. Names are not domains: "Michaels" is a craft chain and
-- also the possessive of a very common first name, and a product whose entire list is independent
-- local businesses cannot silence "Michael's Braids" to catch it. So the record is flagged, stays
-- exactly where the scoring put it, and a human settles it in two seconds.

alter type public.manual_review_reason add value if not exists 'name_matches_chain';
