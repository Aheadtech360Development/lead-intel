# Local Business Lead Intelligence System

## Specification v4.0

**Owner:** Ikrash Ovais, CEO — AheadTech360
**Date:** 13 August 2026
**Status:** Corrected specification. Supersedes v3.2 and its companion documents.
**Replaces:** `lead-intelligence-enrichment-system-final-specification-v3.2.md`,
`scoring-model-v0.1.md`, `audit-test-catalogue-v0.1.md` — all three describe a different system
and should be treated as historical.

---

## 0. What changed, and why

Versions 3.0 through 3.2 described a system for finding **US DTC e-commerce brands** starting
from a domain index. That was wrong. On 13 August 2026 the CEO described the actual process,
and it is a different system.

**What it actually is:** the operator types a **niche**, a **location**, and a **radius**. The
system pulls every matching local business from maps, sorts them by what web presence they have,
then analyses whatever it finds — website, social accounts, advertising signals, reviews — so
the operator can decide who is worth contacting.

| v3.2 said | v4.0 |
|---|---|
| DTC e-commerce brands | **Any local business, in any niche** |
| Store Leads / BuiltWith domain index | **Google Places, searched across a grid** |
| Input: industry + platform + revenue | **Input: niche + location + radius** |
| Apollo for contacts | **Removed** — local listings publish the phone |
| Revenue band $500K–$10M filter | **Removed** — no obtainable revenue for local businesses |
| Checkout steps, product reviews, cart | **Removed** — e-commerce only |
| Website status was one field | **Website status is the primary sort** |

**What survived:** identity resolution and deduplication, field-level provenance, free-checks-
before-paid-calls, the two-score model, the platform UI, exclusions, outcome logging, and the
rule that an unmeasured check is never recorded as a pass.

---

## 1. What the system does

**In one sentence:** it finds every business of a given type in a given area, works out what is
wrong with their online presence, and tells the operator who is worth calling and what to say.

It does not send outreach. It does not replace a CRM. The operator makes the final call.

### 1.1 The operator's job before this system

Search Google Maps for "screen printing Miami". Open each result. Check if they have a website.
Open the website. Judge whether it is any good. Check their Facebook. Check if they post. Note
the phone number. Write it in a spreadsheet. Repeat 200 times.

### 1.2 The operator's job with this system

Type the niche, the city, the radius. Come back later to a sorted list where every business
already carries its findings and a suggested opening line.

---

## 2. Search input

Three fields. Nothing else is required.

| Field | Example | Notes |
|---|---|---|
| **Niche** | `screen printing` | Free text. Changes on every search |
| **Location** | `Miami, FL` | City, or a dropped pin |
| **Radius** | `200 miles` | How far out to search |

Optional narrowing, applied after results come back:

- Minimum / maximum Google review count
- Minimum rating
- Has a website / no website / social only
- Business is currently open (not permanently closed)

**Saved searches.** A search can be named, saved, re-run, and duplicated. Every business found
stores which search and which run produced it.

---

## 3. Discovery — how the list is built

### 3.1 Google Places is the source

Google Places accepts exactly the input the operator gives: a keyword, a location, and a radius.
It returns the business name, address, phone, website (if it has one), rating, review count,
and whether it is still operating.

### 3.2 The 60-result problem, and the grid

A single Places search returns **at most 60 results**. A search for "screen printing" near Miami
can have 2,800 matching businesses. One search will never see them.

**The solution is a grid.** The radius is divided into overlapping circles — a search point
every few miles — and the keyword is searched at each point separately. A 200-mile radius needs
roughly 100–200 search points depending on how dense the area is. Dense city centres get a
finer grid because they hit the 60-result cap; empty countryside gets a coarse one.

Every search returns overlapping results, so **the same business appears many times**. This is
why deduplication is not optional — see §7.

### 3.3 Directories as a cross-check

Directory sites (Manta, Yelp, Yellow Pages) list many of the same businesses. They are useful
for cross-checking a phone number or catching a business Places missed, but they are **not** a
primary source: listings are self-submitted and go stale without correction. Any value taken
from a directory is marked as such and never shown as verified without a second source.

---

## 4. The first sort — what web presence do they have

This is the most valuable single step, and it costs nothing. Every business falls into one of
five states.

| State | How it is determined | What it means commercially |
|---|---|---|
| **No website** | Places has no website, and a search for the business name finds none | **The strongest lead.** Sell a website |
| **Dead website** | Domain resolves but the site does not load, is parked, or errors | Sell a website |
| **Social only** | A Facebook or Instagram page exists, no website | Sell a website |
| **Website live** | The site loads | Now analyse it — §5 |
| **Unclear** | Evidence conflicts, or checks did not complete | Send to manual review. **Never guessed** |

A business is only marked "no website" after all three checks have run: the Places website
field, a Facebook page lookup, and a direct search for the business name. One failed check is
not enough to claim a business has no website.

---

## 5. What gets analysed

Every check below is **niche-agnostic** — it works the same for a screen printer, a salon, a
plumber, or a dentist. That is a hard requirement, because the niche changes on every search.

Each check carries a **cost class**:

| Class | Meaning | Cost |
|---|---|---|
| **FREE** | We fetch the business's own website and read it, plus Google PageSpeed | $0 |
| **PAID** | Google Places Details, or a search-ranking lookup | cents |
| **BEST EFFORT** | Social platform reads. Some platforms block us. Returns *not measured* when they do | $0 |

### 5.1 Web presence and quality — sells web development

| ID | Check | Fires when | Points | Class |
|---|---|---|---:|---|
| W1 | No website at all | §4 state is "no website" | 100 | FREE |
| W2 | Website dead or parked | §4 state is "dead" | 100 | FREE |
| W3 | Social page only | §4 state is "social only" | 90 | FREE |
| W4 | No valid HTTPS | No certificate, or expired | 30 | FREE |
| W5 | Not mobile-friendly | No viewport tag and no responsive CSS | 35 | FREE |
| W6 | Slow on mobile | Load time >4s → 30; 2.5–4s → 15 | 30 | FREE |
| W7 | Poor performance score | Under 50 → 25; 50–89 → 10 | 25 | FREE |
| W8 | Built on a dated platform | Old Wix / Weebly / GoDaddy builder / abandoned WordPress theme | 15 | FREE |
| W9 | Site looks abandoned | Copyright year two or more years old | 15 | FREE |
| W10 | Barely a website | Fewer than 4 real pages | 15 | FREE |
| W11 | No favicon | Missing | 5 | FREE |
| W12 | Images have no alt text | More than half missing | 8 | FREE |

### 5.2 Contactability — sells conversion work

For a local business this is the whole point of the website. If a customer cannot easily call,
find, or message them, nothing else matters.

| ID | Check | Fires when | Points | Class |
|---|---|---|---:|---|
| K1 | No phone number on the site | Not found anywhere | 30 | FREE |
| K2 | Phone is not tap-to-call | No `tel:` link on mobile | 12 | FREE |
| K3 | No contact form | No form with a message field | 20 | FREE |
| K4 | No address shown | Not found | 15 | FREE |
| K5 | No opening hours | Not found | 15 | FREE |
| K6 | No map or directions | Not found | 10 | FREE |
| K7 | No email address | Not found anywhere | 15 | FREE |
| K8 | No way to request a quote or booking | No booking widget, quote form, or call-to-action | 15 | FREE |

### 5.3 Local search and listings — sells local SEO

| ID | Check | Fires when | Points | Class |
|---|---|---|---:|---|
| S1 | No Google Business Profile | No listing found | 40 | PAID |
| S2 | Listing unclaimed | Google shows it as unclaimed | 30 | PAID |
| S3 | No hours on the listing | Missing | 15 | PAID |
| S4 | Few or no photos | Fewer than 5 | 15 | PAID |
| S5 | No category set | Missing or generic | 10 | PAID |
| S6 | Listing has no website link | Missing, or points somewhere broken | 20 | PAID |
| S7 | Does not rank first for its own name | Position >1 | 25 | PAID |
| S8 | Does not rank for "niche + city" | Not in the top 10 | 25 | PAID |
| S9 | No local business markup | No LocalBusiness schema on the site | 20 | FREE |
| S10 | Missing or duplicate page title | Absent, empty, or repeated | 12 | FREE |
| S11 | No meta description | Missing | 8 | FREE |
| S12 | No sitemap | Not found | 8 | FREE |
| S13 | Search engines blocked | robots.txt or noindex blocks the site | 40 | FREE |
| S14 | City or service missing from the title | Neither appears in the page title or main heading | 15 | FREE |

### 5.4 Reputation — sells reputation management

| ID | Check | Fires when | Points | Class |
|---|---|---|---:|---|
| R1 | Very few reviews | Under 10 → 35; 10–24 → 20; 25–49 → 8 | 35 | PAID |
| R2 | Weak rating | Below 4.0 → 30; 4.0–4.3 → 12 | 30 | PAID |
| R3 | Reviews have dried up | Nothing in the last 6 months | 25 | PAID |
| R4 | Owner never replies | No owner response in the last 10 reviews | 20 | PAID |
| R5 | Very slow review growth | Under one new review a month | 15 | PAID |
| R6 | No reviews shown on their own site | Not displayed anywhere | 10 | FREE |

### 5.5 Social presence — sells social media management

| ID | Check | Fires when | Points | Class |
|---|---|---|---:|---|
| O1 | No social links on the website | None found in header or footer | 35 | FREE |
| O2 | No Facebook page | Not found | 25 | FREE |
| O3 | Facebook has gone quiet | Last post >90 days → 25; 30–90 days → 12 | 25 | BEST EFFORT |
| O4 | No Instagram | Not found | 20 | FREE |
| O5 | Instagram has gone quiet | Last post >90 days | 20 | BEST EFFORT |
| O6 | Almost no social footprint | Fewer than 3 platforms linked | 15 | FREE |
| O7 | Nothing posted anywhere | No activity on any platform in 90 days | 30 | BEST EFFORT |
| O8 | No video content | No YouTube channel or videos | 8 | BEST EFFORT |

**Platform reality.** These are not equally obtainable, and the system records the difference
honestly rather than pretending:

| Platform | Account exists | Last post | Followers |
|---|---|---|---|
| Facebook | Reliable | Reliable | Reliable |
| YouTube | Reliable | Reliable — official free API | Reliable |
| Instagram | Reliable | Best effort — often blocked | Sometimes |
| X | Reliable | Best effort | Sometimes |
| TikTok | Best effort | Best effort | Sometimes |
| LinkedIn | Link only | **Not attempted** — see §11 | No |

The one signal available for **every** platform, always, for free: **which platforms the
business links to from its own website.** A ten-year-old business with no social links anywhere
on its site tells you plenty on its own.

### 5.6 Advertising — sells ad setup and management

The most reliable advertising signal is not the ad library. It is the tracking code sitting in
the business's own website, which we read for free.

| ID | Check | Fires when | Points | Class |
|---|---|---|---:|---|
| D1 | No tracking of any kind | No analytics, no pixel, no tag | 35 | FREE |
| D2 | No Meta Pixel | Not installed | 20 | FREE |
| D3 | No Google Ads tag | Not installed | 20 | FREE |
| D4 | No analytics | No Google Analytics or equivalent | 20 | FREE |
| D5 | Not currently advertising | No active ads in the Meta Ad Library | 15 | PAID |
| D6 | No retargeting | Pixel present but no retargeting setup detected | 10 | FREE |

A business with no pixel at all has **never run digital advertising**. That is both a large
opportunity and a warning that they have no budget history — which is exactly why Problem and
Intent are scored separately.

---

## 6. Scoring and routing

### 6.1 Six areas, one per service

| Code | Area | Service it sells | Weight |
|---|---|---|---:|
| WEB | Web presence and quality | Web development | 0.24 |
| SEO | Local search and listings | Local SEO | 0.20 |
| REP | Reputation | Reputation management | 0.16 |
| CON | Contactability | Conversion work | 0.14 |
| SOC | Social presence | Social media management | 0.14 |
| ADS | Advertising | Ad setup and management | 0.12 |

Each area produces a score from 0 to 100:

```
area score = 100 × (points from checks that fired)
                 ÷ (points available from checks that actually ran)
```

A check that could not run — blocked, timed out, not applicable — is left out of **both** sides.
It never counts as a pass and never counts against the business.

**Coverage floor.** If under 40% of an area's possible points were actually measured, the area
is marked *not enough data* and excluded from scoring and routing. An area judged on one working
check is noise.

### 6.2 Problem score

```
Problem = 0.6 × (worst area score)  +  0.4 × (weighted average of all areas)
```

The "worst area" term exists so a single catastrophic problem is not diluted. A business with no
website at all should not score mid-range simply because its other areas could not be measured.

**Override:** if the business has no website, a dead website, or social only, Problem is at least
**90** and the route is forced to Web development.

### 6.3 Intent score — are they alive and spending

Separate from Problem. These are credits; a missing signal adds nothing and never subtracts.

| ID | Signal | Points | Class |
|---|---|---:|---|
| N1 | Has any tracking pixel installed | 20 | FREE |
| N2 | Currently running Meta ads | 25 | PAID |
| N3 | Got a Google review in the last 30 days | 15 | PAID |
| N4 | Getting 2 or more reviews a month | 10 | PAID |
| N5 | Posted on social in the last 30 days | 15 | BEST EFFORT |
| N6 | Website updated in the last 12 months | 10 | FREE |
| N7 | Google listing is claimed | 10 | PAID |
| N8 | More than one location | 10 | PAID |
| N9 | Hiring — jobs listed on the site | 10 | FREE |
| N10 | Pays for a tool — booking, chat, or CRM widget | 10 | FREE |

Capped at 100.

### 6.4 Tiers

| | Problem ≥ 55 | Problem < 55 |
|---|---|---|
| **Intent ≥ 35** | **Tier 1** — needs help and spends money | **Tier 2** — active, needs a different angle |
| **Intent < 35** | **Tier 3** — real problems, no spending history | **Tier 4** — lowest priority |

Intent's threshold is lower than a typical B2B model would use, because a small local business
simply has fewer visible spending signals than an online brand.

**Tier changes priority, never eligibility.** Every business stays visible, claimable, and
included in every export.

### 6.5 Which service to pitch

The area with the highest score wins. When the top two are within 5 points, this order decides:

1. **Web development** — forced when there is no working website; nothing else can be sold until
   there is one
2. **Local SEO** — for a local business, being findable is where customers actually come from
3. **Reputation** — reviews drive local buying decisions more than anything on the website
4. **Contactability** — cheap to fix, immediate effect
5. **Social media** — slower to show return
6. **Advertising** — requires budget and needs the rest working first

**A route must have evidence.** If the winning area has no check that actually fired with a
stored result, the business goes to manual review instead of getting a route. A recommendation
with nothing to show is not a recommendation.

The operator can override the route, and the override is logged.

---

## 7. Identity and deduplication

Grid search guarantees duplicates — the same shop is returned by every overlapping search
circle. On top of that, the same business often appears with slightly different names across
Places and directories.

**Identity keys, strongest first:**

| Rank | Key | Notes |
|---:|---|---|
| 1 | Google Place ID | Google's own identifier. Most reliable |
| 2 | Website domain | Where a site exists |
| 3 | Phone number | Normalised to E.164 |
| 4 | Facebook page ID | Social-only businesses |
| 5 | Normalised name + rounded location | Weakest. Manual review |

All keys are stored together and any one of them resolves to the same business. The internal
record ID never changes.

**Merge rules:**

- A matching Place ID or domain updates the existing business; it never creates a second one
- A phone number alone never merges two records — chains and franchises share numbers
- One phone attached to more than three different names goes to manual review
- Conflicting values are kept with their sources; nothing is silently overwritten
- When two existing records turn out to be the same business, the older record survives, all
  keys and history move to it, and a full snapshot of both is stored first so the merge can be
  undone

---

## 8. What the operator sees

### 8.1 The list

Sorted by tier, then Problem score. Every row shows: business name, location, whether it has a
website, review count and rating, Problem and Intent, tier, recommended service, and whether a
contact was found.

Filters: tier, recommended service, website state, review count, rating, has phone, claimed or
unclaimed by a team member.

### 8.2 The business page

Ordered by what someone needs in the first fifteen seconds before dialling:

1. **Name, phone, address, website link** — with a claim button
2. **Why this lead** — the recommended service, the reason, and the top three findings
3. **Findings** — grouped by area, each showing what was measured against the threshold,
   including checks that passed and checks that could not run
4. **What they have online** — website, every social platform found, Google listing
5. **Suggested opening line** — for a call and for a message, each naming the finding it uses
6. **Where each value came from** — source and date for every field
7. **History** — when found, when analysed, any outreach logged

### 8.3 Display rules

- A value that was measured and a value that was guessed never look the same
- `Unknown` and `Not found` are shown as labelled states, never as a blank cell
- A check that could not run appears under **not measured** — hiding it would imply it passed
- Every suggested opening line names the finding it came from. If it cannot, none is generated

---

## 9. Pipeline

| Stage | What happens | Cost |
|---|---|---|
| **0 · Plan** | Validate the search, build the grid, estimate the number of searches and the cost, ask the operator to confirm | free |
| **1 · Discover** | Run the keyword at every grid point, collect raw results | **paid — the main cost** |
| **2 · Deduplicate** | Merge repeats, resolve identity, remove existing clients and do-not-contact matches | free |
| **3 · Classify presence** | Decide website state for every business (§4) | free |
| **4 · Free analysis** | Fetch every website, run all FREE checks, run PageSpeed | free |
| **5 · Gate** | Score using free checks only. Businesses below the cut-off stop here — kept and visible, but nothing further is bought for them | free |
| **6 · Paid analysis** | Google listing details and search rankings, for businesses that passed | paid |
| **7 · Social analysis** | Read what each platform allows; record *not measured* where blocked | free |
| **8 · Score and route** | Final Problem and Intent, tier, recommended service | free |
| **9 · Review** | Anything uncertain goes to a human queue | — |
| **10 · Outcome** | Operator logs what happened after outreach | — |

**The gate at Stage 5 is what keeps the cost down.** Every business gets the free website
analysis. Only the ones that already look like they have a problem get the paid lookups.

---

## 10. Cost

### 10.1 What costs money

| What | Where from | Rough cost |
|---|---|---|
| Finding the businesses | Google Places search, across the grid | per search request |
| Listing details — reviews, hours, photos | Google Places Details | per business |
| Search rankings | A search-results service | per lookup |
| **Everything else** | **Their own website, read by us** | **$0** |

### 10.2 A worked example

`"screen printing" + Miami + 200 miles`

| Step | Volume | Cost |
|---|---:|---:|
| Grid searches (150 points × 3 pages) | 450 requests | ~$14 |
| Raw results before deduplication | ~9,000 | — |
| Unique businesses after deduplication | ~2,800 | — |
| Free website analysis | all 2,800 | **$0** |
| Pass the gate | ~350 | — |
| Listing details | 350 | ~$6 |
| Search rankings | 350 | ~$7 |
| **Total for one city and niche** | | **~$27** |

Prices are placeholders until the accounts are opened. What matters is the shape: **discovery is
now the main cost, and everything about the business's own website is free.**

### 10.3 Controls

Every run declares a maximum number of businesses and a maximum spend. A run that reaches its
limit stops cleanly and keeps everything it has already done. Exclusions are matched before any
paid lookup.

The lever, when a run would cost too much, is **raising the gate cut-off** — fewer businesses
get the paid lookups. The depth of analysis on the ones that do pass is never reduced.

---

## 11. Parked — decided later, not forgotten

Two of these are genuine technical walls. Three are cost or risk decisions to revisit once the
system is working.

| Item | Why parked | What we do instead |
|---|---|---|
| **Website visitor counts** | **Wall.** Visits are recorded on that site's own server. Only the owner can see them. Estimate tools have no sample for a small local business | Track review count over time. Six new reviews in a month implies roughly 150–500 customers — a truer demand signal for a local business than web traffic |
| **Meta ad reach and impressions** | **Wall.** Meta publishes these only for political ads | Meta Pixel in the site HTML, plus how many ads are running and for how long |
| **Semrush / Ahrefs subscription** | Cost decision. CEO: revisit after the system is built | Google listing data and search rankings |
| **LinkedIn activity** | Blocked aggressively; obtainable only through paid third parties who take that risk. Low value for local businesses — a plumber has no LinkedIn strategy | Record only whether a LinkedIn link exists on their site |
| **Names of people who like or comment** | Third parties' personal data; requires logged-in scraping. CEO: counts for now, names later if a specific need appears | Engagement counts and post recency |

---

## 12. Build order

Phase 0 runs alongside everything and gates Phase 5.

| Phase | What gets built | Done when |
|---|---|---|
| **0 · Manual proof** | Do 40 businesses by hand in one niche and city. Record how long each takes, what was findable for free, and which findings got replies | A repeatable pitch pattern with evidence of what worked |
| **1 · Data model** | Business records, identity keys, deduplication, merge, provenance, exclusions. Unit tests | The 40 manual businesses import with no duplicates, and re-importing creates nothing new |
| **2 · Platform** | Login, roles, list, business page, filters, claim, CSV export, manual entry | The team can work entirely from the tool on hand-entered data |
| **3 · Discovery** | Places grid search, deduplication wired in, presence classification, run limits | A niche and city returns a deduplicated list with website state on every row |
| **4 · Free analysis** | Website crawler, all FREE checks, PageSpeed, the gate | Every business carries a free score, and the crawler behaves under the rules in §13 |
| **5 · Paid analysis and scoring** | Listing details, search rankings, social reads, scoring, routing, opening lines | Every finding carries evidence and every score shows its signals |
| **6 · Feedback** | Outcome logging including which finding was used and what objection came back | Enough outcomes to start adjusting the model |

---

## 13. Crawling rules

The free website analysis is the heart of the system, so it behaves properly.

- Honest user agent identifying AheadTech360, with a contact URL. Never disguised as a browser
- `robots.txt` fetched first and respected. A site that blocks everything is recorded as such
- One request at a time per site, at least 2 seconds apart
- At most 10 pages and 30 seconds per business; 15 seconds per request
- Never behind a login. Never submit a form
- **A blocked or failed fetch is recorded as *not measured*, never as a pass.** Recording a site
  we could not read as a site with no problems would corrupt the score that decides where the
  money goes, and it would do it silently

---

## 14. Still to decide

| # | Decision | Needed by |
|---:|---|---|
| 1 | Which niches and cities to start with | Phase 0 |
| 2 | Confirm Google Places pricing and quota against a real 200-mile grid search | Phase 3 |
| 3 | Which search-ranking provider | Phase 5 |
| 4 | Verify what the Meta Ad Library actually returns for a small US business | Phase 5 |
| 5 | How long a claimed lead stays claimed before it is released | Phase 2 |
| 6 | US calling and messaging compliance review | Before outreach scales |

Item 2 is the one that could change the cost model materially. A 200-mile radius is a large
grid, and the search requests are the largest single line in §10.
