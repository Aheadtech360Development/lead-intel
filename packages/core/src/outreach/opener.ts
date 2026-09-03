import type { ServiceRoute } from "@lead-intel/shared";
import type { CheckResult } from "../checks/types.js";

export interface Opener {
  channel: "call" | "message";
  text: string;
  /** The check this line is built from. §8.3: "Every suggested opening line names the finding it
   *  came from." Never optional — a line without one is not generated at all. */
  checkId: string;
  /** The finding's own evidence sentence, so an operator can see what the line rests on. */
  evidence: string;
}

export interface OpenerResult {
  openers: Opener[];
  /** Present when no line could be generated. Shown instead of a line, never alongside one. */
  reason: string | null;
}

/**
 * Builds the two suggested opening lines from §8.2 — one for a call, one for a message.
 *
 * §8.3 states the rule this function exists to keep: **"Every suggested opening line names the
 * finding it came from. If it cannot, none is generated."** So there is no template of last
 * resort, no "I noticed a few things about your website". A business whose findings are all
 * unmeasured gets no opener and a sentence saying why — which is the correct output, because
 * anything else would be an operator reading a confident sentence built on nothing.
 *
 * The line is drawn from the **routed area**, not from the highest-scoring finding overall.
 * Routing has already decided what to sell; an opener about tracking pixels on a call meant to
 * sell a website rebuild would undercut the conversation it is opening.
 *
 * Pure and deterministic — the same bar as everything else in packages/core.
 */
export function buildOpeners(params: {
  businessName: string;
  city: string | null;
  route: ServiceRoute | null;
  findings: CheckResult[];
  /** Checks already used for openers recently, so a run of calls does not repeat one script. */
  recentlyUsedCheckIds?: string[];
}): OpenerResult {
  if (params.route === null) {
    return {
      openers: [],
      reason: "There is no recommended service for this business yet, so there is nothing to open a conversation about.",
    };
  }

  const area = ROUTE_TO_AREA[params.route];
  const candidates = params.findings
    .filter((finding) => finding.outcome === "fired" && finding.area === area && OPENERS[finding.checkId])
    .sort((a, b) => b.points - a.points);

  // Prefer a finding the operator has not just used on the last three calls. Without this, one
  // very common finding — "no social links at all" fires on most of this dataset — gives five
  // businesses in a row the identical script, which is how a caller starts sounding like a robot.
  // Only ever a tie-break among findings that all genuinely fired; it never invents or promotes
  // something weaker than the evidence supports beyond one step.
  const overused = new Set(params.recentlyUsedCheckIds ?? []);
  const fresh = candidates.filter((finding) => !overused.has(finding.checkId));
  const chosen = fresh[0] ?? candidates[0];
  if (!chosen) {
    const anyFired = params.findings.some((finding) => finding.outcome === "fired" && finding.area === area);
    return {
      openers: [],
      reason: anyFired
        ? "The findings behind this recommendation have no opening line written for them yet."
        : "Nothing was found in the recommended area that could be opened with, so no line is suggested.",
    };
  }

  const template = OPENERS[chosen.checkId];
  if (!template) return { openers: [], reason: "No opening line is written for this finding yet." };

  const context = {
    name: params.businessName,
    place: params.city ? ` in ${titleCase(params.city)}` : "",
  };

  return {
    openers: [
      { channel: "call", text: template.call(context), checkId: chosen.checkId, evidence: chosen.evidence },
      { channel: "message", text: template.message(context), checkId: chosen.checkId, evidence: chosen.evidence },
    ],
    reason: null,
  };
}

const ROUTE_TO_AREA: Record<ServiceRoute, string> = {
  web_development: "WEB",
  local_seo: "SEO",
  reputation: "REP",
  contactability: "CON",
  social_media: "SOC",
  advertising: "ADS",
};

interface OpenerContext {
  name: string;
  /** " in Miami", or "" when the city is unknown. Never a bare placeholder. */
  place: string;
}

interface OpenerTemplate {
  call: (c: OpenerContext) => string;
  message: (c: OpenerContext) => string;
}

/**
 * One entry per check that can carry a conversation. Deliberately not one per check in the
 * catalogue: a line has to be worth saying out loud, and "your images are missing alt text" is not
 * how a call starts. A finding with no entry here simply is not used as an opener — the next
 * one down is, and if none qualifies, no line is generated.
 *
 * Every line states the observation and stops. None of them claims a result, promises a number,
 * or implies the business is failing — an opener that oversells is a worse outcome than no opener,
 * because the operator has to walk it back live.
 */
const OPENERS: Record<string, OpenerTemplate> = {
  // ---- WEB ----
  W1: {
    call: (c) => `Hi, is that ${c.name}? I was looking for your website${c.place} and couldn't find one — do you have one at the moment, or is it all through Google and word of mouth?`,
    message: (c) => `Hi ${c.name} — I went looking for your website${c.place} and couldn't find one. Is that right? Happy to show you what a simple one would look like for a business like yours.`,
  },
  W2: {
    call: (c) => `Hi, is that ${c.name}? I tried opening your website earlier and it isn't loading — I wanted to let you know in case you hadn't seen it.`,
    message: (c) => `Hi ${c.name} — your website address doesn't load at the moment. Thought you'd want to know, since anyone searching for you${c.place} would hit the same thing.`,
  },
  W4: {
    call: (c) => `Hi, is that ${c.name}? Your website is showing a security warning in the browser before it opens — I thought you'd want to know, because most people won't click past it.`,
    message: (c) => `Hi ${c.name} — your site shows a browser security warning before it loads. It's usually a quick fix, but until it is, most visitors turn back.`,
  },
  W5: {
    call: (c) => `Hi, is that ${c.name}? I opened your website on my phone and it's coming up at desktop size — everything's tiny. Is that how you've seen it?`,
    message: (c) => `Hi ${c.name} — opened your site on my phone and it loads at desktop width, so everything needs pinching to read. Most of your visitors${c.place} will be on a phone.`,
  },
  W6: {
    call: (c) => `Hi, is that ${c.name}? I loaded your website on a phone and it took a while before anything appeared — have you had a chance to check it on mobile recently?`,
    message: (c) => `Hi ${c.name} — timed your site on a phone and the page takes a good while before anything shows up. Worth a look, since that's where most people${c.place} will find you.`,
  },
  W7: {
    call: (c) => `Hi, is that ${c.name}? I ran your website through Google's own speed test and it scored quite low — that's the same score Google uses when ranking you.`,
    message: (c) => `Hi ${c.name} — ran your site through Google's PageSpeed test and it scores low on mobile. That's the same measurement Google uses for ranking, so it's worth knowing.`,
  },
  W8: {
    call: (c) => `Hi, is that ${c.name}? Your website looks like it's on an older site builder that isn't really being updated any more — is that something you've thought about?`,
    message: (c) => `Hi ${c.name} — your site looks like it's built on a platform that isn't being developed any more. Not urgent, but it does limit what you can do with it.`,
  },
  W9: {
    call: (c) => `Hi, is that ${c.name}? I noticed the copyright on your website is a couple of years out of date — has anyone been looking after the site lately?`,
    message: (c) => `Hi ${c.name} — the footer on your site still shows an old year. Small thing, but visitors do read it as a sign of whether a business is still active.`,
  },
  W10: {
    call: (c) => `Hi, is that ${c.name}? Your website is essentially a single page at the moment — was that deliberate, or has it just never been expanded?`,
    message: (c) => `Hi ${c.name} — your site is basically one page. That's fine as a starting point, but it does leave Google very little to rank you on${c.place}.`,
  },
  // ---- CON ----
  K1: {
    call: (c) => `Hi, is that ${c.name}? I couldn't find a phone number anywhere on your website — I had to get this number from your Google listing. Is that intentional?`,
    message: (c) => `Hi ${c.name} — I couldn't find a phone number on your website; I got in touch through your Google listing instead. Worth adding, if customers are trying to reach you.`,
  },
  K3: {
    call: (c) => `Hi, is that ${c.name}? There's no contact form on your website, so anyone who'd rather message than phone has no way to. Is that on purpose?`,
    message: (c) => `Hi ${c.name} — your site has no contact form, so anyone who'd rather write than call has nowhere to do it. Usually a quick addition.`,
  },
  K4: {
    call: (c) => `Hi, is that ${c.name}? I couldn't find your address on your website — for a local business that's usually the first thing people look for.`,
    message: (c) => `Hi ${c.name} — I couldn't find your address anywhere on your site. For a local business${c.place} that's normally the first thing someone checks.`,
  },
  K5: {
    call: (c) => `Hi, is that ${c.name}? Your website doesn't show your opening hours anywhere — do people ring up to ask when you're open?`,
    message: (c) => `Hi ${c.name} — your site doesn't list opening hours. It's one of the things people check before setting off, so worth having.`,
  },
  K8: {
    call: (c) => `Hi, is that ${c.name}? Someone landing on your website who's ready to buy doesn't have an obvious next step — no quote request or booking. Do most enquiries come by phone?`,
    message: (c) => `Hi ${c.name} — there's no clear next step on your site for someone ready to enquire; no quote form or booking. Curious how most of your enquiries come in.`,
  },
  // ---- SEO ----
  S1: {
    call: (c) => `Hi, is that ${c.name}? I couldn't find a Google Business Profile for you — that's usually where most local customers find a business like yours.`,
    message: (c) => `Hi ${c.name} — I couldn't find a Google Business Profile for you${c.place}. That's normally where most local searches end up, so it's a significant gap.`,
  },
  S3: {
    call: (c) => `Hi, is that ${c.name}? Your Google listing doesn't have opening hours on it — people searching often filter by what's open now, so you may be getting missed.`,
    message: (c) => `Hi ${c.name} — your Google listing has no opening hours set. Google filters by "open now" for a lot of local searches, so that quietly costs visibility.`,
  },
  S6: {
    call: (c) => `Hi, is that ${c.name}? Your Google listing doesn't link to a website, so everyone who finds you on Google stops there. Was that deliberate?`,
    message: (c) => `Hi ${c.name} — your Google listing has no website link on it, so anyone finding you there has nowhere further to go.`,
  },
  S9: {
    call: (c) => `Hi, is that ${c.name}? Your website doesn't tell Google what kind of business it is in the way Google expects — it's having to guess from your text.`,
    message: (c) => `Hi ${c.name} — your site is missing the structured details Google reads to understand a local business. It's invisible to a visitor, but it affects how you show up.`,
  },
  S13: {
    call: (c) => `Hi, is that ${c.name}? Your website is currently telling search engines not to index it — I thought you'd want to know, because it means Google can't show it at all.`,
    message: (c) => `Hi ${c.name} — your site is currently set to block search engines from indexing it. That's usually left over from when a site was being built. It means Google can't list it.`,
  },
  S14: {
    call: (c) => `Hi, is that ${c.name}? Your homepage title doesn't mention what you do or where you are, which is exactly what someone searching locally would type.`,
    message: (c) => `Hi ${c.name} — your homepage title doesn't mention your service or your area. Those are the two words someone searching locally actually types.`,
  },
  // ---- REP ----
  R1: {
    call: (c) => `Hi, is that ${c.name}? I noticed you've got fewer Google reviews than most places nearby — is asking for reviews something you've tried?`,
    message: (c) => `Hi ${c.name} — you've got noticeably fewer Google reviews than similar businesses${c.place}. Usually it's not the service, just that nobody's asking.`,
  },
  R2: {
    call: (c) => `Hi, is that ${c.name}? Your Google rating is sitting a bit below where most local businesses land — have you had a chance to look at what's behind it?`,
    message: (c) => `Hi ${c.name} — your Google rating is below where most local businesses sit. Often it's a handful of old reviews pulling the average down.`,
  },
  R6: {
    call: (c) => `Hi, is that ${c.name}? You've got good reviews on Google but none of them appear on your own website — that's proof you've already earned, going unused.`,
    message: (c) => `Hi ${c.name} — you've earned good reviews on Google, but none of them show on your website. That's social proof you already have and aren't using.`,
  },
  // ---- SOC ----
  O1: {
    call: (c) => `Hi, is that ${c.name}? I couldn't find any social links on your website — are you on Facebook or Instagram at all?`,
    message: (c) => `Hi ${c.name} — I couldn't find any social profiles linked from your site. Are you on Facebook or Instagram? If so they're worth linking; if not, that's worth a conversation.`,
  },
  O2: {
    call: (c) => `Hi, is that ${c.name}? I couldn't find a Facebook page linked from your website — do you have one?`,
    message: (c) => `Hi ${c.name} — couldn't find a Facebook page linked from your site. For a local business${c.place} that's often where a good share of enquiries start.`,
  },
  O4: {
    call: (c) => `Hi, is that ${c.name}? There's no Instagram linked from your website — for what you do, that's usually where the work gets shown off.`,
    message: (c) => `Hi ${c.name} — no Instagram linked from your site. For a business whose work is visual, that's normally the strongest channel.`,
  },
  O6: {
    call: (c) => `Hi, is that ${c.name}? You're on one or two social platforms but not the others your competitors are using — has that been a deliberate choice?`,
    message: (c) => `Hi ${c.name} — you're linked to one or two social platforms, fewer than most similar businesses${c.place}. Wondered whether that's deliberate.`,
  },
  // ---- ADS ----
  D1: {
    call: (c) => `Hi, is that ${c.name}? Your website has no tracking on it at all, so there's currently no way to see how many people visit or where they come from. Has that ever been set up?`,
    message: (c) => `Hi ${c.name} — your site has no analytics or tracking on it, so there's no record of how many people visit or what they do. It's free to add and it's the starting point for everything else.`,
  },
  D2: {
    call: (c) => `Hi, is that ${c.name}? There's no Meta Pixel on your website, which means any Facebook or Instagram advertising can't be measured or targeted. Have you run ads before?`,
    message: (c) => `Hi ${c.name} — there's no Meta Pixel on your site, so Facebook and Instagram ads can't be targeted or measured. Worth having in place before any spend.`,
  },
  D4: {
    call: (c) => `Hi, is that ${c.name}? There's no analytics on your website, so nobody can see how many people are visiting it. Is that something you've looked at?`,
    message: (c) => `Hi ${c.name} — no analytics on your site, so there's no visibility into how many people land on it. Free to set up, and it makes everything after it measurable.`,
  },
  D6: {
    call: (c) => `Hi, is that ${c.name}? You've got tracking on your website but nothing set up to reach the people who visit and don't get in touch — that's usually the cheapest audience there is.`,
    message: (c) => `Hi ${c.name} — you've got tracking installed but nothing retargeting the visitors who leave without enquiring. That audience is already being collected and not used.`,
  },
};

/** "fort worth" -> "Fort Worth". City names are stored lowercased by the normaliser. */
function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}
