# Lead Intel — more than one person

**Status:** agreed structure, not yet built. No code has been written against this.
**Decided by:** the operator, in answer to seven questions, 15 October 2026.

Today Lead Intel has one account and one list. Everything in the database is visible to whoever
signs in, every screen assumes a single operator, and `user_roles` holds exactly one row. This
describes what it becomes when a team uses it: who may do what, whose leads are whose, how work is
handed out, and how priority stops being a formula and becomes a policy the operator writes.

It is a structure, not a design. Screens come next.

---

## 1. The decisions this rests on

Seven, each answered rather than assumed. They are recorded here because every section below is a
consequence of one of them, and changing one changes the shape of the product.

| # | Question | Answer |
|---|---|---|
| 1 | Two users' searches find the same business | **One record. Whoever found it first keeps it.** |
| 2 | ICPs, checklists, priority rules | **One set for everyone, written by the admin.** |
| 3 | Who may spend money | **A user may, up to a limit the admin sets. Scraping is admin-only.** |
| 4 | The 559 businesses already here | **To the admin, then handed out.** |
| 5 | How much budget, over what period | **The admin picks the amount per person.** |
| 6 | Does a user see anything of another's | **Nothing. A Showcase screen exists for what people choose to share.** |
| 7 | Call history | **A user sees their own calls; the admin sees everyone's.** |
| 8 | What a Showcase post may carry | **Anything you made — a lead, or the settings you wrote.** |
| 9 | Who may move a lead | **Whoever owns it, and the admin.** |
| 10 | A person's leads when their account goes | **They go to the admin, who decides.** |
| 11 | Handing leads to a colleague | **The sender asks; nothing moves until the admin approves.** |
| 12 | Who a member may ask to transfer to | **Anyone on the team.** |
| 13 | A refused transfer | **May be asked again after a day.** |
| 14 | Telling people what happened | **A notification list each — yours shows your own.** |

Answer 6 is the strictest of them and it decides more than it looks. There is no "12 of these are
already someone else's" line in a search result, no shared counts on a dashboard, no leaderboard.
What one person has is invisible to another unless that person deliberately posts it.

---

## 2. Two roles, and what each may do

| | Admin | Member |
|---|---|---|
| Find businesses (Google Maps search) | yes | **no** |
| Import a file · add one by hand | yes | yes |
| Analyse, read pages, re-score | yes | yes, on their own leads |
| Buy paid data | yes, no limit | yes, **up to their budget** |
| See leads | everyone's | **their own only** |
| ICPs · checklists · priority rules | write | read |
| Tasks | everyone's | their own |
| Calls & history | everyone's | their own |
| Data & spend | the whole bill, per person | **their own spend only** |
| Showcase | post and read | post and read |
| Add users · hand out leads · set budgets | yes | no |

Scraping is admin-only because it is the one action that both costs money *and* creates records
out of nothing — the two things worth keeping in one pair of hands. Importing a file is free and
creates records from something the user already has, so it stays open.

---

## 3. Whose lead is it

`businesses.owner_id` — the person it belongs to. `null` means nobody's yet: the **pool**, which
only the admin can see.

Set when the record is created: a search assigns to whoever the admin names, an import to the
person who uploaded it, a manual add to whoever typed it.

**Collision.** Deduplication already exists and is global (`identity_keys`), so the same business
is never stored twice. If an import or a search turns up a business that already has an owner, it
stays with that owner and the new run says nothing about it — per decision 6, not even a count.
The business is simply not among the results the importer sees.

**Row-level security.** `businesses`: `owner_id = auth.uid() OR private.is_admin()`. The tables
hanging off a business — `findings`, `field_metadata`, `page_audits`, `outcomes`, `identity_keys`
— follow the business's owner through an `EXISTS` on the parent. The worker is unaffected: it
connects with the service role, which RLS does not apply to, so every background job keeps running
exactly as it does now.

**The 559 already here** become the admin's in the migration that adds the column, and are handed
out from there. Nothing is lost and nothing becomes invisible to the person who has been using the
product.

**Moving one.** The owner may let a lead go back to the pool, and the admin may move any lead
anywhere. Handing one directly to a named colleague is different and is covered in section 5 —
giving a lead up is a decision about your own work, while giving it to a particular person is a
decision about somebody else's, which is why only the first needs no permission.

**When a person leaves.** Removing an account hands their leads to the admin rather than deleting
them or leaving them orphaned. The admin then decides, with the whole set in one place and marked
as having come from that person.

---

## 4. Handing out leads

Three places, because three different moments call for it:

1. **When a search or an import finishes** — "423 new. Who gets them?"
2. **From the leads list** — tick rows, *Assign to…*
3. **From the Team screen** — each person with their counts, and a way to top them up

**How a batch is split:** *N leads to [person]*, taken in priority order from the pool; or by ICP
or by place; or shared round-robin between several people. Every assignment records `assigned_by`
and `assigned_at`, so "who gave whom what" is answerable later.

---

## 5. Handing a lead to a colleague

A member may ask to pass leads to another member. **Nothing moves until the admin says so**, and
if the admin refuses, the leads stay exactly where they were.

The approval is not bureaucracy for its own sake. Letting a lead go back to the pool costs nobody
anything — the admin redistributes it. Handing one to a *particular* person is a decision about
somebody else's work and somebody else's commission, and that is the kind of decision that wants a
second signature.

**How it goes:**

1. The sender ticks leads on their list and chooses *Transfer to…*, naming **anyone on the team**
   and, if they want, a line about why.
2. The request waits. The leads stay with the sender and stay fully usable — a pending request
   changes nothing on the ground.
3. The admin sees it on the Team screen with a count beside it, and approves or refuses. A refusal
   takes a reason, which the sender reads.
4. On approval the leads move, and the move is recorded like any other assignment.

**A lead that has moved on.** If a lead is no longer the sender's by the time the admin looks — it
was released, or the admin moved it — that one is skipped and the decision says so. The rest go.
A request never resurrects a claim that has already lapsed.

**After a refusal**, the same leads may be asked for again **a day later**. Long enough that a no
is a no rather than something to be worn down by repetition, short enough that a changed
circumstance — a call that went somewhere, a region that moved — is not blocked for a week.

---

## 6. Adding a user, without moving a key

Creating a Supabase user needs the **service role key**, and this project has a standing rule that
the key never appears in `apps/web` or on Vercel — it belongs to the worker alone.

So the web app does not create users. **Add user** triggers a worker task; the worker, which
already holds the key, creates the auth user and the profile row. The key stays where it is.

A new `profiles` table carries what the interface needs — id, email, display name, role, budget —
because `auth.users` is not readable from the app, and every screen that names a person needs
somewhere to read the name from.

---

## 7. Priority, written by the operator

One line governs this section:

> **A score is a measurement. A priority is a decision.**

Problem and Signals stay exactly as they are: arithmetic over findings, the same for everybody,
not editable. What changes is that the 2×2 grid — problem ≥ 55 and intent ≥ 35 — stops being the
last word on what to call first. The operator writes that.

**Priority rules** work like ICPs: an ordered list, first match wins, free to re-run, written by
the admin and applied to everyone's leads.

A rule is a name, a priority number (1–4), and conditions that must all hold. Conditions are
chosen from a fixed list, because a free-text rule is a rule nobody can evaluate:

| Condition | What it takes |
|---|---|
| Website | no website · dead · working · couldn't check |
| Problem score | from [ ] to [ ] |
| Signals score | from [ ] to [ ] |
| Google reviews | from [ ] to [ ] |
| Google rating | from [ ] to [ ] |
| Instagram followers | from [ ] to [ ] |
| Running Meta ads | yes · no |
| ICP | one of the operator's ICPs |
| Where | town or state |
| What to sell | one of the six routes |
| Email or phone found | yes · no |

Two rules carry over from the ICP matcher and matter as much here: **an unknown fact never
passes** a condition, and a lead that matches no rule gets a stated default priority with the
reason written on it rather than silently landing at the bottom.

---

## 8. Money

The admin sets, per person, an **amount** and a **period**: once, weekly or monthly. "Once" is a
wallet that does not refill — the honest default for money, since nothing is spent by accident and
nothing quietly replenishes.

What has been spent comes from `provider_calls`, which is written before each paid call and
therefore cannot flatter itself. A member sees their own spend and what is left; the admin sees
every person's and the total.

A paid action with nothing left refuses **before** anything is bought, and says how much is left
and what the action would cost — in keeping with every other price in this product.

---

## 9. Showcase

The one place where work is visible across the team, and it is opt-in by construction.

Anyone, admin or member, can post: a heading, what they want to say, and optionally **something
they made**. Everyone can read it.

What can be attached:

| Attachment | Who has one to share | What the reader gets |
|---|---|---|
| A lead | anyone | only the fields the author ticks — see below |
| A saved view (a set of filters) | anyone | the filters, and a button to use them on their own list |
| An ICP · a checklist rule · a priority rule | the admin, who writes them | the rule as written, and what it catches |

Attaching a **lead** attaches **only what the author ticks to show** — its name, what was wrong
with it, what was sold. It does not hand over the record. There is a separate, explicit "share the
whole record" for when that is actually meant, and a lead shared that way says so plainly on its
own page, so nobody discovers later that their list was readable.

Attaching a **setting** is different in kind: a saved view or a rule is a method, not somebody's
data, so it is shared whole. A reader can copy a saved view straight onto their own list.

**Editing and taking down.** The person who posted it, and the admin. Nobody else, including
another member whose lead happens to be mentioned — if that becomes a problem it is a problem
between people and the admin, not something a permission check should arbitrate silently.

This screen exists because decision 6 closed every other window between people, and a team still
needs one.

---

## 10. Telling people what happened

Every person has their own list. **Yours shows what happened to you and what you did** — the admin
is not sent a member's notifications, and a member never sees another's.

What writes one:

| Event | Who hears about it |
|---|---|
| A task finished, or stopped, or never started | whoever started it |
| Leads assigned to you | the person receiving them |
| A transfer request arrives | the admin |
| A transfer approved or refused | the person who asked |
| Leads arrive from a transfer | the person receiving them |
| Something deleted — a task, an import, a lead | whoever did it, and the admin if it was not them |
| A paid lookup finished, with what it cost | whoever spent it |
| Budget run out, or topped up | the person it belongs to |
| A new Showcase post | everyone |

Each one carries a line about what happened and a link to where it happened, so the list is a way
in rather than only a record.

**It is a list, not an alarm.** The toast that appears for five seconds when a task finishes stays
as it is — that is for the thing in front of you. This is for what happened while you were
elsewhere: a count on the bell in the top bar, a panel of the recent ones, and a page for the rest.
Read is a state on each row, and opening the panel does not blanket-clear it — a notification you
have not acted on should still be there tomorrow.

Written from both sides: the web app writes them as the operator acts, and the worker writes them
when a job ends. The worker already holds the service role, so it needs nothing new to do it.

---

## 11. The screen that keeps pulling people back

A live fault, and the cause is known rather than suspected.

`RunningJobs` emits `<meta http-equiv="refresh" content="10">` while a task is running. Next's
client-side navigation does not replace the document, so when the refresh fires it reloads **the
URL the meta was parsed with** — dragging the operator back to the page they left. Reproduced in a
real browser: after navigating to `/login?moved-to-another-page=1`, the refresh landed on
`/login`.

The fix is a small client component — refresh the route data after ten seconds, cancel on unmount.
It is a deliberate exception to this product's no-client-JavaScript rule, confined to one file.
The rule was always a means to an end — a product that works without scripts — and here it is
producing the opposite.

---

## 12. What changes in the database

| Change | Why |
|---|---|
| `profiles` (new) | names, roles and budgets the app can actually read |
| `user_roles` gains `member` | only `admin` exists today |
| `businesses.owner_id`, `assigned_by`, `assigned_at` | ownership and its audit trail |
| RLS rewritten on `businesses` and its children | every table currently reads `select: true` |
| `priority_rules` (new) | section 7 |
| `showcase_posts` (new) + its attachments | section 9 |
| `lead_transfers` (new) | section 5 — who asked, for what, and the admin's answer |
| `notifications` (new) | section 10 — one list per person |
| `job_runs.target_business_ids` | so "See the leads" shows that task's leads |
| `profiles.budget_cents`, `budget_period` | section 8 |

---

## 13. Order of work

| Phase | What | What it looks like when done |
|---|---|---|
| **0** | The refresh fault | Navigation stops snapping back. Small, and already diagnosed. |
| **1** | profiles · roles · ownership · RLS · the 559 to the admin | Nothing visibly changes for the admin. The foundation is laid. |
| **2** | Adding users · Team screen · assignment · transfers | A second person can sign in, has leads, and can ask to pass them on. |
| **3** | Permissions across the screens · budgets | A member sees only their work, and cannot overspend. |
| **4** | Priority rules | The operator decides what gets called first. |
| **5** | Tasks: filters, delete, and leads scoped to the task | |
| **6** | Showcase | |

---

## 14. Still open

Nothing that blocks building. Two that will want an answer once it is in use:

- How long a notification stays before it is cleared out.
- Whether a member may release a lead back to the pool freely, or only one they have not yet
  called — a question that only matters once somebody tries it.
