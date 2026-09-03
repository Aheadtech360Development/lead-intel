-- Phase 4 — a manual-review reason for listings whose website is a platform or a chain.
--
-- Google Places returns whatever website a listing declares, and for many small businesses that
-- is a booking-platform profile (booksy.com, a .square.site subdomain) or a chain's store-locator
-- page (local.targetoptical.com). Every check then runs happily and produces findings about that
-- site, filed under a local business. In the first scored run six such records passed the Stage 5
-- gate and one of only two Tier 1 leads was local.targetoptical.com.
--
-- The flag is the fix here; the identity keys are deliberately left alone. identity_keys is
-- unique per domain, so these entries are also distorting deduplication — unpicking that is a
-- data decision for a human, not a side effect of scoring.

alter type public.manual_review_reason add value if not exists 'shared_domain';
