# Member side — nothing lost, nothing borrowed from the admin

Every capability a member has, checked against the design in
`design/ui/lead-intel-user.html`. Built from `user-side-functionality.md` and the live app, not
from memory. The checklist is the one in the design brief, item for item.

**Result: 42 of 42 have a location. 0 admin-only capabilities appear anywhere on the member side.**

Three states are used throughout and they mean different things:

| Mark | Meaning |
|---|---|
| **built** | works in the product today |
| **soon** | agreed and specified, not built — drawn wearing a *Not built yet* marker so nobody mistakes it for working |
| **admin** | deliberately absent from the member side |

---

## The brief's checklist

| # | Capability | Where it lives | State |
|---|---|---|---|
| 1 | Dashboard | Dashboard | built |
| 2 | Leads | My leads | built |
| 3 | Lead detail | My leads → row → Overview | built |
| 4 | Claim | lead header · bulk bar · Claimed filter | built |
| 5 | Release | lead header → confirm modal | built |
| 6 | Manual add | Add businesses drawer → Add a business | built |
| 7 | CSV import | Imports → Import a list (4 steps) | built |
| 8 | Import results / history | Imports · one import's own screen | built |
| 9 | Export | Leads header · bulk bar · Export drawer | built |
| 10 | Website analysis | lead → Analyse · bulk bar · never-analysed strip | built |
| 11 | 64 checks | Checks & scores, six areas + intent | built |
| 12 | Evidence | every check row carries its evidence and its source | built |
| 13 | Problem score | Overview → The two scores · Checks & scores | built |
| 14 | Signals score | same, kept visually apart because it answers a different question | built |
| 15 | Priority | lead header · Leads column · Priority rules | built |
| 16 | What to sell | Overview · Leads column · dashboard breakdown | built |
| 17 | Website pages | lead → Website pages, one row per page + page drawer | built |
| 18 | Browser page reading | Website pages → Read them again → priced modal | built |
| 19 | Instagram | Social & Instagram · lead Overview | built |
| 20 | Instagram bulk lookup | Social & Instagram → *Could be looked up* → bulk bar | built |
| 21 | Meta ads | Social & Instagram → Meta ads · Buy data 3 · checks D5/N2 | built, never run |
| 22 | Google listing enrichment | Buy data 1 · imported-leads strip · dashboard next-action | built |
| 23 | Paid confirmation | a modal per purchase: what, why, how many, price, provider, cap, budget | built |
| 24 | Spend cap | stated on every purchase modal and on the task | built |
| 25 | Budget protection | Buy data → Your budget · the *stops you first* modal | **soon** |
| 26 | Tasks | Tasks, with all six states explained | built |
| 27 | Task progress | banner on every screen · task detail · known vs unknown size | built |
| 28 | Task stop | task row · task detail · stop modal with what is kept | built |
| 29 | Calls | lead → Log a call drawer | built |
| 30 | Call history | lead → Calls & history · the member's own Calls screen | built |
| 31 | ICPs | ICPs, read-only, with the matching order explained | built, read-only |
| 32 | Checklists | Checklists, read-only | built, read-only |
| 33 | Priority rules | Priority rules — what is live, and what is coming | built, read-only |
| 34 | Spend | My spend — own ledger, own providers, own cost per lead | built |
| 35 | Notifications | bell panel · Notifications screen, nine events | **soon** |
| 36 | Transfer request | bulk bar → Transfer drawer · Transfers screen | **soon** |
| 37 | Showcase | Showcase, read and post | **soon** |
| 38 | How It Works | How this works, six steps in plain words | built |
| 39 | Theme | account menu → Appearance (light / dark / device) | built |
| 40 | Sign out | account menu → confirm modal | built |
| 41 | Loading states | Screen states → Working (3 kinds) | built |
| 42 | Empty · error · success states | Screen states → three sections, 10 cards | built |

---

## What a member never sees

Checked by reading every screen in the file rather than by trusting the navigation.

| Admin capability | Where it is on the member side |
|---|---|
| Google Maps search | **nowhere** — named once, in the Add businesses drawer and in How it works, marked *Administrator only* with the reason |
| Assigning leads to people | nowhere |
| Adding or editing users | nowhere |
| Setting budgets | nowhere — a member sees only what they have left |
| Approving transfers | nowhere — a member asks, and waits |
| Company-wide analytics | nowhere |
| Another member's leads, calls, spend, tasks or notifications | nowhere |
| Editing ICPs, checklists or priority rules | nowhere — all three say *read-only* at the top rather than implying it through missing buttons |

Every count on every screen is this member's own: 84 leads, 29 worth calling, 11 Priority 1, $0.41
spent. The number 559 — the whole company's — appears nowhere.

---

## Things the design refuses to invent

Named in `user-side-functionality.md` §26 as *not found*, and therefore not drawn:

- a profile page, a display name, a password change, email or notification preferences
  — the account menu says so instead
- editing arbitrary lead fields — only the website and Instagram URL can be changed
- deleting or archiving a lead as a member
- sorting by clicking a column heading — said plainly in the Columns drawer
- a "follow-ups due today" screen — the Calls filter is how you find them, and the design says so
- a retry button on a failed task — running it again *is* the retry
- checklist weights
- credits or top-ups — spend is real money
- Facebook page activity — no source exists

And two filters stay visible, switched off, with their reason: **budget** and **revenue**.

---

## What the render caught that reading could not

- A grid with no explicit columns gets an auto track, and an auto track is sized by its content
  rather than its container — so one card holding a 560px table dragged a whole column past the
  edge of a phone. `.stack` fixes it; the table keeps its own scrollbar.
- The act bar carries seven buttons and pushed the page 464px sideways at 390px wide. It wraps now,
  and sits above the bottom navigation rather than under it.
- **Contrast was measured, not judged.** Primary buttons were white on pale cyan in dark mode
  (2.4:1) and the inverted act bar was white on a light ground (1.2:1). `--on-accent` fixes the
  first; the bar now takes its ink from `--app`.
- `--good`, `--warn`, `--bad` and `--ai` are *mark* colours — right for a 6px dot, about 4.7:1 as
  11px type on their own tint. Four label inks were added and every status label routed through
  them. The two palest inks in the scale were darkened as well, because this product uses them for
  10–12px type everywhere. **Every piece of text on every screen now clears 7:1 in both themes, and
  small print clears ~9:1.**
- An intent check that fires is *good* news, so `$` wears the money colour rather than the colour
  of a problem.

Verified programmatically on all screens, drawers and modals, in both themes, at 1440px
and 390px: 0 page errors, 0 broken table cells, 0 elements overflowing their container, 0
horizontal scroll on a phone, and every `data-go` target resolves to a real screen.

---

# Second pass — the audit

The first pass built the member side. This pass audited it against the brief and the
specification, found six real holes and a set of smaller faults, and closed them. **Nothing was
removed.** Two things moved; everything else was added or tightened.

## What the audit found, and what was done about it

| # | What was wrong | Where it was | What changed | Why | Functionality |
|---|---|---|---|---|---|
| 1 | **The analysis had no home.** The 64 checks, coverage and failed pages existed only inside one lead, so a member could not ask "which of mine are standing on nothing" or "what could not be read" | per-lead *Checks & scores* tab only | **New screen: Website analysis** — coverage per area across the member's leads, the 9 scored on too little, the 14 pages that could not be read grouped by reason, and what the 64 checks cover | The brief's own IA asks for it, and it is the question a salesperson asks before trusting a score. Every figure on it already exists | **added**; the per-lead tab is untouched |
| 2 | **`explainBusiness` was missing entirely** — a supported paid feature (~0.3¢, Google AI Studio) | nowhere | Added to the lead's *What to say* card, with a confirmation modal | A paid feature that cannot be reached is a removed feature | **restored** |
| 3 | **No way to type in an Instagram handle.** `saveInstagramUrl` is built and free | nowhere | New *Instagram account* drawer from the lead, free to save, with the 0.26¢ lookup as an opt-in tick | It is the only way to fix a wrong handle, and a wrong handle wastes the 0.26¢ | **restored** |
| 4 | **Claim was only reachable by ticking a row.** A member reading one lead could not claim it | bulk bar only | Added *Claim it* on an unclaimed row, and the claimed badge now explains what claiming and releasing do | The brief: primary actions must not be buried | **added path**, bulk bar unchanged |
| 5 | **Nine destinations were unreachable on a phone.** The bottom bar had five fixed buttons | mobile nav | The fifth button is now **More**, a sheet listing every destination grouped as the sidebar groups them | Hiding half the product on a phone is hiding functionality | **added** |
| 6 | **Tasks sat under "Find out more" beside Instagram** — a piece of work filed under learning | sidebar | Navigation regrouped to **Workspace · Intelligence · Work · Data · Reference · Shared**, with Calls joining Tasks under Work and Screen states moved under a *For this preview only* label | A member should not have to learn an arbitrary grouping | **moved**, nothing lost |

## Smaller faults, same pass

| What | What changed |
|---|---|
| The dashboard's two columns were a card and a half apart in height, leaving a band of nothing | the "no answer yet" note became the last row of the list it belongs to |
| `.act` ran a title and its detail into one line — *"Logged a call — Kirra's BraidsInterested · call back Friday"* | the title is its own line |
| Priority rules showed **drag handles** on rules a member cannot reorder | handles replaced with *1st · 2nd* |
| The spend ledger was a dead end | every charge now links to the lead, the task or the pages it paid for |
| Scores had no explanation at the point of scanning | the four score columns carry what they mean on hover |
| The sidebar grew to sixteen destinations and pushed the user chip off a laptop screen | the destinations scroll; the chip is pinned |
| The clear-selection button carried `color:#fff` inline — 1.2:1 on the act bar in dark | inline colour removed, so it takes the bar's own ink |
| Two nav counts used mark colours as 11px type | routed through the label inks |
| Density: a data-heavy product with 11px of padding per table row | rows, cards, sections and the sidebar all tightened 2–3px. **No type size changed** |

## Re-verified after the audit

**27 screens · 12 drawers · 11 modals**, both themes, 1440px and 390px:

- 0 page errors · 0 broken table cells · 0 elements overflowing their container · 0 horizontal
  scroll on a phone
- every `data-go` target resolves to a real screen; every drawer and modal reference has a panel
- contrast swept across every text element in both themes: **1 element under 7:1 before the last
  fix, 0 after**
- the sidebar's user chip is on screen at 760px tall; the phone's bottom bar reads 8.2–10.4:1

All 42 items of the brief's preservation checklist still have a location. The admin boundary was
re-checked line by line: Maps search appears twice, both times as *Administrator only* with the
reason, and nothing else admin-only appears anywhere.
