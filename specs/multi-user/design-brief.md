# The nine things being added, defined

Written to be turned into a design prompt. Each one says what it is, who it is for, what screens it
adds, what screens it changes, and the rules a design for it has to keep.

Build order and acceptance checks live in `tasks.md`; the reasoning behind the decisions lives in
`spec.md`. This file is only the definitions.

---

## The one change that runs through everything

Lead Intel was built for **one person looking at one list**. Every screen assumes that: the leads
are *the* leads, the spend is *the* spend, a task is *the* task.

From here there are two kinds of person and a question attached to every object on screen —
**whose is this?** That question is the design problem. It must be answerable at a glance without
turning the product into a permissions console, and it must never be answered by showing one
person another person's work.

Three consequences a design has to carry:

1. **The same screen means two different things.** The admin's Leads screen is everyone's leads;
   a member's is theirs. Not two screens — one screen that is honest about which it is showing.
2. **Nothing leaks.** No shared counts, no "12 of these belong to someone else", no leaderboard.
   The only thing one person sees of another is what they posted to Showcase.
3. **A second clock.** Work now happens while you are not looking — leads arrive, requests are
   decided, tasks finish. The product needs somewhere that holds what happened.

---

## 1. Navigation that stays where you put it

**What it is.** A fault, not a feature. While a task is running the screen drags you back to the
page you came from. The cause is a meta refresh that reloads the URL it was parsed with.

**Who for.** Everyone.

**New screens.** None.

**Changed screens.** None visibly. The running-task banner keeps its "Refresh now" link and its
line about updating itself.

**Design note.** Worth knowing only because it explains why the banner says what it says. No design
work.

---

## 2. Accounts, roles and ownership

**What it is.** The foundation: every person has a profile, every lead has an owner, and the
database stops showing everything to everyone. A lead with no owner sits in the **pool**, which
only the admin sees.

**Who for.** Invisible to a member. The admin gains the pool.

**New screens.** None.

**Changed screens.**
- **Leads** — an owner is now a fact about a row. The admin needs to see it; a member never needs
  to be told their own lead is theirs.
- **Leads, for the admin** — a way to look at the pool as against the assigned, since "what have I
  not given out yet" becomes a daily question.
- **Empty states everywhere** — a member who has not been given anything sees empty Leads, empty
  Tasks, empty Calls. Those three screens currently say things like "nobody has looked yet", which
  is the wrong sentence for "you have not been given any yet".

**Rules to keep.** A member's screens must never hint at the size of anyone else's list. "You have
no leads yet" — not "0 of 559".

---

## 3. Team: adding people and handing out leads

**What it is.** The admin adds people, sees them side by side, and gives them leads — from a
finished search or import, from the leads list, or from the Team screen itself.

**Who for.** Admin only. A member cannot open it.

**New screens.**
- **Team** — every person as a row or a card: name, role, how many leads they hold, how many are
  worth calling, how many they have called, their budget and what is left. The admin's own row is
  among them.
- **Add person** — email, name, role, starting budget.
- **Assign** — reached three ways and the same every time: how many, to whom, taken from where
  (the pool, a search, an import, or the rows ticked), and in what order.

**Changed screens.**
- **Leads** — ticking rows gains *Assign to…* beside the actions already there.
- **After a search or an import** — the finish screen asks who gets them instead of ending.
- **Lead detail** — says who it belongs to, and lets the admin move it.

**Design problems worth naming.**
- Assigning 423 leads to four people is a **split**, not a form. The screen should show the split
  before it happens: who gets how many, and what is left over.
- "Taken in what order" matters — priority first, by ICP, by place, round-robin — and the design
  should make the chosen order visible, because the first fifty leads are not the same as any
  fifty.
- The Team screen is where a member's budget is set, so it carries money as well as counts.

---

## 4. What a member may do, and what they may spend

**What it is.** Permissions made visible, and a budget per person. Finding businesses is
admin-only. Paid lookups are open to a member up to a limit the admin sets. Everything free stays
open to everyone.

**Who for.** Both, differently: the member meets the limits, the admin sets them.

**New screens.** None, but **Data & spend** splits in two: a member's own, and the admin's view of
everyone's.

**Changed screens.**
- **Sidebar** — Find businesses is not shown to a member; ICPs and Checklists are shown but
  read-only.
- **ICPs · Checklists · Priority rules** — a member sees the rules and no way to change them. The
  design should make "this is how it is set up" read as information rather than as a disabled form.
- **Every paid action** — the confirm step already shows price, provider and cap. It gains what is
  left of the budget, and refuses before buying rather than after.
- **Data & spend** — for a member: what they have spent, what is left, when it refills. For the
  admin: the same per person, plus the total.

**Rules to keep.** A refusal must say the number: what is left, what this costs, who can raise it.
Never a dead button. This product already refuses paid work out loud and that pattern continues.

---

## 5. Notifications

**What it is.** One list per person of what happened while they were elsewhere: tasks that ended,
leads that arrived, transfers decided, things deleted, budget spent or topped up, new Showcase
posts. Yours shows yours. The admin's is the admin's, not a feed of everyone's activity.

**Who for.** Everyone.

**New screens.**
- **Notification panel** — from a bell in the top bar, with an unread count. The recent ones, each
  a line about what happened and a link to where it happened.
- **Notifications page** — the rest of them, with the same rows.

**Changed screens.**
- **Top bar** — gains the bell. It now holds: where you are · search · spend · **bell** · theme ·
  you.

**Design problems worth naming.**
- **This is a list, not an alarm.** The five-second toast stays for the thing in front of you.
  These two must look related and not identical — the toast is an event, a notification is a
  record.
- **Read is per row.** Opening the panel must not clear everything, because a notification nobody
  has acted on should still be there tomorrow. That needs a visible unread state that survives
  being looked at.
- Nine kinds of event in one list needs grouping or marking that does not turn into nine colours.

---

## 6. Transferring leads between people

**What it is.** A member can ask to pass leads to a colleague. Nothing moves until the admin
approves, and a refusal keeps every lead where it was. A refused request can be asked again after
a day.

**Who for.** Members ask; the admin decides.

**New screens.**
- **Transfer request** — from ticked leads: to whom, and a note about why.
- **Requests, for the admin** — on the Team screen: who asked, for how many, to whom, and what they
  said. Approve, or refuse with a reason.
- **My requests, for a member** — what is waiting, what was approved, what was refused and why.

**Changed screens.**
- **Leads** — *Transfer to…* beside Assign.
- **Lead detail** — says a transfer is pending on this lead, if one is.

**Design problems worth naming.**
- A pending request changes nothing on the ground — the leads stay usable. The design must show
  "asked for" without implying "gone".
- A refusal carries a reason the sender reads. That is a small piece of writing between two people
  and should look like one.
- **The partial case has to be designed, not left to a sentence.** Ten asked for, one released in
  the meantime, nine move. The result says which and why.

---

## 7. Priority the operator writes

**What it is.** Today priority comes from a 2×2 grid in the code: high problem and high intent is
Priority 1. It becomes a list of rules the admin writes — ordered, first match wins — built from a
fixed set of conditions with their own inputs, including ranges like "followers from 10,000 to
100,000".

**Who for.** The admin writes them; everyone's leads are ordered by them.

**New screens.**
- **Priority rules** — an ordered list, the way ICPs are. Each rule: a name, a priority number, and
  its conditions. Reorder changes what gets caught.
- **Rule builder** — a condition picker from a fixed list, each condition bringing its own input:
  a choice, a range with two numbers, a place, one of the ICPs.
- **Preview** — what this would change, before it changes: "61 leads would move".

**Changed screens.**
- **Leads** — the priority column's tooltip changes from a formula to the rule that caught it.
- **Lead detail** — "Priority 1 because *Big following, no website*" instead of the grid's wording.
- **How it works** — the page explaining the rules has to explain the new arrangement.

**Design problems worth naming.**
- **Score and priority are now different things and the design must teach that.** A score is
  measured; a priority is decided. The same screen shows both and they must not look like two
  versions of the same number.
- Eleven condition types with different inputs is where this gets ugly. One row shape that can hold
  a choice, a range or a place is the whole job.
- Unknown never passes. A rule reading "followers 10,000+" quietly excludes everyone whose
  followers nobody has bought, and the builder should say so where the rule is written, not after
  it has run.

---

## 8. Tasks: filters, deleting, and that task's leads

**What it is.** The Tasks screen gains filters, the ability to delete finished and stopped rows,
and a *See the leads* that shows **only the leads that task worked on**.

**Who for.** Both. A member sees and deletes their own; the admin everyone's.

**New screens.** None.

**Changed screens.**
- **Tasks** — a filter bar: state, kind, who started it, date, free or paid. Delete on each
  finished or stopped row.
- **Leads** — can now be opened scoped to one task, which needs saying on the screen: "the 10 leads
  from *Reading 10 websites*", with a way out.

**Design problems worth naming.**
- Deleting a task row does not undo the work. That has to be unmissable at the moment of deleting.
- A whole-list task has no selection to show, and must say so rather than inventing a count.
- The filter bar has to match the one on Leads. Two different filter patterns in one product is
  one too many.

---

## 9. Showcase

**What it is.** The one place where work crosses between people, and it is opt-in. Anyone posts a
heading, a note, and optionally something they made: a lead (only the fields they tick), a saved
view, or — for the admin — an ICP, a checklist rule or a priority rule.

**Who for.** Everyone, equally. This is the only screen where a member sees another member.

**New screens.**
- **Showcase** — posts newest first, each with its author, its note and its attachment.
- **New post** — heading, note, and an attachment picker that changes shape by what is attached.
- **Attach a lead** — the ticking screen: which fields of this lead become public.

**Changed screens.**
- **Lead detail** — a lead whose record has been shared whole says so, plainly, on its own page.
- **Sidebar** — Showcase is a place to go.

**Design problems worth naming.**
- **A lead is data and is shared in part; a saved view or a rule is a method and is shared whole.**
  The two attachments should not look the same, because they are not.
- "Share the whole record" is the one action here that gives away access. It should feel heavier
  than everything else on the screen.
- The author and the admin can edit or take a post down. Nobody else, including someone whose lead
  is mentioned.

---

## What changes in the design that already exists

The current design is single-user. These are the places it has to move, listed so a design prompt
can name them:

| Existing surface | What changes |
|---|---|
| **Sidebar** | Gains **Team** (admin), **Showcase**, **Notifications**. Loses **Find businesses** for a member. ICPs and Checklists become read-only for a member. The four groups may need a fifth, or a regroup. |
| **Top bar** | Gains the **bell** with its unread count. Spend now means *your* spend for a member. |
| **Dashboard** | Today it describes one list. It has to become either "your leads" or "everyone's", and for the admin it gains the pool and the team. |
| **Leads** | Owner becomes a column for the admin. Step 3's actions gain **Assign** and **Transfer**. The admin gains a pool view. A member's empty state changes meaning entirely. |
| **Lead detail** | Owner, pending transfer, shared-to-Showcase state, and a priority reason that now names a rule. |
| **Tasks** | Filters, delete, and leads scoped to a task. |
| **Data & spend** | Splits into "mine" and "everyone's", and gains budget and what is left. |
| **ICPs · Checklists** | Read-only for a member — which is a state the design does not currently have. |
| **How it works** | Has to explain roles, ownership, budgets and the new priority arrangement. |
| **Empty states** | "Nobody has looked yet" and "You have not been given any yet" are different sentences and currently share one. |

---

## What a design for this must not break

Carried from the product as it stands, because these were each the fix for something that went
wrong:

- **Every refusal explains itself.** No hidden button, no dead control, no blank screen.
- **The third answer survives.** Yes · no · nobody-has-looked stays three states, never two.
- **Prices say who bills them** and what they buy, before anything is spent.
- **Violet means a model wrote it**, and nothing else is violet.
- **Small print is read, not squinted at** — the contrast floor here is higher than the standard
  one.
- **No client-side JavaScript**, with the single exception in §1.
