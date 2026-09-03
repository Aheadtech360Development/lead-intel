import { z } from "zod";
import { isApifyOk, runApifyActor, type ApifyOutcome, type ApifyRunResult } from "./run-actor.js";

/**
 * Whether a business is advertising on Facebook and Instagram right now, and since when.
 *
 * **The one thing this cannot tell you: how much they spend.** Meta publishes spend and impression
 * figures only for ads about elections, politics and social issues. For an ordinary commercial
 * advertiser — every business in this system — those fields are empty in Meta's own Ad Library,
 * so no tool, scraper or reseller can produce them. That is Meta policy, not a gap in this
 * adapter, and `spendKnown` is on the result so a screen can say so rather than showing a blank
 * that reads as zero.
 *
 * What it *can* tell you is the signal that matters most for §6.3's Intent score: a business
 * running ads today is a business already paying for marketing, which is the clearest evidence
 * available that it will pay for a service.
 */

export interface MetaAdsResult_Ok {
  outcome: "ok";
  /** True when at least one ad is live now. */
  runningAds: boolean;
  activeCount: number;
  totalCount: number;
  /** When the oldest ad still running began — how long they have been at it. */
  runningSince: string | null;
  /** The most recent ad start date seen. */
  latestAdAt: string | null;
  /** Which surfaces the ads appear on: Facebook, Instagram, Messenger, Audience Network. */
  platforms: string[];
  /** A few ad texts, so an operator can see what they are actually saying. */
  sampleAdTexts: string[];
  /**
   * Always false for commercial advertisers. Kept as a field rather than omitted so the UI can
   * explain the absence instead of rendering an empty cell that looks like zero spend.
   */
  spendKnown: false;
  elapsedMs: number;
}

export interface MetaAdsFailure {
  outcome: Exclude<ApifyOutcome, "ok">;
  status: number | null;
  providerMessage: string | null;
  detail: string | null;
  elapsedMs: number;
}

export type MetaAdsResult = MetaAdsResult_Ok | MetaAdsFailure;

export function isMetaAdsOk(result: MetaAdsResult): result is MetaAdsResult_Ok {
  return result.outcome === "ok";
}

export const META_ADS_ACTOR = "apify~facebook-ads-scraper";

const AdItem = z.object({
  adArchiveId: z.union([z.string(), z.number()]).nullish(),
  isActive: z.boolean().nullish(),
  startDate: z.union([z.string(), z.number()]).nullish(),
  endDate: z.union([z.string(), z.number()]).nullish(),
  publisherPlatform: z.array(z.string()).nullish(),
  snapshot: z
    .object({
      body: z.object({ text: z.string().nullish() }).nullish(),
      pageName: z.string().nullish(),
    })
    .nullish(),
});

/** Meta hands dates back as seconds, milliseconds or ISO strings depending on the field. */
function toIsoDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
  }
  // A ten-digit number is seconds; anything larger is already milliseconds.
  const ms = value < 1e12 ? value * 1000 : value;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export async function fetchMetaAds(params: {
  /** The business's Facebook page URL, as found on their own website. */
  facebookUrl: string;
  /** Ads are per result, so this is the cost lever. A handful is enough to answer the question. */
  maxAds?: number;
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<MetaAdsResult> {
  const startedAt = Date.now();

  const run: ApifyRunResult<unknown> = await runApifyActor({
    actor: META_ADS_ACTOR,
    input: {
      startUrls: [{ url: params.facebookUrl }],
      resultsLimit: params.maxAds ?? 20,
      activeStatus: "all",
    },
    ...(params.token ? { token: params.token } : {}),
    ...(params.timeoutMs ? { timeoutMs: params.timeoutMs } : {}),
    ...(params.fetchImpl ? { fetchImpl: params.fetchImpl } : {}),
  });

  // `not_found` here is a genuine answer and the caller records it as one: this page has never
  // run an ad that Meta's archive holds. That is a finding about the business, not a failure.
  if (!isApifyOk(run)) return { ...run, elapsedMs: Date.now() - startedAt };

  const ads = run.items.map((item) => AdItem.safeParse(item)).flatMap((r) => (r.success ? [r.data] : []));

  const active = ads.filter((ad) => ad.isActive === true);
  const startDates = active.map((ad) => toIsoDate(ad.startDate)).filter((d): d is string => d !== null);
  const allStarts = ads.map((ad) => toIsoDate(ad.startDate)).filter((d): d is string => d !== null);
  const platforms = [...new Set(ads.flatMap((ad) => ad.publisherPlatform ?? []))];
  const texts = ads
    .map((ad) => ad.snapshot?.body?.text ?? null)
    .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    .slice(0, 3)
    .map((t) => t.replace(/\s+/g, " ").slice(0, 200));

  return {
    outcome: "ok",
    runningAds: active.length > 0,
    activeCount: active.length,
    totalCount: ads.length,
    runningSince: startDates.length > 0 ? startDates.sort()[0]! : null,
    latestAdAt: allStarts.length > 0 ? allStarts.sort().at(-1)! : null,
    platforms,
    sampleAdTexts: texts,
    spendKnown: false,
    elapsedMs: Date.now() - startedAt,
  };
}
