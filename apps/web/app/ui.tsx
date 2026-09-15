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
import { loadRunningJobs } from "@/lib/job-runs";
import { RAIL_COOKIE, railIsOpen } from "@/lib/rail";
import { toggleRail } from "./actions";
import { RunningJobs } from "./running-jobs";

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
  | "instagram"
  | "search"
  | "import"
  | "icps"
  | "checklists"
  | "rules"
  | "spend";

/**
 * Every page in the product, in one list, in the order they are used.
 *
 * One list rather than a nav copied per page, because the copied version had a consequence worse
 * than duplication: `/records/import` was built, worked, and could not be reached from anywhere.
 * The `what` line is shown in the rail's tooltip and again as the page's own subtitle — the
 * operator asked to be told what each screen is for, and this is the one place that answer lives.
 */
export const NAV: { key: NavKey; href: string; icon: string; label: string; what: string; group: string }[] = [
  {
    key: "dashboard",
    href: "/dashboard",
    icon: "📊",
    label: "Dashboard",
    what: "How the whole list is doing, and what to do next.",
    group: "Overview",
  },
  {
    key: "leads",
    href: "/records",
    icon: "🎯",
    label: "Leads",
    what: "The call list. Ordered so the best call is the first row.",
    group: "Overview",
  },
  {
    key: "mine",
    href: "/records?claimed=me&view=everything",
    icon: "🙋",
    label: "My leads",
    what: "The leads you have claimed. Claiming one put your name on it and then gave you nowhere to find it again.",
    group: "Overview",
  },
  {
    key: "instagram",
    href: "/instagram",
    icon: "📸",
    label: "Instagram",
    what: "Followers, the category Instagram publishes, and who is running ads — on its own.",
    group: "Overview",
  },
  {
    key: "search",
    href: "/search",
    icon: "🔎",
    label: "Find businesses",
    what: "Search Google Maps by trade and place to add new businesses.",
    group: "Add businesses",
  },
  {
    key: "import",
    href: "/records/imports",
    icon: "📂",
    label: "Imported files",
    what: "Lists you uploaded, and exactly what each one produced.",
    group: "Add businesses",
  },
  {
    key: "icps",
    href: "/icps",
    icon: "🎯",
    label: "ICPs",
    what: "Who you want to sell to: the words each kind of customer is found and recognised by.",
    group: "Set up",
  },
  {
    key: "checklists",
    href: "/checklists",
    icon: "✓",
    label: "Checklists",
    what: "What a good page looks like, in your words — judged against every page audited.",
    group: "Set up",
  },
  {
    key: "rules",
    href: "/rules",
    icon: "📖",
    label: "How it works",
    what: "Every rule in the product, in plain words: what runs, where it runs, what it costs, and what it cannot do.",
    group: "Set up",
  },
  {
    key: "spend",
    href: "/spend",
    icon: "💳",
    label: "Data & spend",
    what: "What each kind of data costs, what is free, and what you have spent.",
    group: "Set up",
  },
];

/**
 * The frame every signed-in page sits in: a left rail, a top bar, and the page's own content.
 *
 * A rail rather than a top strip because the product now has six places to be. A strip had run out
 * of room, but the real gain is orientation — the rail is always visible, always in the same
 * order, and shows where you are without having to be read.
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
}) {
  const groups = [...new Set(NAV.map((n) => n.group))];

  /**
   * The queue, fetched here rather than passed in.
   *
   * Every page would otherwise have to remember, and the page that forgot would be exactly the one
   * where the operator sat watching a screen that never changed. One query, one index, every screen.
   */
  const runningJobs = await loadRunningJobs();

  /**
   * Narrow unless asked otherwise.
   *
   * Closed is the default because that is what was asked for. Closed still shows every icon, so
   * nothing becomes unreachable — it stops being a 232px column of words and becomes a 60px strip
   * of symbols, which is enough once the operator knows the seven places by their shape.
   */
  const railOpen = railIsOpen((await cookies()).get(RAIL_COOKIE)?.value);

  return (
    <div className="shell" data-rail={railOpen ? "open" : "closed"}>
      <nav className="rail">
        <div className="rail-top">
          <Link href="/dashboard" className="rail-brand" title="Lead Intel — dashboard">
            <span aria-hidden style={{ fontSize: 20.5 }}>◈</span>
            <span className="rail-word">Lead Intel</span>
          </Link>
          {/* A form, not a script. See toggleRail in app/actions.ts for why the state is a cookie. */}
          <form action={toggleRail}>
            <button
              type="submit"
              className="rail-toggle"
              title={railOpen ? "Make the sidebar narrow" : "Open the sidebar"}
              aria-label={railOpen ? "Make the sidebar narrow" : "Open the sidebar"}
            >
              {railOpen ? "«" : "»"}
            </button>
          </form>
        </div>

        {groups.map((group) => (
          <div key={group}>
            <div className="rail-group">{group}</div>
            {NAV.filter((n) => n.group === group).map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="rail-link"
                data-active={current === item.key}
                title={`${item.label} — ${item.what}`}
              >
                <span className="rail-icon" aria-hidden>
                  {item.icon}
                </span>
                <span className="rail-word">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}

        <div style={{ marginTop: "auto", paddingTop: 18 }}>
          {email ? (
            <div
              className="rail-word"
              style={{ fontSize: 14.5, color: "var(--ink-3)", padding: "0 10px 8px", wordBreak: "break-all" }}
            >
              {email}
            </div>
          ) : null}
          {signOutAction ? (
            <form action={signOutAction}>
              <button
                className="btn btn-quiet"
                type="submit"
                title="Sign out"
                style={{ width: "100%", justifyContent: "flex-start" }}
              >
                <span className="rail-icon" aria-hidden>
                  ⏻
                </span>
                <span className="rail-word">Sign out</span>
              </button>
            </form>
          ) : null}
        </div>
      </nav>

      <div className="shell-main">
        {(title || back || actions) && (
          <header className="topbar">
            {back ? (
              <Link href={back.href} style={{ fontSize: 16, fontWeight: 600 }}>
                ← {back.label}
              </Link>
            ) : (
              <div style={{ minWidth: 0 }}>
                <h1 style={{ fontSize: 22, margin: 0, lineHeight: 1.25 }}>{title}</h1>
              </div>
            )}
            {actions ? <div style={{ marginLeft: "auto", display: "flex", gap: 9, flexWrap: "wrap" }}>{actions}</div> : null}
          </header>
        )}

        {/* `wide` now means the full width of the window rather than 1680px. The leads table has a
              1290px minimum, so on a wide screen the old cap left an empty band down each side while
              the table still scrolled sideways inside it — the worst of both. Reading-width pages keep
              their cap, because a paragraph 1900px wide is unreadable for the opposite reason. */}
          <main style={{ padding: "22px 30px 0", maxWidth: wide ? "100%" : 1180, margin: "0 auto" }}>
          <RunningJobs jobs={runningJobs} autoRefresh={autoRefresh} />
          {what ? (
            <p style={{ margin: "0 0 20px", fontSize: 16.5, color: "var(--ink-2)", maxWidth: 820, lineHeight: 1.6 }}>
              {what}
            </p>
          ) : null}
          {children}
        </main>
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

export const PANEL_HEAD: React.CSSProperties = { padding: "14px 18px 12px", borderBottom: "1px solid var(--rule)" };

export const PANEL_TITLE: React.CSSProperties = { fontSize: 18, fontWeight: 750, margin: 0, color: "var(--ink)" };

export const PANEL_HINT: React.CSSProperties = {
  fontSize: 14.5,
  color: "var(--ink-2)",
  margin: "4px 0 0",
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
    <div style={{ display: "flex", alignItems: "flex-end", gap: 16, margin: "26px 0 12px" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontSize: 19, margin: 0 }}>{title}</h2>
        {hint ? <p style={{ fontSize: 15, color: "var(--ink-3)", margin: "2px 0 0" }}>{hint}</p> : null}
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
      style={{
        background: c.bg,
        borderLeft: `3px solid ${c.fg}`,
        borderRadius: "0 var(--radius) var(--radius) 0",
        padding: "14px 18px",
        marginBottom: 18,
        fontSize: 16,
        lineHeight: 1.65,
        color: "var(--ink-2)",
      }}
    >
      {title ? <div style={{ fontWeight: 700, color: c.ink, marginBottom: 5, fontSize: 16.5 }}>{title}</div> : null}
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
      style={{
        display: "flex",
        gap: 10,
        alignItems: "baseline",
        background: c.bg,
        borderLeft: `3px solid ${c.fg}`,
        borderRadius: "0 6px 6px 0",
        padding: "12px 16px",
        marginBottom: 14,
        fontSize: 16,
        lineHeight: 1.6,
        color: "var(--ink)",
      }}
    >
      <span aria-hidden style={{ color: c.fg, fontWeight: 700 }}>
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

export function Note({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "warn" }) {
  const c = toneVars(tone === "warn" ? "warn" : "plain");
  return (
    <p
      style={{
        margin: 0,
        padding: "11px 18px",
        fontSize: 14.5,
        lineHeight: 1.55,
        color: tone === "warn" ? "var(--warn-ink)" : "var(--ink-3)",
        background: tone === "warn" ? c.bg : "transparent",
        borderTop: "1px solid var(--rule)",
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
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {icon ? (
          <span
            aria-hidden
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: c.bg,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16.5,
            }}
          >
            {icon}
          </span>
        ) : null}
        <span style={{ fontSize: 14.5, fontWeight: 650, color: "var(--ink-2)" }}>{label}</span>
      </div>
      <div
        style={{
          fontSize: 34,
          fontWeight: 750,
          lineHeight: 1.05,
          color: tone === "plain" ? "var(--ink)" : c.ink,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      {explain ? (
        <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 5, lineHeight: 1.42 }}>{explain}</div>
      ) : null}
    </>
  );

  return (
    <div
      className="card"
      {...(tone !== "plain" ? { "data-tone": tone } : {})}
      style={{ padding: "14px 16px", flex: "1 1 190px", minWidth: 180 }}
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
    return <div style={{ height, background: "var(--surface-3)", borderRadius: 99, opacity: 0.7 }} title="Not measured" />;
  }
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const colour =
    tone === "good"
      ? "var(--good)"
      : tone === "neutral"
        ? "var(--brand)"
        : pct >= 70
          ? "var(--bad)"
          : pct >= 40
            ? "var(--warn)"
            : "var(--good)";
  return (
    <div style={{ height, background: "var(--surface-3)", borderRadius: 99, overflow: "hidden" }}>
      <div style={{ width: `${pct}%`, height: "100%", background: colour, borderRadius: 99 }} />
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
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, marginBottom: 4 }}>
        <span style={{ color: "var(--ink-2)" }}>{label}</span>
        <span style={{ color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>
          {count} <span style={{ fontSize: 13.5 }}>({pct}%)</span>
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
export function ScoreBars({ problem, intent }: { problem: number | null; intent: number | null }) {
  const line = (text: string, value: number | null, tone: "problem" | "good") => (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14.5, marginBottom: 2 }}>
        <span style={{ color: "var(--ink-3)" }}>{text}</span>
        <span style={{ color: "var(--ink-2)", fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>
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
              style={{
                fontSize: 30,
                fontWeight: 750,
                lineHeight: 1.05,
                color: (step.tone ?? "plain") === "plain" ? "var(--ink)" : c.ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {step.value}
            </div>
            <div style={{ fontSize: 14.5, fontWeight: 650, color: "var(--ink-2)", marginTop: 2 }}>{step.label}</div>
            <div style={{ fontSize: 14.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.38, minHeight: 32 }}>
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
          <span style={{ fontSize: 17, fontWeight: 700 }}>{title}</span>
        </div>
        <div style={{ fontSize: 15, color: "var(--ink-3)", lineHeight: 1.55 }}>{body}</div>
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
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 99,
        fontSize: 14.5,
        fontWeight: 650,
        background: c.bg,
        color: tone === "plain" ? "var(--ink-2)" : c.ink,
        whiteSpace: "nowrap",
      }}
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
          fontSize: 13.5,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          color: "var(--ink-2)",
          fontWeight: 800,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: size === "large" ? 21 : 17,
          fontWeight: 650,
          lineHeight: 1.3,
          marginTop: 3,
          color: empty ? "var(--ink-3)" : c ? c.ink : "var(--ink)",
          wordBreak: "break-word",
        }}
      >
        {empty ? missing : value}
      </div>
      {from ? <div style={{ fontSize: 14, color: "var(--ink-2)", marginTop: 2, lineHeight: 1.4 }}>{from}</div> : null}
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
      <span aria-hidden style={{ color: "var(--warn)", letterSpacing: 1, fontSize: 17 }}>
        {"★".repeat(Math.floor(rounded))}
        {rounded % 1 >= 0.5 ? "½" : ""}
        <span style={{ color: "var(--rule-2)" }}>{"★".repeat(5 - Math.ceil(rounded))}</span>
      </span>
      <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 750 }}>{rating.toFixed(1)}</span>
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
        style={{
          fontSize: big ? 22 : 16,
          fontWeight: 750,
          color: free ? "var(--good-ink)" : "var(--money-ink)",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.15,
        }}
      >
        {free ? "Free" : <Money cents={cents} />}
        {per && !free ? <span style={{ fontSize: big ? 15 : 14, fontWeight: 550 }}> {per}</span> : null}
      </span>
      <span style={{ fontSize: 14.5, color: "var(--ink-2)", lineHeight: 1.4 }}>
        for {what}
      </span>
      <span style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.4 }}>
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
          fontSize: 14,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ink)",
          fontWeight: 800,
        }}
      >
        {title}
      </div>
      {hint ? (
        <div style={{ fontSize: 14.5, color: "var(--ink-2)", margin: "4px 0 9px", lineHeight: 1.45 }}>{hint}</div>
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
        background: active ? "var(--brand)" : "transparent",
        color: active ? "#fff" : "var(--ink)",
      }}
    >
      <span style={{ flex: 1, fontSize: 15.5, fontWeight: active ? 700 : 550, lineHeight: 1.4 }}>
        {label}
        {explain ? (
          <span
            style={{
              display: "block",
              fontSize: 14,
              color: active ? "rgba(255,255,255,0.94)" : "var(--ink-2)",
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
          style={{
            fontSize: 15,
            fontVariantNumeric: "tabular-nums",
            color: active ? "#fff" : accent ? "var(--brand)" : "var(--ink)",
            fontWeight: 700,
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
        padding: "10px 14px",
        background: "var(--surface-2)",
        borderBottom: "1px solid var(--rule)",
        ...(width ? { width } : {}),
      }}
    >
      <div style={{ fontSize: 14, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--ink)", fontWeight: 800, lineHeight: 1.25 }}>
        {label}
      </div>
      {explain ? (
        <div
          style={{
            fontSize: 14,
            color: "var(--ink-2)",
            fontWeight: 500,
            textTransform: "none",
            letterSpacing: 0,
            lineHeight: 1.35,
            marginTop: 2,
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
  padding: "13px 14px",
  borderBottom: "1px solid var(--rule)",
  fontSize: 15.5,
  color: "var(--ink)",
  verticalAlign: "top",
};

/** The priority badge, with its meaning spelled out beside it rather than hidden in a tooltip. */
export function TierBadge({ tier, showText = false }: { tier: number | null; showText?: boolean }) {
  if (tier === null) {
    return <span style={{ color: "var(--ink-3)", fontSize: 14.5 }}>{showText ? "Not scored" : "—"}</span>;
  }
  const tone: Tone = tier === 1 ? "bad" : tier === 2 ? "warn" : tier === 3 ? "info" : "plain";
  const c = toneVars(tone);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          display: "inline-block",
          minWidth: 26,
          textAlign: "center",
          padding: "3px 8px",
          borderRadius: 7,
          fontWeight: 750,
          fontSize: 14.5,
          color: tone === "plain" ? "var(--ink-2)" : "#fff",
          background: tone === "plain" ? "var(--surface-3)" : c.fg,
        }}
      >
        {tier}
      </span>
      {showText ? <span style={{ fontSize: 14.5, color: "var(--ink-3)" }}>{TIER_MEANING[tier]}</span> : null}
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
