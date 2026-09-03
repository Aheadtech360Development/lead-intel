import { socialAbsenceBlindSpot } from "./coverage.js";
import type { PageFacts } from "./parse.js";
import { fired, notMeasured, passed } from "./result.js";
import { SOCIAL_PLATFORMS } from "./signatures.js";
import type { CheckResult, SiteEvidence } from "./types.js";

/**
 * §5.5 — the FREE half of the SOC area. O3, O5, O7 and O8 need to read the platforms themselves
 * and are BEST_EFFORT work for a later increment.
 *
 * What this measures is exactly the one signal §5.5 says is "available for **every** platform,
 * always, for free: which platforms the business links to from its own website." That is a
 * narrower claim than "has no Facebook page", and the evidence wording below keeps it narrow —
 * a business may well have a page it has simply never linked to.
 */
export function runSocialChecks(evidence: SiteEvidence, pages: PageFacts[]): CheckResult[] {
  const ids = ["O1", "O2", "O4", "O6"];

  // Two ways this family can be blind, and both must silence it rather than let it conclude.
  //
  // A page that served no readable content served no links either, so an app-shell homepage would
  // otherwise report "no social presence at all" at 35 points. And — found on live data — a site
  // can keep every one of its social links on a single page that the crawl never reached:
  // `crystaldtf.com` links to Facebook, Instagram, TikTok and YouTube from `/pages/socials` and to
  // none of them from its homepage. The crawler now looks for that page; when it exists and could
  // not be read, saying "they have no Facebook" is a claim we have not earned.
  const blindSpot = socialAbsenceBlindSpot(evidence, pages);
  if (blindSpot !== null) return ids.map((id) => notMeasured(id, blindSpot));

  const linked = findLinkedPlatforms(pages);
  const names = linked.map((platform) => platform.name);
  // The URLs are kept, not only the platform names.
  //
  // For a long time this stored `["Instagram", "Facebook"]` and discarded the hrefs it had just
  // matched — which meant the system knew 162 businesses had an Instagram account and could not
  // say *which* one. Anything that reads those accounts (follower counts, the business category
  // Instagram publishes, whether a Facebook page is running ads) needs the handle, and searching
  // for it by business name is both a cost and a guess. It was already in our hands.
  const detail = {
    platforms: names,
    profiles: Object.fromEntries(linked.map((p) => [p.name, p.href])),
    pagesRead: pages.map((page) => page.role),
  };

  return [
    names.length === 0
      ? fired("O1", "The site links to no social profiles at all — for a local business that usually means there is nothing to link to.", { detail })
      : passed("O1", `The site links to ${names.join(", ")}.`, detail),

    names.includes("Facebook")
      ? passed("O2", "The site links to a Facebook page.", detail)
      : fired("O2", "No Facebook page is linked from the site.", { detail }),

    names.includes("Instagram")
      ? passed("O4", "The site links to an Instagram profile.", detail)
      : fired("O4", "No Instagram profile is linked from the site.", { detail }),

    names.length >= 3
      ? passed("O6", `The site links to ${names.length} platforms.`, detail)
      : fired("O6", `The site links to ${names.length === 0 ? "no" : `only ${names.length}`} social platform${names.length === 1 ? "" : "s"}.`, { detail }),
  ];
}

/** What a YouTube lookup found, in the terms O8 cares about. */
export interface VideoEvidence {
  /** Null when nothing was looked up — the check then says so instead of concluding. */
  channelFound: boolean | null;
  channelTitle?: string | null;
  /** ISO date of the newest upload, or null for a channel that has never posted. */
  latestVideoAt?: string | null;
  /** Why the lookup could not run, when it could not. */
  unavailableReason?: string | null;
}

/**
 * §5.5 O8 — "No video content".
 *
 * Kept apart from the four link checks above because it rests on entirely different evidence: they
 * read the business's own website, this asks YouTube. That also means it can be unknown while the
 * others are known, which is why `channelFound: null` has to be a state rather than a `false`.
 *
 * The match is by name and city and is therefore uncertain — "Miami Printing" could be anybody's
 * channel — so a channel that *is* found is reported with its title, and the operator can see what
 * we matched before repeating it to anyone.
 */
export function runVideoChecks(video: VideoEvidence): CheckResult[] {
  if (video.channelFound === null) {
    return [notMeasured("O8", video.unavailableReason ?? "No YouTube lookup has been run for this business.")];
  }

  if (!video.channelFound) {
    return [fired("O8", "No YouTube channel could be found for this business.", { detail: { channelFound: false } })];
  }

  const detail = { channelFound: true, channelTitle: video.channelTitle ?? null, latestVideoAt: video.latestVideoAt ?? null };

  if (!video.latestVideoAt) {
    return [
      fired("O8", `They have a YouTube channel (${video.channelTitle ?? "found by name"}) but nothing posted on it.`, {
        detail,
      }),
    ];
  }

  return [
    passed("O8", `They post video — the channel ${video.channelTitle ?? ""} last uploaded on ${video.latestVideoAt.slice(0, 10)}.`.replace(/\s+/g, " "), detail),
  ];
}

/**
 * The social profile URLs a site links to, keyed by platform.
 *
 * Exported because the audit stores these as fields of their own. It is the same matching the
 * checks do — one function, so the URL an operator sees on a record and the URL a check counted
 * can never be two different things.
 */
export function findSocialProfiles(pages: PageFacts[]): Record<string, string> {
  return Object.fromEntries(findLinkedPlatforms(pages).map((p) => [p.name, p.href]));
}

/**
 * Share buttons are excluded on purpose. "Share this on Facebook" appears on sites whose owner
 * has no Facebook page whatsoever, and counting it would mean O2 quietly never fires — the check
 * would look like it worked while measuring the site's plugins instead of its social presence.
 */
function findLinkedPlatforms(pages: PageFacts[]): { name: string; href: string }[] {
  const found = new Map<string, string>();

  for (const page of pages) {
    for (const href of page.linkHrefs) {
      if (!/^https?:\/\//i.test(href)) continue;
      for (const platform of SOCIAL_PLATFORMS) {
        if (found.has(platform.name)) continue;
        if (!platform.profile.test(href)) continue;
        if (platform.share?.test(href)) continue;
        // A bare "facebook.com/" with no handle after it is a logo link to the platform, not a
        // link to this business's page.
        if (!hasProfilePath(href)) continue;
        found.set(platform.name, href);
      }
    }
  }

  return [...found.entries()].map(([name, href]) => ({ name, href }));
}

function hasProfilePath(href: string): boolean {
  try {
    const path = new URL(href).pathname.replace(/^\/+|\/+$/g, "");
    return path.length > 0;
  } catch {
    return false;
  }
}
