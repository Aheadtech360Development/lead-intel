import { runVideoChecks, type VideoEvidence } from "@lead-intel/core";
import { businesses, describeDbError, type Database } from "@lead-intel/db";
import { findYouTubeChannel, isYouTubeOk } from "@lead-intel/providers";
import { eq } from "drizzle-orm";
import { upsertFieldMetadata } from "./field-metadata.js";
import { upsertFindings } from "./findings.js";
import { scoreAndStore } from "./scoring.js";

export interface YouTubeSummary {
  businessId: string;
  name: string;
  outcome: string;
  channelTitle: string | null;
  latestVideoAt: string | null;
  /** Set when the daily quota ran out — the caller must stop, not skip to the next business. */
  quotaExhausted: boolean;
  elapsedMs: number;
}

/**
 * Looks up one business's YouTube channel, records O8, and refreshes its score.
 *
 * Its own pass rather than part of the audit, for the same reason PageSpeed is: this is bounded by
 * a provider's daily quota, not by our politeness to a website. YouTube allows 10,000 units a day
 * and a channel search costs 100 of them, so a full pass over a few hundred businesses spans more
 * than one day. Tying that to the crawl would make the crawl inherit the limit.
 *
 * `quota_exhausted` is deliberately not treated like other failures. Every other outcome is a fact
 * about one business and the pass should continue; running out of quota is a fact about the day,
 * and continuing would burn through the rest of the list recording failures that mean nothing.
 */
export async function youTubeBusiness(db: Database, businessId: string): Promise<YouTubeSummary> {
  const startedAt = Date.now();

  const [business] = await db
    .select({ id: businesses.id, name: businesses.displayName, city: businesses.city })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) throw new Error(`business ${businessId} not found`);

  const result = await findYouTubeChannel({ businessName: business.name, city: business.city });

  const quotaExhausted = !isYouTubeOk(result) && result.outcome === "quota_exhausted";

  // Nothing is written when the quota is gone. A stored outcome is a record that we looked, and
  // we did not — writing one would mean this business is skipped on every future pass, which is
  // exactly how a day's interruption turns into a permanent hole in the data.
  if (quotaExhausted) {
    return {
      businessId,
      name: business.name,
      outcome: "quota_exhausted",
      channelTitle: null,
      latestVideoAt: null,
      quotaExhausted: true,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const video: VideoEvidence = isYouTubeOk(result)
    ? { channelFound: true, channelTitle: result.channelTitle, latestVideoAt: result.latestVideoAt }
    : result.outcome === "no_channel"
      ? { channelFound: false }
      : {
          channelFound: null,
          unavailableReason: `YouTube could not be checked (${result.outcome})${
            result.providerMessage ? `: ${result.providerMessage}` : result.detail ? `: ${result.detail}` : ""
          }`,
        };

  try {
    // Annotated, because inference would otherwise take `value`'s type from the first element —
    // the outcome union — and reject every plain string pushed after it.
    const fields: { fieldName: string; value: string; sourceName: string }[] = [
      { fieldName: "youtube_outcome", value: result.outcome, sourceName: "youtube" },
    ];
    if (isYouTubeOk(result)) {
      fields.push({ fieldName: "youtube_channel_id", value: result.channelId, sourceName: "youtube" });
      fields.push({ fieldName: "youtube_channel_title", value: result.channelTitle, sourceName: "youtube" });
      if (result.latestVideoAt) {
        fields.push({ fieldName: "youtube_latest_video_at", value: result.latestVideoAt, sourceName: "youtube" });
      }
    }
    await upsertFieldMetadata(db, businessId, fields);
    await upsertFindings(db, businessId, runVideoChecks(video), { sourceName: "youtube" });
  } catch (err) {
    throw new Error(`failed to record YouTube for ${business.name}: ${describeDbError(err)}`);
  }

  await scoreAndStore(db, businessId);

  return {
    businessId,
    name: business.name,
    outcome: result.outcome,
    channelTitle: isYouTubeOk(result) ? result.channelTitle : null,
    latestVideoAt: isYouTubeOk(result) ? result.latestVideoAt : null,
    quotaExhausted: false,
    elapsedMs: Date.now() - startedAt,
  };
}
