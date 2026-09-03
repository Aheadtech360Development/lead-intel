import { z } from "zod";
import { isApifyOk, runApifyActor, type ApifyOutcome, type ApifyRunResult } from "./run-actor.js";

/**
 * One Instagram business profile: how many follow it, what Instagram says it sells, and its bio.
 *
 * **What Instagram publishes and what it does not.** `followersCount` is a number, not a list —
 * there is no legal source for who follows an account, at any price, and this adapter does not
 * pretend otherwise. `businessCategoryName` is a single label the owner picked from Instagram's
 * own list ("Clothing (Brand)", "Shopping & Retail"). Instagram has no second level, so a
 * sub-category like "t-shirts within fashion" is something this system derives from the bio, the
 * website and the category together — see the category rules in packages/core.
 */

export interface InstagramProfile {
  outcome: "ok";
  username: string;
  fullName: string | null;
  /** Null when the account is private or the field was withheld — never a guess, never 0. */
  followersCount: number | null;
  followsCount: number | null;
  postsCount: number | null;
  biography: string | null;
  /** The link in their bio, which is often a booking page or a shop rather than their website. */
  externalUrl: string | null;
  /** Instagram's own single-level category, exactly as the owner chose it. */
  categoryName: string | null;
  isBusinessAccount: boolean | null;
  isVerified: boolean | null;
  isPrivate: boolean | null;
  profilePicUrl: string | null;
  elapsedMs: number;
}

export interface InstagramFailure {
  outcome: Exclude<ApifyOutcome, "ok">;
  status: number | null;
  providerMessage: string | null;
  detail: string | null;
  elapsedMs: number;
}

export type InstagramResult = InstagramProfile | InstagramFailure;

export function isInstagramOk(result: InstagramResult): result is InstagramProfile {
  return result.outcome === "ok";
}

/** Apify's official first-party profile actor. */
export const INSTAGRAM_PROFILE_ACTOR = "apify~instagram-profile-scraper";

/**
 * Every field is optional on purpose.
 *
 * A scraper's output shape is not a contract — it follows whatever Instagram's page happens to
 * carry, and a private account, a deleted account and a rename each drop different fields. Marking
 * them required would turn a partial answer into a parse failure, and a parse failure into
 * `not_found`, which is the wrong thing to store about an account that plainly exists.
 */
const ProfileItem = z.object({
  username: z.string().optional(),
  fullName: z.string().nullish(),
  followersCount: z.number().nullish(),
  followsCount: z.number().nullish(),
  postsCount: z.number().nullish(),
  biography: z.string().nullish(),
  externalUrl: z.string().nullish(),
  businessCategoryName: z.string().nullish(),
  isBusinessAccount: z.boolean().nullish(),
  verified: z.boolean().nullish(),
  private: z.boolean().nullish(),
  profilePicUrl: z.string().nullish(),
  /** Present when the actor could not read that particular profile. */
  error: z.string().nullish(),
});

/**
 * Turns an Instagram URL into the handle Apify wants.
 *
 * Exported and tested because the URLs come from other people's websites, where they arrive with
 * tracking parameters, trailing slashes, `http`, no `www`, and sometimes a path to a specific post
 * rather than the profile. Getting this wrong means looking up the wrong account and reporting its
 * follower count against a business that has nothing to do with it.
 */
export function instagramHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;

  // A bare handle, with or without the @.
  if (!/instagram\.com/i.test(trimmed)) {
    const bare = trimmed.replace(/^@/, "");
    return /^[A-Za-z0-9._]{1,30}$/.test(bare) ? bare.toLowerCase() : null;
  }

  let path: string;
  try {
    path = new URL(/^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`).pathname;
  } catch {
    return null;
  }

  const segments = path.split("/").filter((s) => s.length > 0);
  const first = segments[0];
  if (!first) return null;

  // Instagram's own routes are not anybody's profile. `/p/` and `/reel/` are posts, `/explore/`
  // and `/stories/` are sections — following any of them would look up a handle that does not
  // exist and report it as "no account".
  const RESERVED = new Set(["p", "reel", "reels", "tv", "explore", "stories", "s", "accounts", "direct", "about"]);
  if (RESERVED.has(first.toLowerCase())) return null;

  const handle = first.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(handle)) return null;
  return PLATFORM_ACCOUNTS.has(handle) ? null : handle;
}

/**
 * Instagram accounts that belong to a platform, not to any business that links them.
 *
 * The same mistake `sharedPlatformDomain` guards against, one level along: a small salon's website
 * is a Booksy booking page, the footer links Instagram, and the link goes to **Booksy's own
 * account**. Bought without this check, "Pretty Braids By Jermeece" comes back with 142,191
 * followers and the category "Software" — which is true of Booksy and absurd about the salon.
 *
 * That is not a cosmetic error. It is a wrong number attached to a real business, and it is the
 * kind that survives: a follower rule fires on it, it sorts to the top of the list as the biggest
 * account in the set, and the first thing said on the call is congratulations on an audience they
 * do not have.
 *
 * Found by buying five profiles and reading them rather than by reasoning about the code. One of
 * the five was wrong.
 */
const PLATFORM_ACCOUNTS = new Set([
  // Booking and scheduling — the common case for salons and braiders in this dataset.
  "booksybiz",
  "booksy",
  "vagaro",
  "glossgenius",
  "styleseat",
  "fresha",
  "schedulicity",
  "setmore",
  "acuityscheduling",
  "square",
  "squareup",
  // Website builders, linked from "made with" footers.
  "squarespace",
  "wix",
  "shopify",
  "godaddy",
  "weebly",
  "webflow",
  "bigcartel",
  "wordpress",
  "wordpressdotcom",
  // Link-in-bio and the platforms themselves.
  "linktree",
  "instagram",
  "facebook",
  "meta",
  "whatsapp",
  "etsy",
  "yelp",
]);

export async function fetchInstagramProfile(params: {
  /** A profile URL or a bare handle — both are accepted. */
  url: string;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<InstagramResult> {
  const startedAt = Date.now();
  const handle = instagramHandle(params.url);

  if (!handle) {
    return {
      outcome: "not_found",
      status: null,
      providerMessage: null,
      detail: `"${params.url}" is not an Instagram profile address.`,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const run: ApifyRunResult<unknown> = await runApifyActor({
    actor: INSTAGRAM_PROFILE_ACTOR,
    input: { usernames: [handle] },
    ...(params.token ? { token: params.token } : {}),
    ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });

  if (!isApifyOk(run)) return { ...run, elapsedMs: Date.now() - startedAt };

  const parsed = ProfileItem.safeParse(run.items[0]);
  if (!parsed.success) {
    return {
      outcome: "failed",
      status: null,
      providerMessage: null,
      detail: `unexpected profile shape: ${parsed.error.message.slice(0, 200)}`,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const item = parsed.data;
  if (item.error || !item.username) {
    return {
      outcome: "not_found",
      status: null,
      providerMessage: item.error ?? null,
      detail: `@${handle} could not be read.`,
      elapsedMs: Date.now() - startedAt,
    };
  }

  return {
    outcome: "ok",
    username: item.username,
    fullName: item.fullName ?? null,
    followersCount: item.followersCount ?? null,
    followsCount: item.followsCount ?? null,
    postsCount: item.postsCount ?? null,
    biography: item.biography ?? null,
    externalUrl: item.externalUrl ?? null,
    categoryName: item.businessCategoryName ?? null,
    isBusinessAccount: item.isBusinessAccount ?? null,
    isVerified: item.verified ?? null,
    isPrivate: item.private ?? null,
    profilePicUrl: item.profilePicUrl ?? null,
    elapsedMs: Date.now() - startedAt,
  };
}
