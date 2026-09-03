# Setup — Phase 1

**Local Business Lead Intelligence System.** This covers getting the repo running and applying
the first migration to a real Supabase project. Nothing here needs a Google API key — Phase 1
is data model and identity logic only, and `packages/core`'s tests don't touch a database at
all (see `pre-build-risks-and-api-limits.md` §5 for what's needed at each later phase).

---

## 1. Install

```bash
npm install
```

Node 20+ required. No `pnpm` — this repo uses npm workspaces, since that's what was already on
the machine and there was no reason to add a second package manager.

## 2. Run the tests

```bash
npm run test        # 69 tests, packages/core only — pure functions, no network, no database
npm run typecheck    # all workspaces
```

## 2b. Build the packages before running the web app

`packages/shared`, `packages/core`, and `packages/db` ship compiled `dist/` output (gitignored,
not committed) — Turbopack cannot resolve their raw `.ts` source directly, since those packages
use Node's `NodeNext` module resolution (`.js` extensions in relative imports, correct once
compiled, unresolvable before that). Build them once after a fresh clone, and again any time you
change their source:

```bash
npm run build:packages
```

`apps/web`'s own `npm run dev` does NOT run this for you — if `/records/new` fails to compile
with a "module not found" error pointing at `@lead-intel/core`, this is why.

Both should be green before you touch Supabase. If they aren't, stop here — everything after
this point assumes the identity and normalisation logic is already correct.

## 3. Create the Supabase project

1. [supabase.com](https://supabase.com) → New project.
2. Pick a region close to where the app will run (US region, given the target market).
3. Save the database password somewhere real — it's shown once.

## 4. Get the connection string

Project → **Connect** → copy the connection string under **ORMs** for **Drizzle** (or under
**Connection string** if that's the label your project shows).

Two pooled connection modes exist; use them correctly or migrations will fail in confusing ways:

| Mode | Port | Use for |
|---|---|---|
| **Session pooler** or direct connection | 5432 | Running migrations (`drizzle-kit generate` / `migrate`) |
| **Transaction pooler** | 6543 | The running application (Trigger.dev workers) |

For Phase 1, you only need the migration connection.

## 5. Fill in `.env`

```bash
cp .env.example .env
```

Edit `.env` and set:

```
DATABASE_URL=<the session-pooler or direct connection string>
SUPABASE_URL=<Project Settings -> API -> Project URL>
SUPABASE_ANON_KEY=<Project Settings -> API -> anon/public key>
SUPABASE_SERVICE_ROLE_KEY=<Project Settings -> API -> service_role key>
```

Leave every Google/Trigger.dev/Anthropic/SERP line blank — none of them are needed yet.

**The service role key bypasses every access rule in the database.** It exists in `.env` only
so it's ready for Phase 2/3 when Trigger.dev needs it. It must never end up in anything the
browser loads — see build guide §3.7 and `pre-build-risks-and-api-limits.md`.

## 6. Generate and apply the first migration

```bash
cd packages/db
npm run generate   # reads schema.ts, writes SQL into packages/db/drizzle/
npm run migrate     # applies it to the database at DATABASE_URL
```

`generate` produces a plain SQL file — read it before running `migrate` the first time. It
should create: `runs`, `businesses`, `identity_keys`, `field_metadata`, `exclusions`,
`suppression_hashes`, `merge_snapshots`, `provider_calls`, `outcomes`, and 13 enum types.

## 7. Confirm it worked

```bash
npm run studio
```

Opens Drizzle Studio in the browser, pointed at the real database. You should see all nine
tables, empty. Check `identity_keys` has a unique index on `(key_type, key_value)` — that
constraint is the one thing in this whole schema that must never be silently missing.

## What's deliberately not done yet

- **No Row Level Security policies.** Every table is currently wide open to anyone with the
  anon key. That's fine for now because nothing is deployed and nobody but you has the key.
  RLS is explicit Phase 2 scope (build guide §3.7) — do not skip it when Phase 2 starts.
- **No seed data.** Phase 0's manual research (40 businesses) becomes the first import once
  it exists.
- **No API keys beyond Supabase.** See `pre-build-risks-and-api-limits.md` §5 for exactly when
  each one gets added — Google Places isn't needed until Phase 3.

## Phase 3 — Discovery (Google Places + Trigger.dev)

Two accounts, neither optional, both need care before the first real call — read
`pre-build-risks-and-api-limits.md` §0 first if you haven't. Nothing here is needed for Phase
1/2 work above; only for `/search`.

### 8. Google Cloud — Places API (New) + PageSpeed Insights API

**No billing account is required.** An earlier version of this file said to enable billing and
the Geocoding API; both turned out to be unnecessary and neither is used any more. The Geocoding
API *does* demand billing, which is exactly why the centre of a search is now resolved with a
Places Text Search instead (`packages/providers/src/google-places/resolve-center.ts`). With no
card on the account the worst case is that an API stops answering — it cannot run up a bill.

1. [console.cloud.google.com](https://console.cloud.google.com) → **New project**. Use a project
   dedicated to this system only, so a runaway quota or a compromised key can't touch anything
   else.
2. **APIs & Services → Library** → enable exactly two:
   - **Places API (New)** — the grid search, and the paid listing lookups behind the S/R checks.
   - **PageSpeed Insights API** — the mobile speed checks (W6, W7). Free, generous daily quota.
3. **Set quota limits before creating the key** — APIs & Services → Places API (New) → Quotas:
   cap requests/day at something small to start (2,000/day per pre-build-risks §0). This is the
   step that actually stops a runaway bill if billing is ever switched on later; a budget alert
   only tells you after the money is gone.
4. **APIs & Services → Credentials → Create API key.** Restrict it (Edit key → API restrictions)
   to only those two APIs — nothing else.
5. Add the key to `apps/jobs/.env`:
   ```
   GOOGLE_PLACES_API_KEY=<the restricted key>
   ```
   One key covers both APIs (`packages/providers/src/config.ts` reads it once).

**What this key cannot get you, and why it is not a bug.** Places returns HTTP 200 with an empty
body for `photos` and `reviews` on this project — verified against three of our own businesses and
then against a Starbucks with 2,243 ratings, which is what ruled out "those businesses have none".
So checks S4, R3, R4 and R5 report themselves *not measured* with that reason rather than guessing.
S2 and N7 (is the listing claimed?) have no field in the API at all.

### 9. Trigger.dev — the discovery task's runtime

1. [trigger.dev](https://trigger.dev) → sign up → **New project**.
2. Copy the project ref (Project settings) into `apps/jobs/trigger.config.ts`, replacing the
   placeholder:
   ```ts
   project: "proj_...",
   ```
   This ref is a public identifier, not a secret — it's fine to commit.
3. From `apps/jobs`, put your local task runtime's own env vars in `apps/jobs/.env` (the CLI
   reads `.env`/`.env.local` from the directory `trigger.config.ts` lives in — a **separate**
   file from the repo-root `.env`, same reason `apps/web` needs its own `.env.local`):
   ```
   DATABASE_URL=<the TRANSACTION POOLER string, port 6543 — not the direct connection>
   GOOGLE_PLACES_API_KEY=<the same key from step 8>
   ```

   **Use the transaction pooler here, not the direct connection.** A discovery run makes
   thousands of small queries over several minutes; on a direct connection (port 5432) Supabase
   resets it mid-run, which killed the first real Dallas run —
   `could not receive data from client: Connection reset by peer` in the Postgres logs at the
   exact second the task died. Supabase dashboard → **Connect** → **Transaction pooler**.
   Remember to URL-encode any special characters in the password (`@` → `%40`, `/` → `%2F`);
   an unencoded one silently breaks the string apart in the wrong place.
4. Run the dev worker from `apps/jobs`:
   ```bash
   npm run dev --workspace=@lead-intel/jobs
   ```
   First run opens a browser to link the CLI to your Trigger.dev account/project — follow the
   prompt. Leave this running; it's what actually executes the `discovery` task when
   `apps/web` enqueues one.
5. For `apps/web` to *enqueue* a run (`tasks.trigger(...)` in
   `apps/web/app/search/confirm/actions.ts`), it needs its own key — Trigger.dev dashboard →
   your project → **API Keys** → copy the **dev** secret key into `apps/web/.env.local`:
   ```
   TRIGGER_SECRET_KEY=tr_dev_...
   ```
   This is different from step 4's browser-login flow — that authenticates the CLI itself;
   this key is what a non-interactive server action uses to reach the same project.

### 10. The first real run

Do not point `/search` at a 200-mile radius on day one. Per pre-build-risks-and-api-limits.md
§4: **10 miles, one niche, one city.** Start the run, then read back from `/search/runs/<id>`
and the database directly rather than trusting the estimate:

- How many search requests were actually made (`provider_calls` for that `run_id`)
- How many businesses came back, and how many had `has_website_field: false`
- How many grid cells saturated (`run_grid_cells` — admin-only via RLS; check with the
  `get_advisors`/`execute_sql` MCP tools or as the admin account)
- How long the whole run took

Scale the radius up only after those are real numbers, not estimates.

## If something goes wrong

- **`drizzle-kit` can't connect** — almost always the wrong port (6543 vs 5432) or a password
  with a character that needs URL-encoding. Copy the connection string exactly as Supabase
  shows it rather than reconstructing it by hand.
- **Migration fails on the enum types** — Postgres enums can't be altered inside the same
  transaction they're created in for some operations. If you hit this, it means the schema
  changed between `generate` runs without a clean migration path; delete the half-applied
  migration, fix the schema, and regenerate rather than patching the SQL by hand.
