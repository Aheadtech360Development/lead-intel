/**
 * The shared visual pieces.
 *
 * Three rules run through all of them, each from a specific piece of operator feedback:
 *
 * 1. **Every number carries its explanation, always visible.** Not in a tooltip — a label nobody
 *    can find is a label that does not exist. "Problem 76" means nothing on its own.
 * 2. **Show the shape, not just the digits.** A bar makes "76 versus 24" legible at a glance in a
 *    way two numbers in a table never do.
 * 3. **Colour means something.** The previous version was one muted teal on grey, so a warning, a
 *    total and a heading all looked equally important and nothing said where to look first. Each
 *    tone below has exactly one meaning and is used for nothing else.
 */

import { cookies } from "next/headers";
import Link from "next/link";
import { loadJustFinishedJobs, loadRunningJobs, reconcileStuckJobs } from "@/lib/job-runs";
import { createClient } from "@/lib/supabase/server";
import { RAIL_COOKIE, railIsOpen } from "@/lib/rail";
import { NEXT_THEME, readTheme, THEME_COOKIE, THEME_LABEL } from "@/lib/theme";
import { getViewer } from "@/lib/viewer";
import { setTheme, toggleRail } from "./actions";
import { FinishedToast, RunningJobs } from "./running-jobs";

export type Tone = "brand" | "good" | "warn" | "bad" | "info" | "money" | "social" | "plain";

/** The colour tokens for a tone, so no component hard-codes a hex value. */
export function toneVars(tone: Tone): { fg: string; ink: string; bg: string } {
  if (tone === "plain") return { fg: "var(--ink-2)", ink: "var(--ink)", bg: "var(--surface-3)" };
  return { fg: `var(--${tone})`, ink: `var(--${tone}-ink)`, bg: `var(--${tone}-bg)` };
}

// ---------------------------------------------------------------- app shell

export type NavKey =
  | "dashboard"
  | "leads"
  | "mine"
  | "analysis"
  | "instagram"
  | "search"
  | "import"
  | "icps"
  | "checklists"
  | "prules"
  | "rules"
  | "spend"
  | "tasks"
  | "calls"
  | "notifications"
  | "transfers"
  | "showcase";

/**
 * The icon set, drawn rather than typed.
 *
 * Emoji were doing this job, and they were the wrong tool twice over: they render as a different
 * picture on every operating system, and a product whose job is to look like an instrument cannot
 * have 📊 and 🎯 in its navigation. These are 24px line icons on one stroke weight, inheriting
 * `currentColor`, so the active item's colour carries into its icon with no second rule.
 */
const ICONS: Record<
  NavKey | "search-glass" | "money" | "moon" | "sun" | "device" | "collapse" | "power" | "more",
  React.ReactNode
> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  leads: (
    <>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </>
  ),
  mine: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M5 20c.8-3.4 3.6-5.2 7-5.2s6.2 1.8 7 5.2" />
    </>
  ),
  instagram: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="5" />
      <circle cx="12" cy="12" r="3.4" />
      <circle cx="17" cy="7" r="1" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.8-3.8" />
    </>
  ),
  import: (
    <>
      <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4l2 2.5h7A1.5 1.5 0 0 1 20 10v7.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5Z" />
    </>
  ),
  icps: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  checklists: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="m3 6 1.6 1.6L7.5 4.7M3 16.5 4.6 18l2.9-2.9" />
    </>
  ),
  rules: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.3a2.5 2.5 0 1 1 3.2 2.9c-.6.3-.8.8-.8 1.4v.4" />
      <path d="M12 17.2h.01" />
    </>
  ),
  spend: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M3 10h18M7 15h3" />
    </>
  ),
  tasks: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5l3 1.8" />
    </>
  ),
  "search-glass": (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-3.8-3.8" />
    </>
  ),
  money: (
    <>
      <path d="M12 3v18M16.5 7.5c0-1.7-2-2.5-4.5-2.5S7.5 5.8 7.5 7.5 9.5 10 12 10s4.5.8 4.5 2.5S14.5 15 12 15s-4.5-.8-4.5-2.5" />
    </>
  ),
  moon: <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.5 8.5 0 1 0 20 14.2Z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4" />
    </>
  ),
  device: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="2" />
      <path d="M8 21h8" />
    </>
  ),
  collapse: <path d="M15 5 8 12l7 7" />,
  power: (
    <>
      <path d="M12 4v8" />
      <path d="M7.8 7.2a6 6 0 1 0 8.4 0" />
    </>
  ),
  analysis: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.6 2.6 15 0 18-2.6-3-2.6-15.4 0-18Z" />
    </>
  ),
  calls: (
    <>
      <path d="M5.5 4h3l1.5 4-2 1.4a12 12 0 0 0 5.6 5.6L15 13l4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 3.5 6.2 2 2 0 0 1 5.5 4Z" />
    </>
  ),
  prules: (
    <>
      <path d="M4 6h10M4 12h16M4 18h7" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="13" cy="18" r="2" />
    </>
  ),
  showcase: (
    <>
      <path d="m12 3 2.6 5.8 6.4.7-4.8 4.3 1.4 6.2L12 16.9 6.4 20l1.4-6.2L3 9.5l6.4-.7Z" />
    </>
  ),
  transfers: (
    <>
      <path d="M4 8h13l-3-3M20 16H7l3 3" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
      <path d="M13.7 19a2 2 0 0 1-3.4 0" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </>
  ),
};

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      style={{
        width: size,
        height: size,
        stroke: "currentColor",
        fill: "none",
        strokeWidth: 1.7,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        flex: "none",
      }}
    >
      {ICONS[name]}
    </svg>
  );
}

/**
 * Every page in the product, in one list, in four groups.
 *
 * One list rather than a nav copied per page, because the copied version had a consequence worse
 * than duplication: `/records/import` was built, worked, and could not be reached from anywhere.
 *
 * The **groups** are the redesign's doing. Eleven flat links is a list you search every time; four
 * groups of two or three is a place you come to know — and the grouping says something true about
 * the product: what you work in, what you teach it, how businesses get in, and what it costs.
 * The `what` line is shown in the sidebar's tooltip and again as the page's own subtitle: the
 * operator asked to be told what each screen is for, and this is the one place that answer lives.
 */
export const NAV: {
  key: NavKey;
  href: string;
  label: string;
  /** What a member calls it, when that differs from what an administrator calls it. */
  memberLabel?: string;
  what: string;
  group: string;
  /** Hidden from members, and refused by the page itself if the address is typed in. */
  adminOnly?: boolean;
}[] = [
  {
    key: "dashboard",
    href: "/dashboard",
    label: "Dashboard",
    what: "What is worth doing next, and how the list is doing.",
    group: "Workspace",
  },
  {
    key: "leads",
    href: "/records",
    label: "Leads",
    memberLabel: "My leads",
    what: "The call list. Ordered so the best call is the first row.",
    group: "Workspace",
  },

  {
    key: "analysis",
    href: "/analysis",
    label: "Website analysis",
    what: "What has been read across the list, how much of it could be answered, and what could not.",
    group: "Intelligence",
  },
  {
    key: "instagram",
    href: "/instagram",
    label: "Social & Instagram",
    what: "Followers, the category Instagram publishes, and who is running ads — on its own.",
    group: "Intelligence",
  },

  {
    key: "tasks",
    href: "/tasks",
    label: "Tasks",
    what: "Everything the product has been asked to do: what it was for, how it ended, and what it cost.",
    group: "Work",
  },
  {
    key: "calls",
    href: "/calls",
    label: "Calls & history",
    what: "Every conversation logged: what happened, when, and what is due back.",
    group: "Work",
  },

  {
    key: "import",
    href: "/records/imports",
    label: "Imports",
    what: "Lists you uploaded, and exactly what each one produced.",
    group: "Data",
  },
  {
    key: "spend",
    href: "/spend",
    label: "Spend",
    memberLabel: "My spend",
    what: "What each kind of data costs, what is free, and what has been spent.",
    group: "Data",
  },

  {
    key: "icps",
    href: "/icps",
    label: "ICPs",
    what: "Who you want to sell to: the words each kind of customer is found and recognised by.",
    group: "Reference",
  },
  {
    key: "checklists",
    href: "/checklists",
    label: "Checklists",
    what: "What a good page looks like, in your words — judged against every page read.",
    group: "Reference",
  },
  {
    key: "prules",
    href: "/priority-rules",
    label: "Priority rules",
    what: "How a lead ends up Priority 1, 2, 3 or 4. Nobody types a priority in.",
    group: "Reference",
  },
  {
    key: "rules",
    href: "/rules",
    label: "How it works",
    what: "Every rule in the product, in plain words: what runs, what it costs, and what it cannot do.",
    group: "Reference",
  },

  {
    key: "showcase",
    href: "/showcase",
    label: "Showcase",
    what: "The one shared place: post what worked, take what is useful.",
    group: "Shared",
  },
  {
    key: "transfers",
    href: "/transfers",
    label: "Transfers",
    what: "Ask for leads to be passed to a colleague. The administrator decides.",
    group: "Shared",
  },

  {
    key: "search",
    href: "/search",
    label: "Find businesses",
    what: "Search Google Maps by trade and place to add new businesses. Costs money per search.",
    group: "Administrator",
    adminOnly: true,
  },
];

/**
 * The frame every signed-in page sits in: a grouped sidebar, a top bar, and the page's own content.
 *
 * The top bar carries four things and no more — where you are, a search box, what the product has
 * spent, and the light/dark switch. The spend chip is in the frame on every screen on purpose:
 * this product spends the operator's money, and a total that lives on one page is a total nobody
 * looks at. It shows a figure on the screens that already know it and the word alone elsewhere,
 * rather than adding a query to every page in the product to display it twice.
 */
export async function AppShell({
  current,
  email,
  signOutAction,
  title,
  what,
  actions,
  back,
  children,
  wide = false,
  autoRefresh = true,
  spentCents,
}: {
  current?: NavKey;
  email?: string | null;
  signOutAction?: (formData: FormData) => void | Promise<void>;
  /** The page's heading. Omit on focused screens that supply their own. */
  title?: string;
  /** One sentence: what this screen is for. The operator asked for this on every page. */
  what?: React.ReactNode;
  actions?: React.ReactNode;
  /** Shown in the top bar on a focused screen — a single lead, a confirm step. */
  back?: { href: string; label: string };
  children: React.ReactNode;
  /** The leads table needs the room; reading-width pages do not. */
  wide?: boolean;
  /**
   * Whether this screen may reload itself while a job is running.
   *
   * Off for anything with a form the operator types into. Five-second reloads are how a
   * half-written checklist rule disappears mid-sentence, and a progress bar is not worth somebody's
   * work. Those screens still show the banner, with a link to refresh when they are ready.
   */
  autoRefresh?: boolean;
  /** Total spend, when this page has already loaded it. See the note above. */
  spentCents?: number;
}) {
  /**
   * Who is looking, asked here so no page can forget.
   *
   * The navigation is the first place the member boundary shows: a member never sees Find
   * businesses, because sourcing from Google Maps is the administrator's and costs money per
   * search. Hiding the link is only half of it — the page refuses the address too (see
   * `lib/viewer.ts`), because a boundary that only exists in a menu is not a boundary.
   */
  const viewer = await getViewer();
  const nav = NAV.filter((n) => !n.adminOnly || viewer?.isAdmin);
  const groups = [...new Set(nav.map((n) => n.group))];

  /**
   * The queue, fetched here rather than passed in.
   *
   * Every page would otherwise have to remember, and the page that forgot would be exactly the one
   * where the operator sat watching a screen that never changed. One query, one index, every screen.
   */
  /**
   * Asked for, then checked.
   *
   * A row saying "running" is a claim made by something that may no longer exist, so anything that
   * stopped reporting is checked against Trigger.dev before it is drawn. Normally that is zero
   * extra calls: only a row that has said nothing for two minutes is ever looked up.
   */
  const supabaseForJobs = await createClient();
  /** A member's banner is their own work. An administrator sees everything running. */
  const jobsFor = viewer?.isAdmin ? undefined : viewer?.id;
  const runningJobs = await reconcileStuckJobs(supabaseForJobs, await loadRunningJobs(supabaseForJobs, jobsFor));

  /**
   * Anything that ended in the last forty-five seconds, so the screen can say so.
   *
   * Paired with the ten-second refresh in `RunningJobs`: the page comes back by itself when a task
   * finishes, and this is what tells the operator that is what happened. One query, filtered on an
   * indexed timestamp, and almost always empty.
   */
  const justFinished = await loadJustFinishedJobs(supabaseForJobs, undefined, jobsFor);

  const jar = await cookies();

  /**
   * Narrow unless asked otherwise.
   *
   * Closed is the default because that is what was asked for. Closed still shows every icon, so
   * nothing becomes unreachable — it stops being a 248px column of words and becomes a 68px strip
   * of symbols, which is enough once the operator knows the ten places by their shape.
   */
  const railOpen = railIsOpen(jar.get(RAIL_COOKIE)?.value);
  const theme = readTheme(jar.get(THEME_COOKIE)?.value);
  const nextTheme = NEXT_THEME[theme];
  const here = nav.find((n) => n.key === current);
  const label = (item: (typeof NAV)[number]) =>
    viewer?.role === "member" && item.memberLabel ? item.memberLabel : item.label;

  return (
    <div className="shell" data-rail={railOpen ? "open" : "closed"}>
      <nav className="rail" aria-label="Product navigation">
        <Link href="/dashboard" className="rail-brand" title="Lead Intel — dashboard">
          <span className="brand-logo" aria-hidden>
            L
          </span>
          <span className="rail-word">
            <span className="brand-name" style={{ display: "block" }}>
              Lead Intel
            </span>
            <span className="brand-sub" style={{ display: "block" }}>
              AheadTech360
            </span>
          </span>
        </Link>

        {groups.map((group) => (
          <div key={group}>
            <div className="rail-group">{group}</div>
            {nav
              .filter((n) => n.group === group)
              .map((item) => (
                <Link
                  key={item.key}
                  href={item.href}
                  className="rail-link"
                  data-active={current === item.key}
                  title={`${label(item)} — ${item.what}`}
                >
                  <span className="rail-icon">
                    <Icon name={item.key} />
                  </span>
                  <span className="rail-word">{label(item)}</span>
                </Link>
              ))}
          </div>
        ))}

        <div className="rail-foot">
          {email ? (
            <div className="userchip">
              <span className="avatar" aria-hidden>
                {email.slice(0, 2).toUpperCase()}
              </span>
              <span className="rail-word" style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, color: "var(--ink-2)", wordBreak: "break-all", display: "block" }}>{email}</span>
                <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                  {viewer?.role === "admin" ? "Administrator" : "Member"}
                </span>
              </span>
            </div>
          ) : null}
          {signOutAction ? (
            <form action={signOutAction}>
              <button className="rail-link" type="submit" style={{ width: "100%" }} title="Sign out">
                <span className="rail-icon">
                  <Icon name="power" />
                </span>
                <span className="rail-word">Sign out</span>
              </button>
            </form>
          ) : null}
          {/* A form, not a script. See toggleRail in app/actions.ts for why the state is a cookie. */}
          <form action={toggleRail}>
            <button
              type="submit"
              className="rail-link"
              style={{ width: "100%" }}
              title={railOpen ? "Make the sidebar narrow" : "Open the sidebar"}
            >
              <span className="rail-icon" style={{ transform: railOpen ? "none" : "rotate(180deg)" }}>
                <Icon name="collapse" />
              </span>
              <span className="rail-word">{railOpen ? "Collapse" : "Expand"}</span>
            </button>
          </form>
        </div>
      </nav>

      <div className="shell-main">
        <header className="topbar">
          {back ? (
            <Link href={back.href} className="crumbs" style={{ fontWeight: 600 }}>
              ← {back.label}
            </Link>
          ) : (
            <div className="crumbs">
              <span>Workspace</span>
              <span aria-hidden>/</span>
              <b>{title ?? (here ? label(here) : "Lead Intel")}</b>
            </div>
          )}

          {/* A GET form to the leads list, which already understands `q`. No script, no overlay. */}
          <form className="topsearch" action="/records" method="get" role="search">
            <Icon name="search-glass" size={15} />
            <input name="q" type="search" placeholder="Search businesses by name…" aria-label="Search businesses" />
          </form>

          <Link
            href="/spend"
            className="spendchip"
            data-tip="What this product has spent so far, across every provider. Opens Data & spend, where every charge is listed with the service that billed it."
          >
            <Icon name="money" size={14} />
            <span>Spent</span>
            {spentCents === undefined ? null : (
              <b>
                <Money cents={spentCents} free="$0.00" />
              </b>
            )}
          </Link>

          <form action={setTheme}>
            <input type="hidden" name="from" value={theme} />
            <button
              type="submit"
              className="iconbtn"
              data-tip={`Appearance: ${THEME_LABEL[theme].toLowerCase()}. Press to switch to ${THEME_LABEL[nextTheme].toLowerCase()}.`}
              aria-label={`Appearance: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[nextTheme]}.`}
            >
              <Icon name={theme === "dark" ? "sun" : theme === "light" ? "device" : "moon"} size={17} />
            </button>
          </form>
        </header>

        {/* `wide` means the full width of the window rather than 1680px. The leads table has a
            1290px minimum, so on a wide screen the old cap left an empty band down each side while
            the table still scrolled sideways inside it — the worst of both. Reading-width pages
            keep their cap, because a paragraph 1900px wide is unreadable for the opposite reason. */}
        <main style={{ padding: "22px 22px 0", maxWidth: wide ? "100%" : 1180, margin: "0 auto" }}>
          <RunningJobs jobs={runningJobs} autoRefresh={autoRefresh} />
          <FinishedToast jobs={justFinished} />
          {title || what || actions ? (
            <div className="page-head">
              <div style={{ minWidth: 0 }}>
                {title ? <h1>{title}</h1> : null}
                {what ? <p>{what}</p> : null}
              </div>
              {actions ? <div className="actions">{actions}</div> : null}
            </div>
          ) : null}
          {children}
        </main>

        {/*
          A phone's navigation.

          On a narrow screen the sidebar became a wrapping strip of icons with no words, and its
          foot — the account and **Sign out** — was hidden outright, so a phone could not sign out
          of this product at all. This replaces it: the four places a salesperson actually goes,
          always within thumb reach, and everything else behind one sheet that opens upward.

          A `<details>`, not a script. The sheet is open or closed because the browser says so,
          which means it works before any JavaScript loads and on a page that has none.
        */}
        <nav className="bottombar" aria-label="Navigation">
          {nav
            .filter((n) => ["dashboard", "leads", "calls", "tasks"].includes(n.key))
            .map((item) => (
              <Link key={item.key} href={item.href} data-active={current === item.key}>
                <Icon name={item.key} size={19} />
                <span>{label(item)}</span>
              </Link>
            ))}

          <details className="morebar">
            <summary aria-label="Everywhere else">
              <Icon name="more" size={19} />
              <span>More</span>
            </summary>
            <div className="moresheet">
              <div className="moresheet-in">
                {nav
                  .filter((n) => !["dashboard", "leads", "calls", "tasks"].includes(n.key))
                  .map((item) => (
                    <Link key={item.key} href={item.href} data-active={current === item.key}>
                      <Icon name={item.key} size={17} />
                      <span>{label(item)}</span>
                    </Link>
                  ))}
                {signOutAction ? (
                  <form action={signOutAction}>
                    <button type="submit">
                      <Icon name="power" size={17} />
                      <span>Sign out</span>
                    </button>
                  </form>
                ) : null}
              </div>
            </div>
          </details>
        </nav>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- structure

export const PANEL: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--rule)",
  borderRadius: "var(--radius)",
  boxShadow: "var(--shadow-sm)",
  marginBottom: 18,
};

export const PANEL_HEAD: React.CSSProperties = { padding: "13px 16px", borderBottom: "1px solid var(--line)" };

export const PANEL_TITLE: React.CSSProperties = { fontSize: 15.5, fontWeight: 600, margin: 0, color: "var(--ink)" };

export const PANEL_HINT: React.CSSProperties = {
  fontSize: 13,
  color: "var(--ink-3)",
  margin: "3px 0 0",
  lineHeight: 1.5,
};

export function Panel({
  title,
  hint,
  children,
  tone = "plain",
  right,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  tone?: Tone;
  /** A link or button that belongs to this panel rather than to the page. */
  right?: React.ReactNode;
}) {
  return (
    <section className="card" style={{ marginBottom: 18 }} {...(tone !== "plain" ? { "data-tone": tone } : {})}>
      <div style={{ ...PANEL_HEAD, display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={PANEL_TITLE}>{title}</h2>
          {hint ? <p style={PANEL_HINT}>{hint}</p> : null}
        </div>
        {right ? <div style={{ flex: "0 0 auto" }}>{right}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A heading between panels, so a long page reads as sections rather than as a stack. */
export function SectionHeading({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="section-head">
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2>{title}</h2>
        {hint ? <p>{hint}</p> : null}
      </div>
      {right}
    </div>
  );
}

/**
 * A box that explains rather than reports.
 *
 * Its own component because the operator asked to be told what things are for, and an explanation
 * that looks like data gets read as data. This never contains a number.
 */
/**
 * Supporting explanation, styled to **recede**.
 *
 * It used to have a full border and a tinted background, which made it look exactly as important as
 * the panels carrying the actual work. Stack four of those and the page reads as a wall — the
 * operator's report was "her information wali jagah complicated hogayi hai", and this component was
 * a large part of why.
 *
 * Now it is a tinted block with a coloured stripe down one edge and no border. That is enough to
 * group it and tint it by meaning, while making it visibly secondary to a bordered Panel. Bigger
 * body text too: this is prose meant to be read, not a label.
 */
export function InfoBox({ title, children, tone = "info" }: { title?: string; children: React.ReactNode; tone?: Tone }) {
  const c = toneVars(tone);
  return (
    <div
      className="note"
      style={{ borderLeftColor: c.fg, background: c.bg, marginBottom: 18, lineHeight: 1.6 }}
    >
      {title ? <h4 style={{ color: c.ink }}>{title}</h4> : null}
      {children}
    </div>
  );
}

/**
 * The one-line result of something that just happened: saved, applied, failed.
 *
 * Four pages had hand-rolled this out of `PANEL` with slightly different padding, border colour and
 * font size each time, so the same kind of message looked like a different kind of thing depending
 * on where you saw it. One component means an operator learns the shape once.
 */
export function Banner({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const c = toneVars(tone);
  return (
    <div
      className="note"
      style={{
        display: "flex",
        gap: 10,
        alignItems: "baseline",
        background: c.bg,
        borderLeftColor: c.fg,
        marginBottom: 14,
        color: "var(--ink)",
      }}
    >
      <span aria-hidden style={{ color: c.ink, fontWeight: 700 }}>
        {tone === "bad" || tone === "warn" ? "!" : "✓"}
      </span>
      <span>{children}</span>
    </div>
  );
}

/** A short note inside a panel, styled as guidance rather than as another row of data. */
/**
 * The whole product, as four stages.
 *
 * The operator asked for the system to be simple enough to understand at a glance, and described it
 * in exactly these four words: sourcing, filtering, analysis, enrichment. Every screen belongs to
 * one of them, so the strip marks the one you are on and says in a line what each costs — the two
 * that can cost money say so, the two that never do say that too.
 *
 * Links, so the strip is also a way to move between them.
 */
export type Stage = "sourcing" | "filtering" | "analysis" | "enrichment";

const STAGES: { id: Stage; n: number; name: string; what: string; how: string; cost: string; href: string }[] = [
  {
    id: "sourcing",
    n: 1,
    name: "Sourcing",
    what: "Getting businesses in",
    how: "Search Google Maps for an ICP, import a file, or add one by hand",
    cost: "A search can cost — the price is shown first",
    href: "/search",
  },
  {
    id: "filtering",
    n: 2,
    name: "Filtering",
    what: "Narrowing to who you want",
    how: "Your ICPs, then the filters on the leads list",
    cost: "Free",
    href: "/icps",
  },
  {
    id: "analysis",
    n: 3,
    name: "Analysis",
    what: "Judging what is wrong",
    how: "Their website against your checklists, plus reviews and speed",
    cost: "Free, except reading pages in a browser",
    href: "/checklists",
  },
  {
    id: "enrichment",
    n: 4,
    name: "Enrichment",
    what: "Buying what is missing",
    how: "Google listing, Instagram, ads — only for businesses you pick",
    cost: "Costs money, always confirmed first",
    href: "/spend",
  },
];

export function StageStrip({ current }: { current?: Stage }) {
  return (
    <nav
      aria-label="The four stages"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
        gap: 10,
        marginBottom: 18,
      }}
    >
      {STAGES.map((stage) => {
        const on = stage.id === current;
        return (
          <Link
            key={stage.id}
            href={stage.href}
            aria-current={on ? "step" : undefined}
            style={{
              display: "grid",
              gap: 3,
              padding: "11px 13px",
              borderRadius: 10,
              border: on ? "2px solid var(--ink)" : "1.5px solid var(--rule)",
              background: on ? "var(--surface-2)" : "var(--surface)",
              color: "var(--ink)",
              textDecoration: "none",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  background: "var(--ink)",
                  color: "var(--paper)",
                  fontSize: 13,
                  fontWeight: 800,
                }}
              >
                {stage.n}
              </span>
              <span style={{ fontSize: 16.5, fontWeight: 700 }}>{stage.name}</span>
              {on && <span style={{ fontSize: 13, color: "var(--ink-2)", marginLeft: "auto" }}>you are here</span>}
            </span>
            <span style={{ fontSize: 14, fontWeight: 650 }}>{stage.what}</span>
            <span style={{ fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.4 }}>{stage.how}</span>
            <span style={{ fontSize: 13.5, color: "var(--ink-3)", marginTop: 2 }}>{stage.cost}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * A screen for something that is agreed, designed and not built.
 *
 * Three of these exist — notifications, transfers and Showcase — and the temptation with all three
 * is to draw the working version and let somebody find out by pressing it. This does the opposite:
 * it says plainly that there is nothing behind it yet, describes what it will do, and names what
 * the product does *instead* today, so the screen is useful rather than a promise.
 *
 * It is not a placeholder. A placeholder tells you nothing; this tells you the decision that has
 * been made and what is waiting on it.
 */
export function NotBuilt({
  what,
  instead,
  steps,
  children,
}: {
  /** One sentence: what this will do when it exists. */
  what: React.ReactNode;
  /** What the product does today in its place. Never "nothing" — there is always something. */
  instead: React.ReactNode;
  /** The agreed flow, in order, so the design can be checked before it is built. */
  steps?: { title: string; what: React.ReactNode }[];
  children?: React.ReactNode;
}) {
  return (
    <>
      <section className="card" style={{ marginBottom: 18, borderStyle: "dashed", borderColor: "var(--line-3)" }}>
        <div style={{ padding: "16px 18px", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Badge tone="plain">Agreed · not built yet</Badge>
            <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              Nothing behind this screen writes or reads anything. It is here so the decision can be checked before it
              is built.
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink)", lineHeight: 1.6 }}>{what}</p>
          <div
            style={{
              fontSize: 13,
              color: "var(--ink-2)",
              lineHeight: 1.6,
              padding: "11px 13px",
              borderRadius: "var(--radius-sm)",
              background: "var(--surface-2)",
            }}
          >
            <b style={{ color: "var(--ink)" }}>What happens today instead: </b>
            {instead}
          </div>
        </div>
      </section>

      {steps && steps.length > 0 ? (
        <section className="card" style={{ marginBottom: 18 }}>
          <div style={{ ...PANEL_HEAD }}>
            <h2 style={PANEL_TITLE}>How it will work</h2>
            <p style={PANEL_HINT}>In order. Each step is a decision that has already been made.</p>
          </div>
          <div style={{ padding: "14px 16px", display: "grid", gap: 12 }}>
            {steps.map((step, i) => (
              <div key={step.title} style={{ display: "grid", gridTemplateColumns: "26px minmax(0,1fr)", gap: 12 }}>
                <span
                  aria-hidden
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    display: "grid",
                    placeItems: "center",
                    background: "var(--accent-sub)",
                    color: "var(--accent-ink)",
                    fontWeight: 700,
                    fontSize: 12.5,
                  }}
                >
                  {i + 1}
                </span>
                <span>
                  <b style={{ color: "var(--ink)", fontSize: 13.5, display: "block" }}>{step.title}</b>
                  <span style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>{step.what}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {children}
    </>
  );
}

/**
 * What a member sees if they reach an administrator's screen by typing the address.
 *
 * A sentence, naming the thing and the reason, and a way back. Not a 403 and not a blank page: a
 * salesperson who lands here has done nothing wrong, and "forbidden" tells them nothing they can
 * act on. The real refusal is in the database — this is only the wording.
 */
export function AdminOnlyNotice({ thing, why }: { thing: string; why: React.ReactNode }) {
  return (
    <section className="card" style={{ padding: "22px 24px", display: "grid", gap: 10, maxWidth: 620 }}>
      <Badge tone="plain">Administrator only</Badge>
      <h2 style={{ fontSize: 18, margin: 0, color: "var(--ink)" }}>{thing} is the administrator&rsquo;s</h2>
      <p style={{ margin: 0, fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6 }}>{why}</p>
      <div style={{ display: "flex", gap: 9, marginTop: 4 }}>
        <Link href="/records" className="btn">
          Back to my leads
        </Link>
        <Link href="/records/import" className="btn secondary">
          Import a list instead
        </Link>
      </div>
    </section>
  );
}

export function Note({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "warn" }) {
  const c = toneVars(tone === "warn" ? "warn" : "plain");
  return (
    <p
      style={{
        margin: 0,
        padding: "11px 16px",
        fontSize: 13,
        lineHeight: 1.55,
        color: tone === "warn" ? "var(--warn-ink)" : "var(--ink-3)",
        background: tone === "warn" ? c.bg : "transparent",
        borderTop: "1px solid var(--line)",
      }}
    >
      {children}
    </p>
  );
}

// ---------------------------------------------------------------- numbers

/**
 * One headline number, its name, and what it means.
 *
 * The `explain` line is not optional decoration. Six unlabelled tiles was the state the operator
 * described as unreadable, and every one of them needed a sentence before it meant anything.
 */
export function StatCard({
  value,
  label,
  explain,
  tone = "plain",
  icon,
  href,
}: {
  value: React.ReactNode;
  label: string;
  explain?: string;
  tone?: Tone;
  icon?: string;
  href?: string;
}) {
  const c = toneVars(tone);
  const body = (
    <>
      <div className="label">
        {icon ? (
          <span
            aria-hidden
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              background: c.bg,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
            }}
          >
            {icon}
          </span>
        ) : null}
        {label}
      </div>
      <div className="val" style={tone === "plain" ? undefined : { color: c.ink }}>
        {value}
      </div>
      {explain ? <div className="meta">{explain}</div> : null}
    </>
  );

  return (
    <div
      className="card kpi"
      {...(tone !== "plain" ? { "data-tone": tone } : {})}
      style={{ flex: "1 1 190px", minWidth: 180 }}
    >
      {href ? (
        <Link href={href} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

/** A 0-100 bar. Colour follows severity, so a column can be scanned without reading a number. */
export function Meter({
  value,
  max = 100,
  tone = "problem",
  height = 8,
}: {
  value: number | null;
  max?: number;
  tone?: "problem" | "good" | "neutral";
  height?: number;
}) {
  if (value === null) {
    return <div className="meter" style={{ height }} title="Not measured" />;
  }
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  /** Severity picks the colour, so a column of bars can be scanned without reading one number. */
  const kind =
    tone === "good" ? "good" : tone === "neutral" ? "" : pct >= 70 ? "bad" : pct >= 40 ? "warn" : "good";
  return (
    <div className={kind ? `meter ${kind}` : "meter"} style={{ height }}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A labelled bar for a breakdown — count on the right, share as the bar. */
export function BarRow({
  label,
  count,
  total,
  href,
  tone = "neutral",
}: {
  label: string;
  count: number;
  total: number;
  href?: string;
  tone?: "problem" | "good" | "neutral";
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const body = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, marginBottom: 4 }}>
        <span style={{ color: "var(--ink-2)" }}>{label}</span>
        <span className="mono" style={{ color: "var(--ink-3)", fontSize: 12.5 }}>
          {count} ({pct}%)
        </span>
      </div>
      <Meter value={pct} tone={tone} height={7} />
    </>
  );
  return (
    <div style={{ padding: "9px 18px" }}>
      {href ? (
        <Link href={href} style={{ textDecoration: "none", display: "block" }}>
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

/** Both scores in one cell, so the argument for a lead is visible rather than implied. */
export function ScoreBars({
  problem,
  intent,
  checked,
}: {
  problem: number | null;
  intent: number | null;
  /**
   * What the score was made of, when the screen knows.
   *
   * The operator's report: a business nobody had checked still showed a score, in the same ink as
   * one built from forty measurements. 48 live records sit at Problem 90, Priority 1, on three
   * answered checks — all of them correct, none of them obviously thin. This line is the
   * difference.
   */
  checked?: { measured: number; catalogue: number; band: "nothing" | "thin" | "partial" | "good"; sentence: string };
}) {
  const line = (text: string, value: number | null, tone: "problem" | "good") => (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 3 }}>
        <span style={{ color: "var(--ink-3)" }}>{text}</span>
        <span className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>
          {value === null ? "—" : value}
        </span>
      </div>
      <Meter value={value} tone={tone} height={6} />
    </div>
  );
  return (
    <div style={{ minWidth: 126 }}>
      {line("Problem", problem, "problem")}
      {line("Signals", intent, "good")}
      {checked ? (
        <div
          className="src"
          data-tip={checked.sentence}
          style={{
            marginTop: 4,
            color: checked.band === "nothing" || checked.band === "thin" ? "var(--warn-ink)" : "var(--ink-3)",
            cursor: "help",
          }}
        >
          {checked.measured === 0 ? "nothing checked yet" : `from ${checked.measured} of ${checked.catalogue} checks`}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The pipeline as stages, left to right.
 *
 * Independent stat cards could not show that these numbers are a **sequence** — that "worth
 * calling" is a subset of "analysed", which is a subset of "found". Read across, it says where the
 * drop-off is, which is the question the numbers were there to answer.
 */
export function Funnel({
  steps,
}: {
  steps: Array<{ label: string; value: number; explain: string; href?: string; tone?: Tone }>;
}) {
  const max = Math.max(1, ...steps.map((s) => s.value));
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
        gap: 1,
        background: "var(--rule)",
      }}
    >
      {steps.map((step) => {
        const c = toneVars(step.tone ?? "plain");
        const body = (
          <>
            <div
              className="val"
              style={{
                fontFamily: "var(--font-display), sans-serif",
                fontSize: 26,
                fontWeight: 600,
                lineHeight: 1.05,
                color: (step.tone ?? "plain") === "plain" ? "var(--ink)" : c.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {step.value}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)", marginTop: 2 }}>{step.label}</div>
            <div style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.4, minHeight: 32 }}>
              {step.explain}
            </div>
            <div style={{ marginTop: 9, height: 5, background: "var(--surface-3)", borderRadius: 99, overflow: "hidden" }}>
              <div
                style={{
                  width: `${Math.round((step.value / max) * 100)}%`,
                  height: "100%",
                  background: (step.tone ?? "plain") === "plain" ? "var(--brand)" : c.fg,
                  borderRadius: 99,
                }}
              />
            </div>
          </>
        );
        return (
          <div key={step.label} style={{ background: "var(--surface)", padding: "15px 16px" }}>
            {step.href ? (
              <Link href={step.href} style={{ textDecoration: "none", display: "block", color: "inherit" }}>
                {body}
              </Link>
            ) : (
              body
            )}
          </div>
        );
      })}
    </div>
  );
}

/** One thing worth doing next, with the reason and a single button. */
export function NextAction({
  title,
  body,
  action,
  tone = "brand",
  icon,
}: {
  title: string;
  body: React.ReactNode;
  action: React.ReactNode;
  tone?: Tone;
  icon?: string;
}) {
  return (
    <div
      className="card"
      data-tone={tone}
      style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 11, flex: "1 1 320px", minWidth: 290 }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
          {icon ? (
            <span aria-hidden style={{ fontSize: 18.5 }}>
              {icon}
            </span>
          ) : null}
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{title}</span>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--ink-3)", lineHeight: 1.55 }}>{body}</div>
      </div>
      <div style={{ marginTop: "auto" }}>{action}</div>
    </div>
  );
}

/** A small coloured label. Used for status words, never for numbers. */
export function Badge({ children, tone = "plain" }: { children: React.ReactNode; tone?: Tone }) {
  const c = toneVars(tone);
  return (
    <span
      className="badge"
      style={tone === "plain" ? undefined : { background: c.bg, color: c.ink, borderColor: "transparent" }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- facts

/**
 * One known thing about a business: what it is, what it says, and where it came from.
 *
 * The third line is the point. This product mixes facts from five sources of very different
 * reliability — Google's own listing, a crawl of their website, a paid Instagram lookup, a CSV
 * somebody uploaded, and a person typing — and a screen that shows them all in the same grey text
 * teaches the operator to trust them equally. They should not.
 *
 * `missing` is said out loud rather than left blank, because a blank space cannot distinguish
 * "they have none" from "nobody has looked yet", and this codebase has been bitten by that
 * confusion in the scoring, the checklists, the crawler and the critique.
 */
export function Fact({
  label,
  value,
  from,
  missing = "Not known",
  size = "normal",
  tone,
}: {
  label: string;
  value: React.ReactNode;
  /** Where it came from, in the operator's words: "their Google listing", "their own website". */
  from?: string;
  missing?: string;
  size?: "normal" | "large";
  tone?: Tone;
}) {
  const empty = value === null || value === undefined || value === "";
  const c = tone ? toneVars(tone) : null;
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 12,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: size === "large" ? 19 : 15.5,
          fontWeight: 600,
          lineHeight: 1.3,
          marginTop: 3,
          color: empty ? "var(--ink-3)" : c ? c.ink : "var(--ink)",
          wordBreak: "break-word",
        }}
      >
        {empty ? missing : value}
      </div>
      {/* Where it came from, marked as a source rather than as another fact: five sources of very
          different reliability should not all look equally trustworthy. */}
      {from ? (
        <div className="src" style={{ marginTop: 3 }}>
          {from}
        </div>
      ) : null}
    </div>
  );
}

/** A row of facts that wraps. One shape for every group, so the eye learns it once. */
export function FactGrid({ children, min = 190 }: { children: React.ReactNode; min?: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`,
        gap: "18px 24px",
        padding: "16px 18px",
      }}
    >
      {children}
    </div>
  );
}

/** Stars, drawn rather than described. A rating is compared at a glance or not at all. */
export function Stars({ rating }: { rating: number }) {
  const rounded = Math.round(rating * 2) / 2;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span aria-hidden style={{ color: "var(--warn)", letterSpacing: 1, fontSize: 15 }}>
        {"★".repeat(Math.floor(rounded))}
        {rounded % 1 >= 0.5 ? "½" : ""}
        <span style={{ color: "var(--line-3)" }}>{"★".repeat(5 - Math.ceil(rounded))}</span>
      </span>
      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>
        {rating.toFixed(1)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- money

/**
 * An amount of money, formatted the same way everywhere.
 *
 * Five screens had each written their own `(cents / 100).toFixed(2)`, and sub-cent amounts came out
 * as "$0.00" — which is not a small rounding annoyance in a product whose whole discipline is
 * knowing what has been spent. A third of a cent is not free, and saying it is free is how a
 * hundred and sixty Instagram lookups once got recorded as costing nothing.
 */
export function Money({ cents, free = "free" }: { cents: number; free?: string }) {
  if (cents === 0) return <>{free}</>;
  // Below a cent, dollars cannot say it. Cents can.
  if (cents < 1) return <>{cents < 0.01 ? "<0.01¢" : `${cents.toFixed(2)}¢`}</>;
  return <>${(cents / 100).toFixed(2)}</>;
}

/**
 * A price with the two things a price is useless without: **who bills it** and **what it buys**.
 *
 * The operator's report was that prices were confusing — *"pata hi nhi chalta ke price kis cheez
 * ki display ker raha hai"* — and separately, as a standing instruction, that every cost must name
 * the service behind it and say what that service does. A bare "$0.07" satisfies neither. This
 * component makes the unnamed version impossible to write by accident.
 */
export function Price({
  cents,
  what,
  platform,
  per,
  free = false,
  size = "normal",
}: {
  cents: number;
  /** What the money buys, in the operator's words: "their Google rating and review count". */
  what: string;
  /** Who bills it: "Google Places API", "Apify", "Google AI Studio (Gemini)". */
  platform: string;
  /** The unit, when there is one: "per business", "per page". */
  per?: string;
  /** True when this costs nothing at all — said plainly rather than shown as $0.00. */
  free?: boolean;
  size?: "normal" | "large";
}) {
  const big = size === "large";
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 1, verticalAlign: "top" }}>
      <span
        className="mono"
        style={{
          fontSize: big ? 20 : 15,
          fontWeight: 600,
          color: free ? "var(--good-ink)" : "var(--money-ink)",
          lineHeight: 1.15,
        }}
      >
        {free ? "Free" : <Money cents={cents} />}
        {per && !free ? <span style={{ fontSize: big ? 15 : 14, fontWeight: 550 }}> {per}</span> : null}
      </span>
      <span style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.4 }}>
        for {what}
      </span>
      <span style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.4 }}>
        {free ? "Costs nothing — " : "Billed by "}
        <strong style={{ color: "var(--ink)" }}>{platform}</strong>
      </span>
    </span>
  );
}

// ---------------------------------------------------------------- filters

/**
 * One filtering model, in one place.
 *
 * The page this replaced offered three that did not look like each other: chips in a bar, bar
 * charts that were secretly links, and stat cards that were not clickable at all. The operator
 * could not tell what any of it did. A single labelled sidebar where every control has the same
 * shape, a count, and a plain sentence under its heading is the whole fix.
 */
export function FilterSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "15px 16px", borderBottom: "1px solid var(--rule-2)" }}>
      <div
        style={{
          fontSize: 12,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--ink-4)",
          fontWeight: 700,
        }}
      >
        {title}
      </div>
      {hint ? (
        <div style={{ fontSize: 13, color: "var(--ink-3)", margin: "4px 0 9px", lineHeight: 1.45 }}>{hint}</div>
      ) : (
        <div style={{ height: 8 }} />
      )}
      {children}
    </div>
  );
}

/** One filter. Clicking the active one clears it, so a selection is never a dead end. */
export function FilterOption({
  label,
  count,
  href,
  active = false,
  explain,
  accent = false,
}: {
  label: string;
  count?: number;
  href: string;
  active?: boolean;
  explain?: string;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className="tip-left"
      // What pressing it does, in words. The option's own label says what it *is*; this says what
      // happens — and that clicking it again takes it off, which nothing on screen said before.
      data-tip={
        active
          ? `Showing only “${label}”. Click again to remove this filter.`
          : `Show only businesses that are “${label}”${count !== undefined ? ` — ${count} of them` : ""}. Combines with any other filters you have on.`
      }
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 8,
        padding: "8px 9px",
        margin: "2px -9px",
        borderRadius: 7,
        textDecoration: "none",
        background: active ? "var(--accent)" : "transparent",
        color: active ? "var(--on-accent)" : "var(--ink-2)",
      }}
    >
      <span style={{ flex: 1, fontSize: 14, fontWeight: active ? 600 : 450, lineHeight: 1.4 }}>
        {label}
        {explain ? (
          <span
            style={{
              display: "block",
              fontSize: 12.5,
              color: active ? "color-mix(in srgb, var(--on-accent) 88%, transparent)" : "var(--ink-3)",
              fontWeight: 400,
              marginTop: 1,
            }}
          >
            {explain}
          </span>
        ) : null}
      </span>
      {count !== undefined ? (
        <span
          className="mono"
          style={{
            fontSize: 12.5,
            color: active ? "var(--on-accent)" : accent ? "var(--accent-ink)" : "var(--ink-3)",
            fontWeight: 500,
          }}
        >
          {count}
        </span>
      ) : null}
    </Link>
  );
}

// ---------------------------------------------------------------- table bits

/**
 * A column heading, aligned by the component rather than by whichever table it lands in.
 *
 * `<th>` centres its contents by default, and only two of the ten tables in this product carry the
 * `.tbl` class that overrode it — so eight of them had headings floating in the middle of the
 * column while every cell beneath was hard left. The operator's report was that it looked wrong,
 * and it did: a two-line heading centred over left-aligned data reads as two unrelated fragments
 * rather than one label.
 *
 * Fixing it here rather than in the stylesheet means a new table cannot get it wrong by forgetting
 * a class name.
 */
/** `width` takes a percentage string as well as a pixel count — see the note on the leads table. */
export function Th({ label, explain, width }: { label: string; explain?: string; width?: number | string }) {
  return (
    <th
      style={{
        textAlign: "left",
        /**
         * Top, not bottom.
         *
         * Bottom-aligning made every heading hang off an invisible baseline set by whichever
         * column had the longest explanation — so "tick", "NO." and "BUSINESS" sat low in the row
         * while "SCORES" started high, and the header read as scattered rather than as a row.
         * Starting them all from the top lines the labels up with each other, which is the thing
         * the eye actually follows.
         */
        verticalAlign: "top",
        padding: "10px 12px",
        background: "var(--surface-2)",
        borderBottom: "1px solid var(--line-2)",
        ...(width ? { width } : {}),
      }}
    >
      <div
        style={{
          fontSize: 12,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          fontWeight: 700,
          lineHeight: 1.25,
        }}
      >
        {label}
      </div>
      {explain ? (
        <div
          style={{
            fontSize: 12.5,
            color: "var(--ink-3)",
            fontWeight: 450,
            textTransform: "none",
            letterSpacing: 0,
            lineHeight: 1.35,
            marginTop: 3,
            // Otherwise a long explanation stretches its column far wider than the data below it.
            maxWidth: 240,
          }}
        >
          {explain}
        </div>
      ) : null}
    </th>
  );
}

export const TD: React.CSSProperties = {
  padding: "12px",
  borderBottom: "1px solid var(--line)",
  fontSize: 14.5,
  color: "var(--ink-2)",
  verticalAlign: "top",
};

/** The priority badge, with its meaning spelled out beside it rather than hidden in a tooltip. */
export function TierBadge({ tier, showText = false }: { tier: number | null; showText?: boolean }) {
  if (tier === null) {
    return <span style={{ color: "var(--ink-3)", fontSize: 13.5 }}>{showText ? "Not scored" : "—"}</span>;
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span className={`pri p${tier}`}>{tier}</span>
      {showText ? <span style={{ fontSize: 13.5, color: "var(--ink-3)" }}>{TIER_MEANING[tier]}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------- vocabulary
// One place for every phrase the operator reads, so the same thing is never called two names.

export const TIER_MEANING: Record<number, string> = {
  1: "Lots wrong AND already spends money — call these first",
  2: "Spends money, but little is wrong — harder sell",
  3: "Lots wrong, but no sign they spend money yet",
  4: "Little wrong, no sign of spending — lowest priority",
};

export const ROUTE_LABELS: Record<string, string> = {
  web_development: "Build them a website",
  local_seo: "Get them found on Google",
  reputation: "Fix their reviews",
  contactability: "Make their site convert",
  social_media: "Run their social media",
  advertising: "Set up ads & tracking",
};

export const AREA_LABELS: Record<string, string> = {
  WEB: "Website quality",
  SEO: "Being found on Google",
  REP: "Reviews & reputation",
  CON: "Turning visitors into customers",
  SOC: "Social media",
  ADS: "Ads & tracking",
};

export const AREA_EXPLAIN: Record<string, string> = {
  WEB: "Is their website fast, modern, mobile-friendly and maintained?",
  SEO: "Can local customers find them on Google at all?",
  REP: "Do they have enough good reviews to be chosen?",
  CON: "Can a visitor actually phone, find, or message them?",
  SOC: "Are they on the platforms their customers use?",
  ADS: "Do they measure anything, or advertise at all?",
};

export const WEBSITE_LABELS: Record<string, string> = {
  live: "Working",
  dead: "Dead / parked",
  no_website: "None at all",
  social_only: "Social page only",
  unclear: "Couldn't check",
};

/**
 * Kept so the pages still importing `AppHeader` keep compiling while they are converted to
 * `AppShell`. It renders the top bar only — the rail comes from the shell.
 */
export function AppHeader({ back }: { current?: NavKey; email?: string | null; signOutAction?: unknown; back?: { href: string; label: string } }) {
  return back ? (
    <header className="topbar">
      <Link href={back.href} style={{ fontSize: 16, fontWeight: 600 }}>
        ← {back.label}
      </Link>
    </header>
  ) : null;
}
