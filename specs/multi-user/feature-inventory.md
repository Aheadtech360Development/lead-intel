# Feature inventory — nothing lost

Every capability in the live system, checked against the admin design
(`design/ui/lead-intel-admin.html`). Built by reading the app's own routes and the worker's tasks,
not from memory.

**Result: 46 features checked, 46 have a location.** Six had none when the audit started; all six
were added rather than argued away. They are marked **(added)** below.

---

## What the audit found missing, and what was done

| Gap | Why it mattered | Where it now lives |
|---|---|---|
| **Website pages** | The checks say what is wrong; nothing showed *what was actually opened*. The live app has this as a tab, and it is the only place a screenshot or a per-page AI read exists. | **Website analysis → Pages read** tab, plus a drawer per page with its screenshot, console errors, the model's read and which checks it answered |
| **Calls & history** | A member's calls appeared on a lead; an admin had no way to see the team's. | **Operations → Calls** — every call, who made it, what was said, what is due back |
| **Notifications page** | The bell had a panel and its "see all" went to the activity log, which is a different thing. | **Notifications** screen, reached from the bell |
| **Showcase** | Designed in the team release and dropped from the admin one. | **Manage → Showcase**, with the admin's own power to remove any post |
| **Claiming a lead** | `claim_status` is live in the product. The design had no trace of it. | Lead detail badge + **Release the claim**, and a Claimed filter on Leads |
| **Instagram candidates** | Social & ads summarised what was bought but gave nobody a way to buy the next one. | **Social & ads → Could be looked up**, with a bulk bar |

---

## The full map

### Leads and lead management
| Feature | Where | How it starts | Costs |
|---|---|---|---|
| Lead list, search, sort, pagination | Leads | — | free |
| Filters (11 kinds) | Leads → Filters drawer | button | free |
| Saved views | Leads → view chips | click | free |
| Choose columns | Leads → Columns drawer | button | free |
| Bulk actions | Leads → contextual bar on selection | tick rows | varies, each priced |
| Lead detail | Leads → row | click | free |
| Claiming / releasing **(added)** | Lead detail · Leads filter | button | free |
| Assignment | Assign drawer — Leads, Users, Dashboard, import result | button | free |
| Transfer requests | Users → Waiting on you | member asks | free |
| Archive | Leads bulk bar → confirm modal | button | free |
| Export | Leads header | button | free |
| Add by hand · Import · Maps search | Leads → Add businesses drawer | button | search costs |

### Intelligence
| Feature | Where | Costs |
|---|---|---|
| Website analysis, 64 checks grouped by area | Website analysis → Checks by area | free |
| Pages read, per page **(added)** | Website analysis → Pages read + page drawer | free |
| Screenshots | page drawer | free |
| AI critique, per page and per lead | page drawer · lead detail — violet, labelled | ~0.05¢ a page |
| Checks that cannot be answered | shown inline with their reason | — |
| Scores, and how they are built | Scores & priority | free |
| Priority rules + builder + preview | Scores & priority → rule drawer | free |
| Coverage per area | Scores & priority | free |
| Instagram data | Social & ads | 0.26¢ |
| Instagram candidates **(added)** | Social & ads → Could be looked up | 0.26¢ each |
| Meta ads | Social & ads · check D5/N2 | 11.6¢ |
| PageSpeed · YouTube | inside the checks; status on Integrations | free |
| ICPs | ICPs + drawer | free |
| Checklists | Checklists + drawer | free |

### Operations
| Feature | Where | Costs |
|---|---|---|
| Tasks list, filters, delete | Tasks | free |
| Task detail, progress, cost, technical details behind a disclosure | Task detail | — |
| Leads scoped to one task | Task detail → See the leads | free |
| Running operations | Dashboard → Running now | — |
| Imports, import detail, rejected rows with reasons | Imports | free |
| Import wizard **(added drawer)** | Imports → Import a list | free |
| Activity log | Activity | free |
| Calls **(added)** | Calls | free |
| Notifications **(added)** | bell → Notifications | free |
| Showcase **(added)** | Showcase | free |

### People and money
| Feature | Where |
|---|---|
| Users list, add, deactivate | Users |
| User detail: activity, leads, calls, spend, permissions | User detail |
| Roles & permissions, grouped by what is managed | Roles & permissions |
| Budgets, amount and period | Users · Spending · budget modal |
| Spend by person, by provider, over time | Spending |
| The ledger, every paid call | Spending |
| What each thing costs, and what is free | Spending |
| Cost confirmation before every purchase | buy · search · read-pages modals |

### System
| Feature | Where |
|---|---|
| Settings, in eleven sections | Settings |
| Integrations, connected and not | Integrations |
| Worker health | Dashboard → System health · Integrations |
| Global search across everything | ⌘K |
| Empty · loading · working · failed · confirm · done | System states |
| How it works | How it works |

---

## Four things deliberately not on the dashboard

The dashboard is a command centre, not a container. These have dedicated homes and reach the
dashboard only when they need attention:

- **Instagram and Meta ads** → Social & ads, with a lead's own Social tab and the purchase history
  under Spending.
- **The 64 checks** → Website analysis. The dashboard carries only the count of businesses scored
  on too little.
- **Calls** → their own screen. The dashboard shows what is overdue.
- **Transfers** → Users. The dashboard shows that two are waiting.
