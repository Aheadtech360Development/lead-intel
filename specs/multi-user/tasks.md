# What we are building — the points

Against `specs/multi-user/spec.md`. Nine stages, in dependency order: each one leaves the product
working, and nothing in it waits on a stage below.

A point is done when its **check** is true. Checks are written so they can be shown on screen or
run as a query, not argued about.

---

## Stage 0 — Stop the screen pulling people back

The one live annoyance. Small, already diagnosed, and nothing else depends on it.

| # | Point | Check |
|---|---|---|
| 0.1 | Replace the `<meta http-equiv="refresh">` with a small client component that refreshes the route after ten seconds and cancels when the page changes | With a task running, go from Leads to ICPs and stay there for a minute. You stay on ICPs. |
| 0.2 | Keep the refresh off every screen with a form in it, as it is now | Open a checklist rule, type, wait a minute. What you typed is still there. |

---

## Stage 1 — Foundation: who is who, and whose lead is whose

Nothing visible changes. Everything after this depends on it.

| # | Point | Check |
|---|---|---|
| 1.1 | `profiles` table — id, email, display name, role, budget amount, budget period — filled from `auth.users`, kept in step by a trigger | Every existing account has a row. |
| 1.2 | `member` added beside `admin` in the role list | A profile can be set to either. |
| 1.3 | `businesses.owner_id`, `assigned_by`, `assigned_at` | The columns exist and are indexed on `owner_id`. |
| 1.4 | All 559 existing businesses become the admin's | `select count(*) from businesses where owner_id is null` returns 0. |
| 1.5 | RLS on `businesses`: owner or admin | Signed in as a member with no leads, the list is empty rather than everyone's. |
| 1.6 | RLS on everything hanging off a business — findings, field_metadata, page_audits, outcomes, identity_keys | A member cannot read a finding belonging to a lead that is not theirs, by any route. |
| 1.7 | RLS on `job_runs`, `import_batches`, `outcomes`: own or admin | A member's Tasks page shows only their own. |
| 1.8 | Confirm the worker is unaffected | Run one free task. It completes exactly as before. |

---

## Stage 2 — Users, and handing out leads

| # | Point | Check |
|---|---|---|
| 2.1 | **Add user** in the web app triggers a worker task; the worker creates the auth user and the profile. The service-role key never enters `apps/web` | A new person can sign in. `grep -r SERVICE_ROLE apps/web` finds nothing. |
| 2.2 | **Team** screen: everyone, their role, their counts — assigned, worth calling, called — and their budget | The admin sees the team; a member cannot open it. |
| 2.3 | Assign from the leads list: tick rows → *Assign to…* | 10 ticked leads move to a named person and show on their list. |
| 2.4 | Assign when a search or an import finishes: "423 new — who gets them?" | Nothing lands unassigned unless the admin says so. |
| 2.5 | Split a batch: N to a person, taken in priority order; or by ICP; or by place; or shared round-robin between several | "50 to each of 3 people" gives 50, 50, 50 and leaves the rest in the pool. |
| 2.6 | Every assignment records who did it and when | The Team screen can show "given by Admin, 14 Oct". |
| 2.7 | Owner may release a lead back to the pool; admin may move any lead | A member releases one; it leaves their list and appears in the admin's pool. |
| 2.8 | Removing a person hands their leads to the admin, marked as theirs | After removal no lead is orphaned, and the admin can see where they came from. |

---

## Stage 3 — What a member may do, and what they may spend

| # | Point | Check |
|---|---|---|
| 3.1 | **Find businesses is admin-only** — hidden from the sidebar for a member, and refused on the server if reached by address | A member opening `/search` is turned away with a reason, not a blank page. |
| 3.2 | Import, add by hand, analyse, read pages, re-score stay open to members, on their own leads only | A member can analyse their own lead and cannot analyse one that is not theirs. |
| 3.3 | ICPs, checklists and priority rules are read-only for a member | The forms are not shown; the lists are. |
| 3.4 | Budget per person — amount and period (once, weekly, monthly), set by the admin on the Team screen | Admin sets $5 monthly on a member. It shows on their Data & spend. |
| 3.5 | A paid action checks the remaining budget **before** buying, and refuses with what is left and what it would cost | With 20¢ left, a $1.20 purchase is refused and nothing is spent. |
| 3.6 | Spend is counted per person from `provider_calls` | A member sees their own; the admin sees everyone's and the total. |
| 3.7 | Every disabled control says why, as the rest of the product does | Hovering a refused paid button gives the reason, not a dead button. |

---

## Stage 4 — Notifications

The spine goes in here because three stages after this write to it.

| # | Point | Check |
|---|---|---|
| 4.1 | `notifications` table — person, kind, line, link, read state, time | Rows can be written from the web app and from the worker. |
| 4.2 | Bell in the top bar with the unread count; a panel of the recent ones; a page for the rest | The count matches `select count(*) ... where read_at is null`. |
| 4.3 | Read is per row. Opening the panel does not blanket-clear | A notification you did not open is still unread tomorrow. |
| 4.4 | Wire the events that already exist: task finished · stopped · never started · a paid lookup and what it cost | Finish a task. One notification, for the person who started it. |
| 4.5 | Wire assignment: leads assigned to you · leads taken away | A member is told "40 leads assigned to you" with a link to them. |
| 4.6 | Wire deletions: a task, an import, a lead — the person who did it, and the admin when it was not them | A member deletes a task; the admin is told. |
| 4.7 | Wire budget: run out, topped up | Spending the last of a budget writes one. |
| 4.8 | Nobody receives another person's | A member's list contains nothing about anyone else's leads or spend. |

---

## Stage 5 — Transferring leads between people

| # | Point | Check |
|---|---|---|
| 5.1 | `lead_transfers` — who asked, for which leads, to whom, the note, the state, the admin's answer | A request can be made, seen, and decided. |
| 5.2 | *Transfer to…* on the leads list, to anyone on the team, with an optional note | 10 leads are put up for transfer. |
| 5.3 | While it waits, the leads stay with the sender and stay fully usable | The sender can still call and analyse them. |
| 5.4 | The admin sees pending requests on the Team screen and approves or refuses; a refusal takes a reason | Refusing leaves every lead where it was, and the sender reads why. |
| 5.5 | On approval the leads move and the move is recorded like any other assignment | They appear on the receiver's list, "given by" the admin. |
| 5.6 | A lead that is no longer the sender's is skipped, and the decision says so | 10 asked for, 1 released in the meantime → 9 move, and the result says 1 was skipped and why. |
| 5.7 | A refused request may be asked again after a day, not before | Asking again the same day is refused with how long is left. |
| 5.8 | Notifications at each step — request to the admin, decision to the sender, arrival to the receiver | Three notifications across one approved transfer. |

---

## Stage 6 — Priority the operator writes

| # | Point | Check |
|---|---|---|
| 6.1 | `priority_rules` — ordered, named, a priority number, conditions | Rules can be written, reordered and deleted by the admin. |
| 6.2 | The condition builder: website · Problem · Signals · reviews · rating · Instagram followers · Meta ads · ICP · place · what to sell · email or phone — each with its own input, ranges where ranges make sense | A rule reading "followers 10,000–100,000 and no website → Priority 1" can be built without typing anything free-form. |
| 6.3 | First match wins, in the operator's order | Moving a rule up changes which leads it catches, visibly. |
| 6.4 | An unknown fact never passes a condition | A business whose followers nobody has bought does not match a follower rule. |
| 6.5 | A lead matching no rule gets a stated default, with the reason on the record | No lead is silently at the bottom. |
| 6.6 | Applying is free and re-runnable; a preview says what would change before it is applied | "This would move 61 leads" before anything moves. |
| 6.7 | Problem and Signals stay as they are — measured, not editable | The scores do not move when a priority rule changes. |

---

## Stage 7 — Tasks: filters, deleting, and seeing that task's leads

| # | Point | Check |
|---|---|---|
| 7.1 | Filters: state · kind · who started it · date · free or paid | "Show me everything that failed this week" is one or two clicks. |
| 7.2 | Delete finished, stopped and never-started rows; a running one must be stopped first | The row goes; what the task actually did stays. |
| 7.3 | A member deletes only their own; the admin deletes anyone's | Enforced on the server, not only hidden. |
| 7.4 | `job_runs.target_business_ids` — a task remembers what it worked on | A task started from 10 ticked leads carries those 10. |
| 7.5 | *See the leads* opens only that task's leads | Pressing it after a 10-lead task shows 10 rows, not 559. |
| 7.6 | A whole-list task says so instead of pretending to a selection | "This ran on everything" rather than a false count. |

---

## Stage 8 — Showcase

| # | Point | Check |
|---|---|---|
| 8.1 | `showcase_posts` and its attachments | Anyone can post; everyone can read. |
| 8.2 | Post a heading and a note | It appears for everyone, newest first. |
| 8.3 | Attach a lead — **only the fields the author ticks** | The reader sees those fields and cannot open the record. |
| 8.4 | "Share the whole record" is separate and explicit, and the lead's own page says it is shared | Nobody finds out later that their list was readable. |
| 8.5 | Attach a saved view, and a reader can copy it onto their own list | A member copies the admin's view and their filters change. |
| 8.6 | The admin can attach an ICP, a checklist rule or a priority rule | Shared whole — it is a method, not somebody's data. |
| 8.7 | The author and the admin can edit or take a post down; nobody else | Enforced on the server. |
| 8.8 | A new post notifies everyone | One notification each, with a link to it. |

---

## Running through all of it

These are not a stage; they are conditions on every stage above.

- **No regression in what works today.** The admin's product behaves as it does now at every point.
- **The service-role key never enters `apps/web`.** Anything needing it runs in the worker.
- **Every refusal explains itself** — a hidden button, a blocked purchase, a rejected transfer.
- **An unknown fact is never treated as a no.** The rule that already governs ICP conditions and
  the checks governs priority rules and budgets too.
- **Tests and typecheck stay green**, and each stage adds tests for what it introduced.
