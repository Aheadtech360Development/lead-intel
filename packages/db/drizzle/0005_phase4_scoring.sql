-- Phase 4 — scoring: Problem, Intent, tier, route and the Stage 5 gate on businesses
--
-- Applied directly via Supabase MCP apply_migration, matching the path 0000-0004 took. Written
-- by hand to mirror packages/db/src/schema.ts. No RLS section is needed: these are columns on
-- `businesses`, which already has its policies from 0002.

create type public.service_route as enum (
  'web_development', 'local_seo', 'reputation', 'contactability', 'social_media', 'advertising'
);

-- Every column is nullable and STAYS null when nothing was measured well enough to support it.
-- §6.1: "An area judged on one working check is noise." A zero in problem_score would be a claim
-- — that we looked and found no problems — and these columns must never make that claim about a
-- business whose website could not be read. The distinction between "scored 0" and "not scorable"
-- is the whole reason these are nullable rather than defaulted.
alter table public.businesses add column problem_score double precision;
alter table public.businesses add column intent_score integer;
alter table public.businesses add column tier smallint;
alter table public.businesses add column route public.service_route;
alter table public.businesses add column route_reason text;
alter table public.businesses add column area_scores jsonb;
alter table public.businesses add column scored_at timestamp with time zone;

alter table public.businesses add constraint businesses_tier_range
  check (tier is null or (tier between 1 and 4));
alter table public.businesses add constraint businesses_problem_score_range
  check (problem_score is null or (problem_score between 0 and 100));
alter table public.businesses add constraint businesses_intent_score_range
  check (intent_score is null or (intent_score between 0 and 100));

-- §8.1: "Sorted by tier, then Problem score." The list's default ordering, and therefore the one
-- query that must not table-scan as the dataset grows.
create index businesses_tier_problem_idx on public.businesses (tier, problem_score);
create index businesses_route_idx on public.businesses (route);
