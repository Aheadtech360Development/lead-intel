-- Let the ledger record what a call actually cost, including fractions of a cent.
--
-- `cost_cents` was an integer, and every writer rounded to it. That was tolerable while the only
-- paid source was Google Places at 3.5¢ (recorded as 4¢ — a 14% overstatement nobody noticed).
-- It stops being tolerable now: an Instagram profile lookup costs **0.26¢**, which rounds to
-- zero. A hundred and sixty of them would have been recorded as $0.00 spent.
--
-- The ledger is the only source of truth in this system for what has been spent — the dashboard,
-- the leads list and the cost document all read it rather than estimating. A ledger that rounds
-- sub-cent purchases to nothing is a ledger that says money was free.
--
-- numeric(12,4) holds ten-thousandths of a cent, which is finer than any provider prices at, and
-- is exact rather than floating point: summing 0.26 four thousand times must not drift.
alter table public.provider_calls
  alter column cost_cents type numeric(12, 4) using cost_cents::numeric(12, 4);

comment on column public.provider_calls.cost_cents is
  'Cost of this single call in cents, to four decimal places. Fractional on purpose: an Instagram '
  'profile lookup is 0.26 cents and rounding it to an integer would record it as free.';
