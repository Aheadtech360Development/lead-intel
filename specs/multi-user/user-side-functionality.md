# Lead Intel — complete user-side functionality

Extracted from the project as it stands, not designed. Every figure, check id, price and screen
name below was read out of the code, the database or the agreed specs — the sources are named in
§26 so anything here can be checked.

**Read this first, because it changes what "user" means:**

| | State today |
|---|---|
| Accounts in the live product | **One.** `user_roles` holds a single `admin` row |
| Role logic in the web app | **None built.** No screen, filter or action checks a role |
| Row-level security | On every table, but `SELECT` is `true` — everyone who signs in sees everything |
| The two-role model (admin / member) | **Agreed and specified**, not built — `specs/multi-user/spec.md` |

So this document describes **what a member will be able to do**, built from (a) the functionality
that exists and works today, and (b) the permission model already decided. Where a capability
exists but the member-side restriction is specified rather than built, it says so.

---

## 1. User Side overview

A member is a salesperson. The product's job for them is: *here are businesses worth calling,
here is what is wrong with each one, here is what to say, and here is where to record what
happened.*

They do not find businesses — that is admin-only and costs money. They receive leads, learn about
them with free analysis, buy a small amount of extra data within a budget, call, and record the
outcome.

**What a member owns:** their leads, their tasks, their calls, their spend, their notifications.
Nothing of another member's is visible to them in any form — no counts, no totals, no leaderboard.
The single exception is the Showcase screen, where people post deliberately.

---

## 2. Complete feature list

Every user-facing capability, with where it exists today.

| # | Feature | Built today | Member restriction |
|---|---|---|---|
| 1 | See leads, search, filter, sort, paginate | yes, `/records` | own leads only *(specified)* |
| 2 | Lead detail, four tabs | yes, `/records/[id]` | own leads only *(specified)* |
| 3 | Claim / release a lead | yes | — |
| 4 | Add a business by hand | yes, `/records/new` | — |
| 5 | Import a CSV | yes, `/records/import` | — |
| 6 | Search Google Maps for businesses | yes, `/search` | **admin only** *(specified)* |
| 7 | Analyse a website (free) | yes | own leads only *(specified)* |
| 8 | Read pages in a real browser | yes | own leads only *(specified)* |
| 9 | Re-score | yes | own leads only *(specified)* |
| 10 | Buy Google listing details | yes, `/records/enrich` | within budget *(specified)* |
| 11 | Buy Instagram profile | yes | within budget *(specified)* |
| 12 | Buy Meta ads data | built, **never once run** | within budget *(specified)* |
| 13 | See the 64 checks and their evidence | yes | — |
| 14 | See Problem / Signals scores and priority | yes | — |
| 15 | Read the model's take on a page | yes | — |
| 16 | Log a call and its outcome | yes | own leads only *(specified)* |
| 17 | See tasks, progress, stop one | yes, `/tasks` | own tasks only *(specified)* |
| 18 | See ICPs | yes, `/icps` | read-only *(specified)* |
| 19 | See checklists | yes, `/checklists` | read-only *(specified)* |
| 20 | See priority rules | **not built** — specified | read-only *(specified)* |
| 21 | See spend | yes, `/spend` | own spend + own budget *(specified)* |
| 22 | Export leads to CSV | yes, `/records/export` | own leads only *(specified)* |
| 23 | Read How it works | yes, `/rules` | — |
| 24 | Light / dark / system theme | yes | — |
| 25 | Sign out | yes | — |
| 26 | Notifications | **not built** — specified | own only *(specified)* |
| 27 | Ask to transfer leads to a colleague | **not built** — specified | needs admin approval |
| 28 | Showcase | **not built** — specified | — |
| 29 | Profile, password, preferences | **Not found in provided files** beyond theme | — |

---

## 3. Dashboard functionality

Screen: `/dashboard`. Built today as a single-operator view; the member version is specified in
`design-brief.md` §2 but not built.

**What it shows today** — four stage columns, in the order the product works:

| Stage | Figures on it |
|---|---|
| Sourcing | how many businesses, how many from search / import / by hand |
| Filtering | how many match each ICP, how many match none |
| Analysis | how many analysed, how many never analysed, website status split |
| Enrichment | what has been bought, what it cost, by provider |

Plus: **breakdowns** (by priority, by what to sell, by website status, by ICP) each linking into
the filtered leads list; **next actions** — one line each with a single button; **spend by
provider**, grouped by who bills it.

**KPIs present:** total businesses · worth calling (passed the gate) · priority 1 count · not
scored · total spent.
**Recommendations / alerts:** the "next actions" cards and the "N businesses have never been
analysed" strip on the leads screen.
**Recent activity:** **Not found in provided files** on the dashboard — activity exists only as the
running-task banner and the per-lead history.

---

## 4. Leads / businesses

Screen: `/records`. Built as three steps — *choose · tick · act*.

**What the list shows per row:** priority badge · business name, town, website status · what to
sell and why · Problem and Signals scores as bars · how many of the 64 checks were answered · ICP ·
Instagram status · contact status · claim state. Rows are tinted by situation (reviews only, no
website, no Instagram, has both).

**Ordering:** priority first, then Problem score descending. A "group by colour" toggle regroups by
situation. **Page size 50.**

**Filters (14):** Show (worth calling / everything / not analysed) · Priority 1–4 · What to sell
(6 routes) · Website status (5) · ICP · Google reviews (none / 1+ / 20+ / 50+) · Where (town or
state, matched loosely) · Instagram & ads (running ads / not / follower floor) · Where from
(search / file / by hand) · One file (an import batch) · One ICP rule · Claimed (anyone / mine /
nobody) · free-text search `q` · sort.

**Two filters exist and are switched off on purpose:** Budget and Revenue. Nobody publishes what a
small private business earns or spends. They stay visible with the reason on hover rather than
being hidden.

**Bulk actions on ticked rows:** analyse (free) · read pages in a browser (Gemini cost) · buy paid
data (priced) · export · claim. Each action states its price and who bills it before it starts.

**Lead detail** (`/records/[id]`) — four tabs carried in the URL:
1. **Overview** — why they are worth calling, what to say, and everything known with the source of
   each fact
2. **Website pages** — each page opened, its type, outcome, screenshot, and the model's read
3. **Checks & scores** — all checks with evidence, grouped by area
4. **Calls & history** — call log and every job that has touched this business

**Edit:** website URL and Instagram URL can be saved by hand (`saveInstagramUrl`,
`refreshWebsiteText`). A general "edit every field" form is **Not found in provided files**.
**Delete / archive:** **Not found in provided files** for a user. Deletion exists at the database
level as an admin-only RLS policy.

---

## 5. Add businesses

Three ways in. Two are free.

### 5.1 By hand — `/records/new`
Type a name, town, website, phone. The record is created immediately with origin `manual`.
Free. No confirmation step.

### 5.2 Import a CSV — `/records/import` → `/records/imports/[id]`
1. Upload a file (`uploadImport`). Options on the form: **analyse the websites afterwards**,
   **apply ICPs afterwards**, **look up Instagram afterwards**, and a note for the batch.
2. The file is read and every row matched against what is already stored.
3. A review screen shows what would be created, what already exists, and what is rejected.
4. `confirmImport` creates them; `discardImport` throws the upload away.
5. The import's own page lists: created, already had, rejected with a reason per row.
Free. `deleteImportBatch` removes a batch record.

**Known limitation, stated on the screen:** a spreadsheet carries no Google place id, so for
imported businesses SEO and REP checks cannot run — **36% of the Problem score's weight has no
source** until the listing is bought.

### 5.3 Search Google Maps — `/search` → `/search/confirm` → `/search/runs/[id]`
**Admin only** under the agreed model.
Inputs: ICP (or a free-text niche), location, radius in miles, maximum businesses, **maximum spend
in dollars**. The confirm screen prices it before anything runs; the run page shows progress.
Each of the ICP's search words becomes its own run and the spend limit is split across them.
**Costs money** — see §21.

---

## 6. Website analysis

### How it starts
- Per business: *Analyse* on the lead, or *Read pages in a browser*
- In bulk: tick rows → analyse; or "Analyse them now" on the never-analysed strip
- Whole list: `analyseUnscored`, `auditEveryWebsite`, `rescoreEverything`
- Automatically after an import, if that box was ticked

### What runs, in order
1. **Crawl** — up to four pages (home, contact, socials, about) with a plain HTTP crawler, under
   robots rules. Free.
2. **Presence verdict** — one of five states: `live`, `dead`, `social_only`, `no_website`,
   `unclear`. *(The product never returns `no_website` from a crawl alone — see §8.)*
3. **64 checks** run against what was fetched.
4. **PageSpeed** — Google's own Lighthouse run. Free.
5. **YouTube** — channel presence. Free, limited to roughly 100 businesses a day by quota.
6. **Scoring** — arithmetic over the stored findings. Free, re-runnable.
7. **ICP matching** — free.

### Reading pages in a real browser (separate, optional)
Opens each page in Chromium, keeps screenshots for the home and product pages, extracts social
links, records console errors and failed requests, then asks Gemini what the measurements miss.
**35-second budget per page**; the home page gets one retry. Costs ~0.05¢ a page (Google AI
Studio).

### Results, errors, history
Every check stores its outcome, points, evidence and the source that produced it. A failed read is
recorded as `timeout`, `unreachable`, `http_error` or `browser_failed` with the reason, and every
check that needed it is marked **not measured** — never passed and never failed. Job history per
business is on the Calls & history tab.

### Re-analysis
Free and unlimited. Re-crawling replaces a business's findings rather than appending, so a site
that has since been fixed stops carrying the old problem.

---

## 7. Instagram / social / ads

### What exists
| Capability | Source | Status |
|---|---|---|
| Find an Instagram account | own crawl of their site's header/footer | free, built |
| Save an Instagram URL by hand | `saveInstagramUrl` | free, built |
| Instagram profile lookup | Apify `instagram-profile-scraper` | **0.26¢**, built, used 167 times |
| Meta Ad Library lookup | Apify `facebook-ads-scraper` | **11.6¢**, built, **never run** |
| YouTube channel | YouTube Data API | free, run on all 559 |
| Facebook page activity | — | **No source. Not found in provided files.** |

### What an Instagram lookup returns
`instagram_handle`, `instagram_followers`, `instagram_posts`, `instagram_category`,
`instagram_bio`, `instagram_link`, `instagram_verified`, `instagram_private`,
`instagram_checked_at`.

**What it cannot return:** post dates. So checks **O5** ("Instagram has gone quiet") and **N5**
("posted on social in the last 30 days") are written as *not measured* with that reason on the
record. This is documented in the code as a property of the actor, not a bug.

**Also impossible at any price, stated in the product:** who follows an account (Instagram
publishes a count, never a list), and ad spend for an ordinary business (Meta publishes spend only
for political and social-issue ads).

### What a Meta ads lookup returns
`meta_ads_running`, `meta_ads_active_count`, `meta_ads_total_count`, `meta_ads_since`,
`meta_ads_platforms`, `meta_ads_sample`, `meta_ads_spend_known` (always false).
It feeds checks **D5** and **N2**.

### Dedicated screen
`/instagram` — businesses grouped by: has an Instagram link · looked up · linked but never looked
up · no Instagram found. Filterable by follower floor. This is where a bulk lookup is started.

### Purchase, confirmation, failure
Buying goes through `/records/enrich`, which states what is bought, who bills it, the per-business
price, the total, and a **spend cap** (`capDollars`) that stops the run whatever happens. A failed
provider call is written to the ledger with `status: failed` and **is not charged**.

---

## 8. Checks / scores / priority

### The catalogue — **64 checks**, not 51
They are grouped into six scored areas plus one unscored intent family.

| Area | Checks | Points available | Weight in the Problem score |
|---|---|---|---|
| WEB — website quality | 12 | 468 | 0.24 |
| SEO — being found on Google | 14 | 283 | 0.20 |
| REP — reviews & reputation | 6 | 135 | 0.16 |
| CON — turning visitors into customers | 8 | 132 | 0.14 |
| SOC — social media | 8 | 178 | 0.14 |
| ADS — ads & tracking | 6 | 120 | 0.12 |
| **N — intent (no area)** | **10** | **135** | feeds the Signals score only |

By cost: **40 FREE · 19 PAID · 5 BEST_EFFORT.**

#### Every check

**WEB (12)** — W1 no website at all (100) · W2 dead or parked (100) · W3 social page only (90) ·
W4 no valid HTTPS (30) · W5 not mobile-friendly (35) · W6 slow on mobile (30) · W7 poor
performance score (25) · W8 dated platform (15) · W9 looks abandoned (15) · W10 barely a website
(15) · W11 no favicon (5) · W12 images have no alt text (8).
*W1–W3 are excluded from the WEB area score and handled by the presence override instead — see
below.*

**SEO (14)** — S1 no Google Business Profile (40, paid) · S2 listing unclaimed (30, paid) · S3 no
hours (15, paid) · S4 few or no photos (15, paid) · S5 no category (10, paid) · S6 listing has no
website link (20, paid) · S7 does not rank for its own name (25, paid) · S8 does not rank for
niche+city (25, paid) · S9 no local business markup (20) · S10 missing or duplicate title (12) ·
S11 no meta description (8) · S12 no sitemap (8) · S13 search engines blocked (40) · S14 city or
service missing from the title (15).

**REP (6)** — R1 very few reviews (35, paid, tiered) · R2 weak rating (30, paid, tiered) · R3
reviews dried up (25, paid) · R4 owner never replies (20, paid) · R5 slow review growth (15, paid)
· R6 no reviews shown on their own site (10).

**CON (8)** — K1 no phone on the site (30) · K2 phone not tap-to-call (12) · K3 no contact form
(20) · K4 no address (15) · K5 no opening hours (15) · K6 no map or directions (10) · K7 no email
(15) · K8 no way to request a quote or booking (15).

**SOC (8)** — O1 no social links (35) · O2 no Facebook page (25) · O3 Facebook gone quiet (25,
best effort) · O4 no Instagram (20) · O5 Instagram gone quiet (20, best effort) · O6 almost no
social footprint (15) · O7 nothing posted anywhere (30, best effort) · O8 no video content (8,
best effort).

**ADS (6)** — D1 no tracking of any kind (35) · D2 no Meta Pixel (20) · D3 no Google Ads tag (20)
· D4 no analytics (20) · D5 not currently advertising (15, paid) · D6 no retargeting (10).

**N — intent (10)** — N1 has a tracking pixel (20) · N2 running Meta ads (25, paid) · N3 review in
the last 30 days (15, paid) · N4 2+ reviews a month (10, paid) · N5 posted on social in 30 days
(15, best effort) · N6 website updated in 12 months (10) · N7 listing is claimed (10, paid) · N8
more than one location (10, paid) · N9 hiring (10) · N10 pays for a tool (10).

#### Checks that cannot be answered today — 17
**S2, S4, R3, R4, R5, N3, N4, N7, N8** — Google's API does not return individual reviews, review
dates, photo data or claimed status for this project's key. **At any price.**
**S7, S8** — need rank data; DataForSEO is not connected.
**O3, O7, N5** — need Facebook/social post dates; no source.
**O5** — needs Instagram post dates; the actor bought does not return them.
**D5, N2** — need the Meta ads lookup, which has never been bought.

Each is written onto the record as *not measured* with its reason.

### Outcomes a check can have
`fired` (the problem is real) · `passed` (ran, no problem) · `not_measured` (could not be
answered — counts for neither side) · `not_applicable`.

### Area score
`100 × points from checks that fired ÷ points from checks that ran`.
An area is only scored if **coverage ≥ 0.40** of everything that area could ever know. Below that
it returns nothing rather than a number it cannot support.

### Problem score
`0.6 × worst area + 0.4 × weighted average of the scored areas`, rounded to one decimal.
**Null** when no area cleared the coverage floor.

**Presence override:** a business with no website, a dead one, a social page only, **or an unclear
website where Google's listing carries no link at all (S6 fired)** takes `max(problem, 90)` and is
routed to Web development.

**Demand rescue:** a business whose site could not be read but which has proven demand (reviews,
rating, followers above thresholds) is Problem 90, Priority 1, route Web development — with the
record flagged for a human. Chains are excluded.

### Signals (intent) score
Sum of the N-family points that fired, capped at 100.

### Priority (tier) — today
| | Signals ≥ 35 | Signals < 35 |
|---|---|---|
| **Problem ≥ 55** | **1** — lots wrong and already spending | **3** — lots wrong, no sign of spending |
| **Problem < 55** | **2** — spends money, little wrong | **4** — lowest |

**Specified but not built:** priority becomes an ordered list of admin-written rules, first match
wins, with eleven condition types including numeric ranges. `specs/multi-user/spec.md` §7.

### The gate
`passedGate = problemScore ≥ 55 and not a shared/chain domain`. This is what "worth calling" means
and what decides whether paid data is worth buying.

### What to sell (route)
The highest-scoring area decides, with a 5-point tie-break in the order web_development ·
local_seo · reputation · contactability · social_media · advertising. **A route must have
evidence** — if the winning area has nothing fired, there is no route and the record says so.

---

## 9. AI features

| Feature | What it does | Model | Cost | Where |
|---|---|---|---|---|
| Page critique | Reads a page the browser opened and says what the measurements miss — purpose, judgement, and an opening line | Gemini 2.5 Flash | ~0.05¢ a page | lead detail, Website pages |
| ICP suggestion (`suggestRule`) | Proposes search words and matching words for an ICP | Gemini 2.5 Flash | ~0.1¢ | ICPs screen |
| Explain a business (`explainBusiness`) | Plain-language summary of a record | Gemini 2.5 Flash | ~0.3¢ | lead detail |

**Hard rule stated throughout the product:** the model **never** sets a score, a priority, an ICP
or a route. Everything numeric is arithmetic over measured findings. AI output is visually marked
and labelled with the model name and the price.

**AI categorisation / AI scoring:** **Not found in provided files** — deliberately absent.

---

## 10. Calls / outreach

Logged per business (`logOutcome` → `outcomes` table).

**Fields recorded:** channel (`call` | `message`) · result · objection category · which opener area
was used · free-text notes (≤2,000 chars) · a meeting date.

**Results available (7):** `no_answer` · `not_interested` · `interested` ·
`follow_up_requested` · `meeting_booked` · `do_not_contact` · `invalid_contact`.

**Objection categories (7):** none · price · timing · competition · authority · status_quo ·
technical.

**Contact information shown:** phone (from the Google listing), email and a contact name (found by
the crawler on their own pages), website, Instagram.

**Openers:** the product generates what to say from the findings — `buildOpeners`, by route.

**History:** every call on the lead's Calls & history tab. A call outcome **survives a merge**, so
tidying duplicate records never loses a conversation.

**Follow-up reminders / due dates as a list:** a meeting date is stored, but a "what is due today"
screen is **Not found in provided files**.

---

## 11. Tasks / operations

Screen: `/tasks`, plus a banner on every screen while something runs.

**Seven kinds a user can start:** `analyse-run` (website analysis) · `audit-site` and
`audit-site-run` (browser read) · `discovery` (Maps search, admin only) · `enrich-run` (buying
data) · `match-icps-run` (ICP sorting) · `score-run` (re-scoring).

**States (6):** Waiting to start · **Not picked up yet** (queued over 2 minutes) · **Never started**
(queued over 15 minutes — the platform expired it) · Running · **Gone quiet** (running, silent over
15 minutes) · Finished · Stopped.

**Per task:** what kind it is and what that kind does, in plain words · progress (done of total, or
a moving bar when the size is genuinely unknown) · elapsed time · **cost so far** · the step it is
on · a link to where its result lives.

**Stop:** any queued or running task. Everything already read or bought is kept; nothing new
starts. Not refundable — stopping prevents the rest, not the past.

**Retry:** re-running the same action is the retry. A dedicated retry button is **Not found in
provided files**.

**Failure honesty:** the web app asks Trigger.dev what actually happened to a task that stopped
reporting, and closes the row with the real reason — including *"it waited ten minutes for a worker
and expired; nothing was read, bought or spent."*

**Specified but not built:** task filters, deleting a task record, and "see only the leads this
task touched".

---

## 12. Imports

Covered in §5.2. Additional detail:

**Validation and rejection reasons seen in the product:** no business name · duplicate within the
same file · website value is not a web address. Every rejected row is reported with its reason
rather than dropped.

**Duplicates:** matched on identity keys (domain, phone, place id), not on name, so the same
business never enters twice. A matched row is reported as "already had" and merged.

**Import history:** `/records/imports` lists every batch with rows, created, already had, rejected,
who uploaded it and when. `/records/imports/[id]` shows one batch in full.

---

## 13. Categories / ICP

The product calls them **ICPs**. "Categories" was renamed to ICP by decision after the operator's
walkthrough; the old name no longer exists in the schema.

Screen: `/icps`. **Read-only for a member** under the agreed model.

**An ICP holds:** name · industry · words that find them on Google Maps (`search_terms`) · words
that recognise them afterwards, split into *anywhere* / *website* / *instagram*, with an optional
"all of these must appear" · exclusion words · and three conditions — **must have a working
website**, **at least N Google reviews**, **only in these places**.

**Matching:** ordered list, first match wins. Order → conditions → exclusions → word groups.
**An unknown fact never passes a condition.**

**Applying:** free and re-runnable (`applyRules`, `match-icps-run`). Changing an ICP and
re-applying costs nothing because it reads text already stored.

**A business matching no ICP** is reported as "in no ICP" — stated as *the rules do not describe
them*, not as a verdict about the business.

**Budget and revenue fields** exist on the ICP form, visibly switched off, with the reason on
hover.

---

## 14. Checklists

Screen: `/checklists`. **Read-only for a member** under the agreed model.

**A checklist rule holds:** what a good page has, in the operator's own words · which industry it
applies to (or any) · which page type it applies to (home, contact, products, …) · on/off.

**How it is judged:** the rule's wording is given to the model along with the page the browser
read. Judging pages already read is free and re-runnable.

**Preview** exists — a rule can be tried against pages already read before it is saved
(`saveChecklistRule`, `deleteChecklistRule`, `addExampleChecklists`).

**Weights:** **Not found in provided files.** Checklist rules do not carry a numeric weight; they
produce per-page verdicts. The 64 scored checks are a separate system.

---

## 15. Data & sources

Every fact on a record carries where it came from, shown to the user.

| Source | What it gives | Cost | Status |
|---|---|---|---|
| Own crawl | up to 4 pages, most of the 64 checks, email, phone, owner name, social links | free | working |
| Browser read (Playwright) | pages a plain crawler is refused, screenshots, console errors | free | working |
| Google PageSpeed | load time, performance score (W6, W7) | free | working |
| YouTube Data API | channel presence (O8) | free | ~100/day quota |
| Google Places — search | the business itself, rating, review count | paid, per search | working |
| Google Places — details | S1, S3, S5, S6, R1, R2 | **3.5¢** | working |
| Apify — Instagram | followers, posts, category, bio | **0.26¢** | working |
| Apify — Meta Ad Library | D5, N2 | **11.6¢** | built, never run |
| Google AI Studio (Gemini) | page critique, ICP suggestion, explanation | ~0.05–0.3¢ | working |
| DataForSEO | traffic estimate, rank (S7, S8) | 0.12¢ | **not connected** |
| Lusha | owner's mobile | 73¢ | **not connected**, parked deliberately |

**Last updated / refresh:** every bought field stores a `*_checked_at` timestamp; re-buying
refreshes it. A per-source "refresh all" is **Not found in provided files**.

---

## 16. Usage / spending

Screen: `/spend`.

**Shows:** total spent all time · spend per kind of data · what each thing costs with who bills it ·
a long list of what is free · spend grouped by provider · cost per business.

**The ledger:** `provider_calls` is written **before** each paid call, so the figure cannot flatter
itself. A failed call is recorded and **not charged**.

**Credits:** there is no credit system. Spend is real money with real providers.

**Budgets and limits — specified, not built:** an admin sets each member an amount and a period
(once / weekly / monthly). A paid action with nothing left is refused **before** buying, stating
what is left and what the action costs. `specs/multi-user/spec.md` §8.

**Caps that exist today:** every search and every buy run takes a maximum spend, and stops at it
mid-run if necessary.

**Warnings:** sub-cent amounts are shown as cents rather than `$0.00`, because a third of a cent is
not free.

---

## 17. Search / filters / bulk actions

**Search:** free-text `q` across name, town and ICP on the leads screen. A global search across
users, tasks and imports is **specified, not built**.

**Filters:** the 14 listed in §4, combinable, each shown as a removable chip with a live count.

**Sorting:** priority then Problem score, or grouped by colour. Arbitrary column sorting is **Not
found in provided files**.

**Saved views:** **specified, not built**. Today the URL carries the filter state and can be
bookmarked.

**Multi-select:** per row, plus "tick all 50 on this page".

**Bulk actions:** analyse · read pages · buy data · export · claim. Each priced before it runs.

**Export:** `/records/export` — CSV of exactly what the current filters show, generated under the
signed-in user's own permissions so it can never export more than the screen does.

---

## 18. Notifications

**Built today:** a running-task banner on every screen; a five-second toast when a task finishes;
the task's own row carrying its state and reason.

**Specified, not built** (`specs/multi-user/spec.md` §10): a notification list per person, with
nine events — task finished / stopped / never started · leads assigned to you · a transfer request
· a transfer decided · leads arriving from a transfer · something deleted · a paid lookup and its
cost · budget run out or topped up · a new Showcase post. Read state per row; opening the panel
does not clear it. **Yours shows only yours.**

---

## 19. Profile / settings

**Built:** theme (light / dark / follow the device, stored in a cookie) · sidebar collapsed or open
· sign out.

**Not found in provided files:** profile page, display name, change password, email preferences,
notification preferences, per-user defaults. Password is handled by Supabase auth; accounts are
created by an admin, as the sign-in screen says.

---

## 20. Permissions

**Built today: none.** Anyone who signs in sees and can do everything. There is one account.

**Agreed and specified** (`specs/multi-user/spec.md` §2) — a member may:

| Action | Member |
|---|---|
| See leads | **their own only** |
| Analyse, read pages, re-score | yes, on their own |
| Import a file, add one by hand | yes |
| **Search Google Maps** | **no — admin only** |
| Buy paid data | yes, **up to their budget** |
| ICPs, checklists, priority rules | **read only** |
| Assign leads to people | no |
| Ask to transfer leads to a colleague | yes — **admin must approve** |
| Release a lead back to the pool | yes |
| Archive or delete a lead | no |
| See spend | **their own only** |
| See tasks, calls, activity | **their own only** |
| Add or edit users, set budgets, approve transfers | no |
| Showcase | post and read |

Enforcement is specified to live in row-level security, not in hidden buttons, so reaching a screen
by its address gives the same answer the navigation does.

---

## 21. Paid features

Everything else in the product is free.

| Feature | What is bought | Provider | Cost | Max | Confirmation | Result | If it fails |
|---|---|---|---|---|---|---|---|
| **Google Maps search** | the businesses themselves, with rating and review count | Google Places API | 3.5¢ a search + 3.5¢ a listing | **`maxSpendDollars`, set by the user, enforced mid-run** | Yes — a confirm screen prices it first | new business records | run stops; what was found is kept; failed calls not charged |
| **Google listing details** | rating, review count, hours, category, website link → S1, S3, S5, S6, R1, R2 | Google Places API | **3.5¢** a business | `capDollars` on the buy screen | Yes — price, provider and total shown | six checks answered, score re-run | not charged; the check stays *not measured* |
| **Instagram profile** | followers, posts, category, bio, link, verified | Apify | **0.26¢** a business | `capDollars` | Yes | profile fields + O5/N5 written as unmeasured with the reason | not charged |
| **Meta ads** | whether they advertise now, how many ads, since when, platforms, sample text | Apify | **11.6¢** a business | `capDollars` | Yes | D5 and N2 answered | not charged |
| **Model's read of a page** | purpose, judgement and an opening line per page | Google AI Studio (Gemini 2.5 Flash) | **~0.05¢** a page | bounded by pages read | Yes, inside "read pages" | an AI insight on the page and the lead | page keeps its measurements; no critique |
| **Explain a business** | a plain-language summary | Google AI Studio | ~0.3¢ | — | **Unclear / needs confirmation** whether a confirm step exists | a paragraph on the record | no summary |
| **ICP suggestion** | proposed search and matching words | Google AI Studio | ~0.1¢ | — | **Unclear / needs confirmation** | words proposed into the form | nothing suggested |
| Traffic estimate | monthly search visitors | DataForSEO | 0.12¢ | — | — | **not connected** | — |
| Owner's mobile | a direct mobile | Lusha | **73¢** | — | — | **not connected, parked** | — |

**Universal rules:** the ledger is written before the call, so nothing is charged invisibly; a
failed provider call is never billed; every price names the provider and what it buys; sub-cent
amounts are shown in cents.

---

## 22. Complete user workflows

### A — Leads arrive and get worked
*(assignment is specified, not built)*
Admin assigns → **member is notified** → leads appear on their list → member filters to Priority 1
→ opens one → reads why it is worth calling and what to say → claims it → calls → logs the outcome
→ the record carries it for ever.
Free throughout.

### B — Import a list
Member uploads a CSV → rows matched against what exists → review screen: created / already had /
rejected with reasons → confirm → records created → optional follow-ons run automatically (analyse,
apply ICPs, look up Instagram) → import's own page shows the result.
Free, except the Instagram option.
**If it fails:** nothing is created; the upload can be discarded.

### C — Analyse a business
Member presses Analyse → task queued → crawl up to 4 pages → presence decided → 64 checks run →
PageSpeed → scoring → ICP matching → **the screen refreshes itself and a toast says what finished**
→ scores, priority, what to sell and the evidence all update.
Free.
**If it fails:** the reason is recorded (`timeout`, `unreachable`, …), every affected check is
marked *not measured*, and nothing is charged.

### D — Read pages in a browser
Member presses *Read pages* → confirm modal states the Gemini cost → browser opens each page,
35-second budget, home page retried once → screenshots kept → model asked → re-scored.
**Costs** ~0.05¢ a page.
**If a page fails:** that page is recorded as timed out, the checks that needed it stay unmeasured,
and the rest of the site still counts.

### E — Buy paid data
Member ticks businesses → *Buy data* → the buy screen states what is bought, who bills it, the
per-business price, the total and a spend cap → confirm → task runs → fields and checks written →
score re-run → the ledger records every call.
**Costs** as in §21. Under the agreed model the member's **budget is checked first and the action
refused before buying** if it cannot be covered.
**If a call fails:** it is logged and not charged.

### F — Call a lead and record it
Member opens a lead → reads the findings and the opener → rings the number from the listing → logs:
channel, result, objection, notes, meeting date → the outcome is stored and shown on the lead for
ever, surviving any later merge.
Free.

### G — Ask to pass leads to a colleague
*(specified, not built)*
Member ticks leads → *Transfer to…* → names a colleague and why → **the leads stay theirs and stay
callable** → admin approves or refuses with a reason → on approval they move; on refusal nothing
changes and the member may ask again after a day.
Free.

### H — A task that cannot start
Member starts anything → no worker is listening → the task waits → after 2 minutes the screen says
*not picked up yet* and names the likely cause → after 10 minutes the platform expires it → the
product asks what happened and writes: **"never started — nothing was read, bought or spent."**

---

## 23. User journey / lifecycle

1. **Invited** — an admin creates the account; the sign-in screen says accounts are made by an
   admin. *(Creation flow specified, not built.)*
2. **First sign-in** — the member's list is **empty**, and the empty state must say *"you have not
   been given any leads yet"*, which is a different sentence from *"nobody has looked at these
   yet."*
3. **Leads arrive** by assignment, or they import their own.
4. **They learn** — free analysis fills in the checks and scores.
5. **They spend a little** — Instagram or a listing, within budget.
6. **They call** — and log what happened.
7. **They hand on or give up** — transfer to a colleague (with approval), or release back to the
   pool.
8. **They are removed** — their leads go to the admin, marked as theirs; their calls and history
   stay.

---

## 24. All user-facing screens / pages

| Path | What it is | Member access *(specified)* |
|---|---|---|
| `/login` | sign in | yes |
| `/dashboard` | overview, four stages, breakdowns, next actions | own figures |
| `/records` | the leads list — filters, ticks, actions | own leads |
| `/records/[id]` | one lead, four tabs | own leads |
| `/records/new` | add one by hand | yes |
| `/records/import` | upload a CSV | yes |
| `/records/imports` | every import | own |
| `/records/imports/[id]` | one import's result | own |
| `/records/enrich` | buy paid data, priced | within budget |
| `/records/export` | CSV of the current filters | own |
| `/search`, `/search/confirm`, `/search/runs/[id]` | Maps search | **admin only** |
| `/instagram` | Instagram status and bulk lookup | own |
| `/icps` | ICPs | read only |
| `/checklists` | checklist rules | read only |
| `/tasks` | tasks, states, stop | own |
| `/spend` | costs, what is free, what was spent | own |
| `/rules` | How it works | yes |
| `/error` | error screen | — |
| Priority rules · Notifications · Showcase · Team | **specified, not built** | — |

---

## 25. Loading / empty / error / success states

**Loading:** a running-task banner on every screen; a progress bar with a real count when the size
is known and a moving stripe when it is genuinely unknown; a step line saying what is happening
now; the page refreshes itself every 10 seconds while a task runs, and **never** on a screen with a
form in it, so nothing typed is lost.

**Empty:** every empty state names the reason and offers the one action that fills it. Two that
must stay distinct: *"nobody has looked at this yet"* (no check has run) and *"you have not been
given any leads yet"* (nothing assigned).

**Error:** human-readable, with four things — what happened, why, what was affected, and
**whether money was charged**. No stack traces. Examples in the product: *"The home page could not
be read (timeout), so there was nothing to find the other pages from."* · *"Never started — it
waited ten minutes for a worker and expired. Nothing was read, bought or spent."*

**Success:** a five-second toast with what finished and a link to the result; a full screen for
larger results (an import's outcome).

**Confirmation:** every paid action and every destructive one confirms first, stating the
consequence.

**The third answer, everywhere:** yes · no · **nobody has looked** are three states and are never
collapsed into two.

---

## 26. Missing / unclear requirements

**Not found in provided files**
- A user profile page, display name, change password, notification preferences
- Editing arbitrary lead fields (only website and Instagram URL can be saved by hand)
- Deleting or archiving a lead as a user
- Arbitrary column sorting
- A "follow-ups due today" list, though a meeting date is stored
- Recent-activity feed on the dashboard
- Retry button on a failed task (re-running the action is the retry)
- Checklist weights
- A credits system — spend is real money
- Facebook page activity — no source exists

**Unclear / needs confirmation**
- Whether `explainBusiness` and `suggestRule` show a cost confirmation before running, as the
  purchase flows do
- Whether a member may release a lead they have already called, or only an untouched one
  (`spec.md` §14 lists this as open)
- How long a notification is kept before it is cleared (`spec.md` §14)
- Whether the member dashboard shows the four stages or a simplified version — the member variant
  is described in `design-brief.md` but not specified field by field

**Specified but not built** — all in `specs/multi-user/spec.md` and `tasks.md`
- Roles, ownership and row-level enforcement
- Lead assignment, transfers and approvals
- Budgets per person
- Priority rules written by the admin
- Notifications
- Showcase
- Task filters, deleting a task record, and leads scoped to a task

---

### Sources

Read directly from: `apps/web/app/**` (20 screens, 38 server actions) ·
`packages/core/src/checks/registry.ts` (64 checks) · `packages/core/src/scoring/*` (weights,
floors, thresholds) · `packages/shared/src/enums.ts` (statuses, outcomes, objections) ·
`packages/shared` enrichment definitions (prices, providers, warnings) · `apps/jobs/trigger/*`
(7 task kinds) · the live database (559 businesses, 371 provider calls, 1 user) ·
`specs/multi-user/spec.md`, `tasks.md`, `design-brief.md` (the agreed but unbuilt model).
