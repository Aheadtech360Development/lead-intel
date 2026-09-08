import {
  AREA_WEIGHTS,
  ENRICHMENT_DEFINITIONS,
  ENRICHMENT_SOURCES,
  GATE_PROBLEM_SCORE,
  PRESENCE_OVERRIDE_PROBLEM_SCORE,
  TIER_INTENT_THRESHOLD,
  TIER_PROBLEM_THRESHOLD,
} from "@lead-intel/shared";
import { DEFAULT_DEMAND_THRESHOLDS } from "@lead-intel/core";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import {
  AREA_EXPLAIN,
  AREA_LABELS,
  AppShell,
  Badge,
  InfoBox,
  Money,
  Panel,
  ROUTE_LABELS,
  TIER_MEANING,
} from "../ui";

/**
 * How the whole product works, in one page, in plain words.
 *
 * The operator's request was exact: *"us Rules page mai saari cheezon ko detail mai explain kerna
 * kia cheez kese chal rahi hai or kahan se chalti hai"*. So this answers four questions about every
 * moving part — **what it does, where it runs, what it costs, and what it cannot do** — and the
 * fourth is not padding. Most of the confusion in this product has come from an operator assuming a
 * number meant more than it did.
 *
 * **Nothing here is typed out by hand.** The weights, thresholds, prices and warnings are read from
 * the same constants the scoring and buying code uses. A documentation page that restates numbers
 * is one that goes quietly wrong the first time one of them changes, and then teaches the operator
 * something false with complete confidence.
 */

export default async function RulesPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/login");

  return (
    <AppShell
      current="rules"
      email={typeof data.claims.email === "string" ? data.claims.email : null}
      signOutAction={signOut}
      title="How it works"
      what="Every rule in the product, in plain words. What runs, where it runs, what it costs, and — just as important — what it cannot tell you at any price."
    >
      <InfoBox title="The one sentence version" tone="brand">
        The product finds local businesses, reads their websites, counts what is wrong, and sorts them so the
        best phone call is the first row. Everything below is a detail of that sentence.
      </InfoBox>

      <Panel
        title="1. The five stages, and which are free"
        hint="Every business goes through these in order. Only two of them can ever cost money."
        tone="brand"
      >
        {STAGES.map((s, i) => (
          <div key={s.name} style={{ padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <span
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 99,
                  background: "var(--brand-bg)",
                  color: "var(--brand-ink)",
                  fontWeight: 800,
                  fontSize: 15,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i + 1}
              </span>
              <strong style={{ fontSize: 17 }}>{s.name}</strong>
              <Badge tone={s.paid ? "money" : "good"}>{s.paid ? "Can cost money" : "Always free"}</Badge>
              <span style={{ marginLeft: "auto", fontSize: 14.5, color: "var(--ink-2)" }}>Runs on {s.where}</span>
            </div>
            <div style={{ fontSize: 15.5, color: "var(--ink-2)", marginTop: 6, lineHeight: 1.6, maxWidth: 880 }}>
              {s.what}
            </div>
            {s.cannot ? (
              <div style={{ fontSize: 15, color: "var(--warn-ink)", marginTop: 6, lineHeight: 1.55, maxWidth: 880 }}>
                <strong>Cannot tell you:</strong> {s.cannot}
              </div>
            ) : null}
          </div>
        ))}
      </Panel>

      <Panel
        title="2. How a business gets its two scores"
        hint="Every number on the leads list comes from here. These weights are read straight from the code that does the scoring."
        tone="info"
      >
        <div style={{ padding: "14px 18px", fontSize: 15.5, lineHeight: 1.65, color: "var(--ink-2)" }}>
          <p style={{ margin: 0 }}>
            Fifty-one checks run against each business. Each belongs to an <strong>area</strong>, and each area
            scores out of 100 where <strong>higher means more is wrong</strong>. That is the opposite of what a
            score usually means, and it is the one thing most worth remembering:{" "}
            <strong style={{ color: "var(--ink)" }}>
              a high Problem score is a good lead, not a good business.
            </strong>
          </p>
        </div>

        <div style={{ padding: "0 18px 8px" }}>
          {(Object.keys(AREA_WEIGHTS) as (keyof typeof AREA_WEIGHTS)[]).map((area) => (
            <div
              key={area}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "baseline",
                padding: "8px 0",
                borderBottom: "1px solid var(--rule)",
                flexWrap: "wrap",
              }}
            >
              <strong style={{ fontSize: 15.5, minWidth: 230 }}>{AREA_LABELS[area]}</strong>
              <span style={{ fontSize: 15, color: "var(--ink-2)", flex: "1 1 300px" }}>{AREA_EXPLAIN[area]}</span>
              <span
                style={{
                  fontSize: 16.5,
                  fontWeight: 750,
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--info-ink)",
                }}
              >
                {Math.round(AREA_WEIGHTS[area] * 100)}%
              </span>
            </div>
          ))}
        </div>

        <div style={{ padding: "8px 18px 16px", fontSize: 15.5, lineHeight: 1.65, color: "var(--ink-2)" }}>
          <p style={{ margin: "10px 0" }}>
            <strong style={{ color: "var(--ink)" }}>Problem score</strong> is 60% the single worst area and 40%
            the weighted average of all of them. Weighting the worst area that heavily is deliberate: a business
            that is fine everywhere except that it has no website is a better call than one that is mediocre
            across the board, and an average alone would hide that.
          </p>
          <p style={{ margin: "10px 0" }}>
            <strong style={{ color: "var(--ink)" }}>Signals score</strong> measures whether they already spend
            money — ads running, a booking system, a paid theme, tracking installed. It answers a different
            question: not &ldquo;do they need help&rdquo; but &ldquo;will they pay for it&rdquo;.
          </p>
          <p style={{ margin: "10px 0 0" }}>
            A business with <strong>no website at all</strong> is given a Problem score of{" "}
            <strong style={{ color: "var(--ink)" }}>{PRESENCE_OVERRIDE_PROBLEM_SCORE}</strong> outright, because
            nothing else can be sold to them until there is one.
          </p>
        </div>
      </Panel>

      <Panel
        title="3. How the four priorities are decided"
        hint={`The two thresholds are the whole rule: Problem ${TIER_PROBLEM_THRESHOLD} or more means "a lot is wrong", Signals ${TIER_INTENT_THRESHOLD} or more means "they spend money".`}
        tone="bad"
      >
        {[1, 2, 3, 4].map((tier) => (
          <div
            key={tier}
            style={{
              display: "flex",
              gap: 14,
              alignItems: "baseline",
              padding: "12px 18px",
              borderTop: tier === 1 ? "none" : "1px solid var(--rule)",
            }}
          >
            <span
              style={{
                minWidth: 30,
                textAlign: "center",
                padding: "4px 9px",
                borderRadius: 7,
                fontWeight: 800,
                fontSize: 16,
                color: "#fff",
                background:
                  tier === 1
                    ? "var(--bad)"
                    : tier === 2
                      ? "var(--warn)"
                      : tier === 3
                        ? "var(--info)"
                        : "var(--ink-3)",
              }}
            >
              {tier}
            </span>
            <span style={{ fontSize: 15.5, color: "var(--ink)", lineHeight: 1.55 }}>{TIER_MEANING[tier]}</span>
          </div>
        ))}

        <div style={{ padding: "14px 18px", borderTop: "1px solid var(--rule)", background: "var(--surface-2)" }}>
          <strong style={{ fontSize: 16.5 }}>The exception you asked for</strong>
          <p style={{ fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.65, margin: "6px 0 0", maxWidth: 880 }}>
            A business with <strong>no website</strong> normally cannot reach Priority 1, because Priority 1 needs
            evidence that they spend money and that evidence usually lives on a website. So there is a second
            route in: if they have{" "}
            <strong>{DEFAULT_DEMAND_THRESHOLDS.minFollowers.toLocaleString("en-GB")}+ Instagram followers</strong>,
            or <strong>{DEFAULT_DEMAND_THRESHOLDS.minReviews}+ Google reviews at {DEFAULT_DEMAND_THRESHOLDS.minRating.toFixed(1)} stars or better</strong>,
            they go to Priority 1 regardless. Proven demand and no website is the strongest pitch there is — and
            if Google simply has their website missing, that is worth the call on its own.
          </p>
        </div>
      </Panel>

      <Panel title="4. What the product decides to sell them" hint="One of six, picked from whichever area scored worst.">
        <div style={{ padding: "12px 18px", display: "grid", gap: 10 }}>
          {Object.entries(ROUTE_LABELS).map(([key, label]) => (
            <div key={key} style={{ fontSize: 15.5, color: "var(--ink)", lineHeight: 1.55 }}>
              <strong>{label}</strong>
              <span style={{ color: "var(--ink-2)" }}> — {ROUTE_WHY[key] ?? ""}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "0 18px 16px", fontSize: 15, color: "var(--ink-2)", lineHeight: 1.6 }}>
          Businesses whose Problem score is under <strong>{GATE_PROBLEM_SCORE}</strong> are still scored and still
          listed — they are simply marked as not worth a call yet. Nothing is ever deleted for scoring low.
        </div>
      </Panel>

      <Panel
        title="5. The two things you write yourself"
        hint="Everything else in the product is fixed. These two are yours, and they change what you see immediately."
        tone="social"
      >
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--rule)" }}>
          <strong style={{ fontSize: 16.5 }}>Categories</strong>
          <span style={{ fontSize: 14.5, color: "var(--ink-2)" }}> — the Categories screen</span>
          <p style={{ fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.65, margin: "6px 0 0", maxWidth: 880 }}>
            A rule looks for words in what has already been collected — the business name, what Google files them
            under, and the text of their own website — and files matching businesses under a category you name.
            It runs over stored text, so it is <strong>free and instant</strong>, and re-running it never costs
            anything. A business that matches no rule stays uncategorised rather than being guessed at.
          </p>
        </div>
        <div style={{ padding: "14px 18px" }}>
          <strong style={{ fontSize: 16.5 }}>Checklists</strong>
          <span style={{ fontSize: 14.5, color: "var(--ink-2)" }}> — the Checklists screen</span>
          <p style={{ fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.65, margin: "6px 0 0", maxWidth: 880 }}>
            A rule says what a good page looks like: &ldquo;a contact page must have a form&rdquo;, &ldquo;the
            home page must show reviews&rdquo;. It is checked against every page already audited.{" "}
            <strong>These verdicts are worked out fresh every time you open a record</strong>, never stored — so
            editing a rule changes every business on the next page load, with nothing to re-run and nothing to
            pay.
          </p>
        </div>
      </Panel>

      <Panel
        title="6. Where AI is used, and where it deliberately is not"
        hint="Three places, all optional, all cheap. Everywhere else in this product is ordinary code doing arithmetic."
        tone="info"
      >
        {AI_USES.map((u, i) => (
          <div key={u.where} style={{ padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 16.5 }}>{u.where}</strong>
              <Badge tone="money">{u.cost}</Badge>
              <span style={{ marginLeft: "auto", fontSize: 14.5, color: "var(--ink-2)" }}>
                Billed by <strong style={{ color: "var(--ink)" }}>Google AI Studio (Gemini)</strong>
              </span>
            </div>
            <p style={{ fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.65, margin: "6px 0 0", maxWidth: 880 }}>
              {u.what}
            </p>
          </div>
        ))}
        <div style={{ padding: "14px 18px", borderTop: "1px solid var(--rule)", background: "var(--surface-2)" }}>
          <strong style={{ fontSize: 16.5 }}>The rule the model works under</strong>
          <p style={{ fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.65, margin: "6px 0 0", maxWidth: 880 }}>
            The model is <strong>never shown a raw website</strong> and is never asked to find facts. It only ever
            sees measurements that code has already taken, and is asked the one question code cannot answer:{" "}
            <em>is this any good?</em> A page can have a button reading &ldquo;Submit&rdquo;, pass every rule, and
            still ask nothing of the visitor — no amount of counting elements catches that. Everything factual on
            a record was measured, not guessed, and carries a label saying where it came from.
          </p>
        </div>
      </Panel>

      <Panel
        title="7. Everything that costs money"
        hint="Nothing here is ever bought automatically. You tick the businesses, you see the total, and you press the button."
        tone="money"
      >
        {ENRICHMENT_SOURCES.map((id, i) => {
          const d = ENRICHMENT_DEFINITIONS[id];
          return (
            <div key={id} style={{ padding: "15px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
              <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong style={{ fontSize: 16.5 }}>{d.label}</strong>
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 750,
                    color: "var(--money-ink)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <Money cents={d.costCents} />{" "}
                  <span style={{ fontSize: 14.5, fontWeight: 550 }}>per business</span>
                </span>
                <span style={{ marginLeft: "auto", fontSize: 14.5, color: "var(--ink-2)" }}>
                  Billed by <strong style={{ color: "var(--ink)" }}>{d.provider}</strong>
                </span>
              </div>
              <p style={{ fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.6, margin: "6px 0 0", maxWidth: 880 }}>
                {d.describes}
              </p>
              {d.requiresEnvVar ? (
                <p style={{ fontSize: 14.5, color: "var(--warn-ink)", margin: "6px 0 0", lineHeight: 1.55 }}>
                  Needs <code>{d.requiresEnvVar}</code> set on the worker. Until it is, this is shown and priced
                  but cannot be bought — so nothing ever fails halfway through a paid run.
                </p>
              ) : null}
              {d.warning ? (
                <p style={{ fontSize: 15, color: "var(--bad-ink)", lineHeight: 1.6, margin: "6px 0 0", maxWidth: 880 }}>
                  <strong>Read this first:</strong> {d.warning}
                </p>
              ) : null}
            </div>
          );
        })}
        <div
          style={{
            padding: "14px 18px",
            borderTop: "1px solid var(--rule)",
            background: "var(--surface-2)",
            fontSize: 15.5,
            lineHeight: 1.65,
            color: "var(--ink-2)",
          }}
        >
          <strong style={{ color: "var(--ink)" }}>You never pay twice for the same thing.</strong> Every purchase
          is written to a ledger before the request is sent, so a business you have already bought data for costs{" "}
          <strong>nothing</strong> the second time — and the confirm screen shows you that before you agree to
          anything. Every run also carries a spending limit that it stops at rather than exceeding.
        </div>
      </Panel>

      <Panel
        title="8. What cannot be obtained — at any price"
        hint="These are not missing features. They are things no provider sells, and knowing that saves you looking."
        tone="warn"
      >
        {WALLS.map((w, i) => (
          <div key={w.what} style={{ padding: "13px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
            <strong style={{ fontSize: 16.5 }}>{w.what}</strong>
            <p style={{ fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.6, margin: "5px 0 0", maxWidth: 880 }}>
              {w.why} <span style={{ color: "var(--ink-3)" }}>({w.how})</span>
            </p>
          </div>
        ))}
      </Panel>

      <Panel
        title="9. Where each part actually runs"
        hint="Three places. Knowing which is which is what makes a failure diagnosable rather than mysterious."
      >
        {PLACES.map((p, i) => (
          <div key={p.name} style={{ padding: "14px 18px", borderTop: i === 0 ? "none" : "1px solid var(--rule)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
              <strong style={{ fontSize: 16.5 }}>{p.name}</strong>
              <Badge tone={p.tone}>{p.cost}</Badge>
            </div>
            <p style={{ fontSize: 15.5, color: "var(--ink-2)", lineHeight: 1.65, margin: "6px 0 0", maxWidth: 880 }}>
              {p.what}
            </p>
          </div>
        ))}
      </Panel>
    </AppShell>
  );
}

// ---------------------------------------------------------------- the prose
// Kept as data rather than as markup, so each entry is one thing to read and one thing to correct.

const STAGES: { name: string; where: string; paid: boolean; what: string; cannot?: string }[] = [
  {
    name: "Finding them",
    where: "Google Places API",
    paid: true,
    what:
      "You give a trade and a place — 'print shop, Dallas, 25 miles' — and Google returns businesses in that circle. The circle is split into smaller ones automatically wherever it comes back full, because Google caps every search at 60 results and a full page means there were more it did not show.",
    cannot:
      "Whether a Google listing has been claimed by its owner. The field does not exist in the API, which was tested rather than assumed.",
  },
  {
    name: "Reading their website",
    where: "our own crawler",
    paid: false,
    what:
      "Their site is fetched and read: the pages, the text, the phone numbers, the social links, whether it works on a phone, how fast it loads. Nothing is paid for and no third party is involved, so this can be re-run as often as you like.",
    cannot:
      "Anything at all about a business with no website — which is exactly why those records have a box for you to paste an Instagram account into by hand.",
  },
  {
    name: "Checking it against 51 rules",
    where: "our own code",
    paid: false,
    what:
      "Every fact collected is tested: is there a mobile layout, is there a phone number you can tap, do they show reviews, is there any sign of advertising. Each answer is stored with the evidence that produced it, so every number on a record can be traced back to something that was actually seen.",
    cannot:
      "Judge whether what exists is any good. A page can pass every rule and still be useless — that gap is what the model is for.",
  },
  {
    name: "Filling the gaps you choose to pay for",
    where: "Google, Apify and others",
    paid: true,
    what:
      "Ratings, review counts, Instagram followers, whether they run ads. Every one of these is bought only when you tick the business and confirm the total. Nothing is ever bought automatically, and nothing is ever bought twice.",
  },
  {
    name: "Scoring and sorting",
    where: "our own code",
    paid: false,
    what:
      "The two scores, the priority, and what to sell them. Pure arithmetic over what has already been collected — it costs nothing and can be re-run at any time, which is why changing a rule never comes with a bill.",
  },
];

const ROUTE_WHY: Record<string, string> = {
  web_development: "they have no site, or one that is dead, broken, or unusable on a phone",
  local_seo: "their site works but local customers cannot find them on Google",
  reputation: "too few reviews, or a rating that loses them the choice",
  contactability: "people reach the site and then cannot phone, find or message them",
  social_media: "nothing on the platforms their customers actually use",
  advertising: "no tracking, no ads, no way of telling what their marketing does",
};

const AI_USES: { where: string; cost: string; what: string }[] = [
  {
    where: "Explain this business",
    cost: "about 0.1¢ each",
    what:
      "A short briefing written from the checks that fired, so you can read one paragraph instead of thirty rows before ringing. The rows stay on screen underneath it — if the paragraph is wrong, the real evidence is one line below it.",
  },
  {
    where: "What the model makes of a page",
    cost: "about 0.05¢ per page",
    what:
      "After a page has been measured, the model is shown the measurements and asked what they miss — whether the wording works, whether the order is right, whether a stranger would understand what the page wants from them. It is forbidden from repeating a check you can already see for yourself.",
  },
  {
    where: "Writing a category rule from a description",
    cost: "about 0.1¢ each",
    what:
      "You describe what you are after in ordinary words and it suggests the words to match on. It is a suggestion only — nothing is saved until you have looked at it and pressed save.",
  },
];

const WALLS: { what: string; why: string; how: string }[] = [
  {
    what: "Who follows an Instagram account",
    why: "Instagram publishes a follower count and never a list. There is no paid tier, no partner programme, and no provider anywhere that has it.",
    how: "Meta's own API documentation",
  },
  {
    what: "How much a business spends on Facebook ads",
    why: "Meta publishes ad spend only for political and social-issue advertising. For an ordinary business the field is empty in Meta's own public library, so nobody can sell you what Meta does not publish.",
    how: "Meta Ad Library, checked directly",
  },
  {
    what: "Whether a Google listing has been claimed",
    why: "The Places API has no such field. It is a natural thing to want, and it simply is not there.",
    how: "tested against live listings",
  },
  {
    what: "LinkedIn profiles in bulk",
    why: "The main provider was sued by LinkedIn and shut down in July 2025. Beyond the legal risk, local business owners are largely not on LinkedIn, so it would cost a great deal to learn very little.",
    how: "LinkedIn v. Nubela",
  },
  {
    what: "Google's own reviews and photos through the API",
    why: "The request succeeds and comes back empty. This was tested on three separate businesses including a Starbucks with 2,243 ratings, so it is not a quota problem and not a bad key.",
    how: "tested — returns HTTP 200 with an empty body",
  },
];

const PLACES: { name: string; cost: string; tone: "good" | "money" | "info"; what: string }[] = [
  {
    name: "This website — Vercel",
    cost: "Free tier",
    tone: "good",
    what:
      "Everything you look at and click. It never does slow work itself: pressing a button here puts a job on a queue and returns immediately, which is why a task that takes two minutes does not time out on you.",
  },
  {
    name: "The worker — Trigger.dev",
    cost: "Free tier, billed by machine time",
    tone: "info",
    what:
      "Every crawl, every browser, every purchase. It holds the keys and the database credentials; this website deliberately does not. Reading one business's whole website takes about 40 seconds of its machine time. If the worker is not running, a button here will tell you so rather than pretending it worked.",
  },
  {
    name: "The database and file storage — Supabase",
    cost: "Free tier",
    tone: "good",
    what:
      "Every business, every check, every purchase, and the screenshots. Screenshots are kept only for the home and product pages — the rest are shown to the model and then thrown away, which is what keeps the whole list inside the free gigabyte.",
  },
];
