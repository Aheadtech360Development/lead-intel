# Pre-Build Risks and API Limits

**Local Business Lead Intelligence System — AheadTech360**
**Date:** 17 August 2026
**Read before creating any account or writing any code.**
**Companion to:** `local-lead-intelligence-specification-v4.0.md`

---

## 0. The one thing that can actually hurt you

**Google Cloud billing does not stop by itself.**

If a loop goes wrong at 2am, Google will keep serving requests and keep charging. There is no
automatic cut-off. People have woken up to four-figure bills from a bug in a loop.

There are two settings in Google Cloud and **they are not the same thing**:

| Setting | What it does | Stops spending? |
|---|---|---|
| **Budget alert** | Emails you when spend crosses a threshold | **NO** — it only notifies |
| **Quota limit** | Caps requests per day / per minute for an API | **YES** — extra requests fail with an error |

**Set a quota limit on every Google API before the first test run.** A budget alert on its own
is not protection — it tells you about the money after it is gone.

**Recommended starting quotas** (raise them later once real usage is known):

```
Places API           2,000 requests / day
PageSpeed Insights   5,000 requests / day
Any other Google API 500   requests / day
```

If a run hits the quota, requests fail cleanly, the run records the failure, and nothing is
charged beyond the cap. That is exactly the behaviour we want.

**Also do this on day one:**
- Separate Google Cloud project for this system only — never mixed with anything else
- Billing alerts at $10, $25, $50 as an early-warning layer on top of the quotas
- API key restricted to the specific APIs it needs, nothing else

---

## 1. Every external service — limits, charges, what to set

**Every price below must be checked at signup.** API pricing changes often and this document
will go stale. What does not go stale is the *shape*: which things are per-request, which are
subscriptions, and which are free.

### 1.1 Google Places — the main cost

| | |
|---|---|
| **What it does** | Finds the businesses. Returns name, address, phone, website, rating, review count |
| **Charged** | Per request, and the price differs by which fields you ask for |
| **Free allowance** | Google has historically given a monthly free allowance. **Verify the current terms** — this changed recently and the old "$200 credit" advice is out of date |
| **Hard limit** | None by default. **You must set a quota** |

**Two separate charges, and mixing them up is how the estimate goes wrong:**

1. **Search** — one charge per search request, returns up to 20 results, up to 3 pages
2. **Place Details** — a *separate* charge per business, needed for hours, photos, reviews

**Cost-saving technique to build in from the start:** Google charges by field tier. Asking for
only the fields we use is materially cheaper than asking for everything. Define the field list
once, in the adapter, and never widen it casually.

### 1.2 PageSpeed Insights — free, but rate limited

| | |
|---|---|
| **What it does** | Mobile load time, performance score |
| **Charged** | Free |
| **Limit** | Generous daily quota with an API key, but a **tight per-minute limit** |
| **Risk** | Not cost. The risk is hammering it and getting throttled mid-run |
| **What to build** | A queue with a delay between calls, and a retry on 429. Never fire 2,800 of these in parallel |

Without an API key the limit is very low. Get a key even though it is free.

### 1.3 Search rankings (SerpApi / ScaleSerp / similar)

| | |
|---|---|
| **What it does** | Where the business ranks for its own name, and for "niche + city" |
| **Charged** | Monthly subscription with an included search count |
| **Risk** | Overage charges above the plan, or the plan silently stopping |
| **What to set** | Start on the smallest plan. This runs only on businesses that pass the gate |

**Not needed until Phase 5.** Do not buy it yet.

### 1.4 Meta Ad Library

| | |
|---|---|
| **What it does** | Whether the business is currently running ads |
| **Charged** | Free |
| **Cost of entry** | Requires a Meta developer app, an access token, and identity verification. Set-up takes days, not minutes |
| **Risk** | **Coverage.** It is not confirmed that it returns useful data for a small US business |

**Verify coverage before building the adapter.** Do it by hand first: look up three known
advertising businesses in the public Ad Library UI and see what is actually there. If commercial
ads for small US businesses are not exposed, drop the adapter and rely on pixel detection, which
is free and comes from their own website.

### 1.5 Supabase

| | |
|---|---|
| **Free tier** | Enough for development. Limits on database size, bandwidth, and inactivity pausing |
| **Paid** | A fixed monthly fee for the first paid tier |
| **Real risk** | **Storing raw HTML.** 2,800 sites × several pages of HTML fills the database fast and burns bandwidth |
| **Rule** | Store *what we extracted*, not the page it came from. Keep raw HTML only long enough to parse it, then discard |

Free-tier projects pause after a period of inactivity. Fine during development, not for
production.

### 1.6 Trigger.dev

| | |
|---|---|
| **What it does** | Runs the long jobs |
| **Free tier** | Limited runs per month and limited concurrency |
| **Risk** | A grid search across 150 points, then 2,800 website fetches, is a lot of task executions. The free tier can run out mid-run |
| **What to check** | The run count and concurrency limits *before* the first full-size run |

### 1.7 Vercel

Free tier is fine for the UI, because the UI only ever enqueues jobs and reads the database.
Bandwidth is the only thing to watch, and it will not be close.

### 1.8 Railway / Playwright — **probably not needed any more**

The v3.2 system needed a headless browser for e-commerce checks (checkout steps, guest checkout,
signup submission). **Version 4.0 has none of those checks.** Every check in §5 is either a
static HTML parse or an API call.

**Recommendation: drop Railway and Playwright from v1.** That removes a deployment target, a
monthly cost, and a whole class of failure. Add it back only if a check appears that genuinely
needs a rendered page.

### 1.9 Anthropic API

| | |
|---|---|
| **Used for** | Four things only: parsing the search box, one-line descriptions, review theme summaries, opening lines |
| **Charged** | Per token. No free tier |
| **Risk** | Low, if openers are generated on demand rather than for every business in a run |
| **Rule** | Never generate openers for 2,800 businesses. Generate on record open, or for Tier 1–2 only |

---

## 2. Where this gets stuck — ranked by how likely

### 2.1 The grid search is the hardest problem in the system

This is where the real engineering difficulty sits, and it is worth understanding before
writing any of it.

**The 60-result cap.** One Places search returns at most 60 results — 3 pages of 20. If a search
of central Miami returns exactly 60 screen printers, you have no way to know whether there were
61 or 600. **You are blind to the overflow.**

**The fix is adaptive subdivision:**

```
search(cell)
  if results == 60 (saturated):
      split the cell into 4 smaller cells
      search each one
      repeat until every cell returns fewer than 60
```

Dense city centres subdivide two or three levels. Empty countryside needs one search. This is
the correct approach and it is also **why the cost is hard to predict in advance** — the number
of searches depends on how dense the niche is in that area, which you do not know until you run
it.

**Consequences to plan for:**

- The cost estimate on the search screen is a *range*, not a number, and it must be honest
  about that
- Every cell that saturates must be recorded, so an incomplete search is visible rather than
  silently missing 400 businesses
- A maximum subdivision depth is needed, or a dense city could subdivide forever

**Mitigation for the first build:** cap the depth at 3 levels and record when the cap is hit. A
search that says "this area is saturated, results may be incomplete" is honest. One that quietly
returns 60 of 500 is a lie the operator will act on.

### 2.2 Confirming a business has no website

"No website" is the most valuable finding in the system, so a false positive is expensive — you
pitch a website to someone who already has one.

The failure mode: Places has no website field, so we mark it "no website", but they do have one
and simply never added it to their listing.

**Required before claiming no website** (already in spec §4):
1. Places website field is empty
2. A search for the business name plus city finds no site
3. No Facebook page with a website link

Even then, mark it *no website found*, not *no website exists*. The difference matters on a call.

### 2.3 Websites that block us

A percentage of sites sit behind Cloudflare or similar and will refuse an automated fetch.

**The rule that must hold:** a blocked fetch is recorded as **not measured** — never as a pass.
A site we could not read must never score as a site with no problems.

**Track the block rate as a number.** If it goes above roughly 15%, the free analysis is not
seeing enough of the market and the options are a proxy service (a real cost, not currently
budgeted) or accepting the gap. Either way it is a decision, not a surprise.

### 2.4 Instagram and LinkedIn

Already decided. Instagram is best-effort. LinkedIn is link-detection only. Both return
*not measured* rather than failing the run.

The thing to get right in code: **one platform being unavailable must not fail the whole
analysis.** Each social read is independent and its failure is recorded, not thrown.

### 2.5 Duplicates

Lower risk than it looks. Google's Place ID is stable and unique, so the same business returned
by five overlapping grid cells deduplicates cleanly.

The harder case is the same business appearing in Places *and* a directory under a slightly
different name. That is what the identity key ranking in spec §7 handles, and why phone numbers
alone never merge records.

### 2.6 Long runs and job limits

A full run is: 150–500 search calls, then up to 2,800 website fetches at 2 seconds apart per
host, then PageSpeed for each. **That is hours.**

Things that break:
- Job platform run limits and concurrency caps
- A run that dies halfway with no way to resume
- Re-running and paying for the same searches twice

**Build from the start:** every stage records what it completed, so a resumed run picks up
rather than restarting. The call ledger from the build guide §3.5 covers the paid half of this.

### 2.7 Legal and compliance

- **Calling US businesses:** business-to-business calling has different rules from consumer
  calling, but the rules exist. A compliance review is needed before outreach scales — spec §14
  item 6
- **Directory scraping:** most directories prohibit automated collection in their terms. Google
  Places through the official API is the clean path; directories are the grey one
- **Storing business data** is low risk. Storing *named individuals* is where obligations start,
  which is one more reason the engagement-names decision was parked

---

## 3. Decide these before writing code

| # | Decision | Why it must be now |
|---:|---|---|
| 1 | **Set Google API quota limits** | Without this there is no ceiling on spending. Everything else is secondary |
| 2 | **Test radius first, not 200 miles** | Run 10 miles around one city and count the actual requests. That single number turns the cost model from a guess into arithmetic |
| 3 | **Drop Railway and Playwright** | No v4.0 check needs a rendered page. Removes a host, a cost, and a failure class |
| 4 | **Never store raw HTML** | Parse, extract, discard. Otherwise the database fills and bandwidth costs appear |
| 5 | **Cache Place IDs — do not re-fetch** | The same business will appear across many searches and many runs. Re-fetching is paying twice for the same fact |
| 6 | **Verify Meta Ad Library coverage by hand** | Ten minutes in the public UI decides whether an adapter is worth building at all |
| 7 | **Buy nothing until Phase 5** | Only Places and PageSpeed are needed for Phases 1–4. Search rankings can wait |
| 8 | **Set a max subdivision depth** | Otherwise a dense city can subdivide indefinitely and spend the whole budget on one search |

---

## 4. The first run should be deliberately small

Do not point this at Miami with a 200-mile radius on day one.

**Run one: a 10-mile radius around a single city, in one niche.**

Then count what actually happened:

| Measure | Why it matters |
|---|---|
| How many search requests were made | This is the number the whole cost model rests on |
| How many businesses came back | Density for this niche |
| How many cells saturated at 60 | Tells you how deep the subdivision has to go |
| How many had no website | The core value of the product, measured |
| How many websites blocked us | Whether the free analysis is viable |
| How long the whole run took | Whether the job platform limits are a problem |

**Every number in the cost model is currently an estimate. This one small run replaces all of
them with measurements.** Scale the radius up only after those numbers exist.

---

## 5. What is needed now, and what can wait

| Service | Needed for | When |
|---|---|---|
| **Supabase** | Everything | Now — Phase 1 |
| **Google Cloud + Places API + quotas** | Discovery | Before Phase 3 |
| **PageSpeed Insights key** | Free analysis | Before Phase 4 |
| Meta developer app | Ad activity | Phase 5, and only if the coverage check passes |
| Search rankings provider | Two SEO checks | Phase 5 |
| Anthropic API | Openers | Phase 5 |
| Trigger.dev | Long jobs | Phase 3 |
| Vercel | The UI | Phase 2 |
| ~~Railway~~ | ~~Rendered checks~~ | **Not needed** |

**Phases 1 and 2 need only Supabase and Vercel.** Both have free tiers. The data model, the
deduplication logic, and the whole platform shell can be built and tested before any paid API
account exists.
