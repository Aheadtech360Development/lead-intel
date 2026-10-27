import { ENRICHMENT_DEFINITIONS } from "@lead-intel/shared";
import { businesses, describeDbError, fieldMetadata, type Database } from "@lead-intel/db";
import { runMetaAdsChecks } from "@lead-intel/core";
import { fetchMetaAds, isApifyFatal, isMetaAdsOk } from "@lead-intel/providers";
import { and, eq } from "drizzle-orm";
import { upsertFieldMetadata } from "./field-metadata.js";
import { upsertFindings } from "./findings.js";
import { recordProviderCall } from "./provider-calls.js";
import { scoreAndStore } from "./scoring.js";

export interface MetaAdsSummary {
  businessId: string;
  name: string;
  outcome: string;
  runningAds: boolean | null;
  activeCount: number | null;
  runningSince: string | null;
  costCents: number;
  fatal: boolean;
}

/**
 * Finds out whether a business is advertising on Facebook or Instagram, and since when.
 *
 * **It cannot find out what they spend, and nothing can.** Meta publishes spend and impressions
 * only for ads about elections, politics and social issues; for an ordinary business those fields
 * are empty in Meta's own Ad Library. That is worth stating on the record because "how much do
 * they spend on ads" is the obvious next question and the honest answer is that the number is not
 * published to anybody.
 *
 * What it does answer is the one §6.3 actually needs: a business running ads today is already
 * paying for marketing, which is the strongest single piece of evidence that it will pay for a
 * service.
 *
 * A page with no ads in the archive is a **finding**, not a failure — recorded as such so the
 * business is not re-bought on the next pass.
 */
export async function metaAdsBusiness(db: Database, businessId: string): Promise<MetaAdsSummary> {
  const [business] = await db
    .select({ id: businesses.id, name: businesses.displayName })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) throw new Error(`business ${businessId} not found`);

  const [link] = await db
    .select({ value: fieldMetadata.value })
    .from(fieldMetadata)
    .where(and(eq(fieldMetadata.businessId, businessId), eq(fieldMetadata.fieldName, "facebook_url")))
    .limit(1);

  const base = {
    businessId,
    name: business.name,
    runningAds: null,
    activeCount: null,
    runningSince: null,
    fatal: false,
  };

  if (!link?.value) return { ...base, outcome: "no_page", costCents: 0 };

  const cost = ENRICHMENT_DEFINITIONS.meta_ads.costCents;

  const ledger = await recordProviderCall(db, {
    businessId,
    provider: "apify",
    endpoint: "apify.metaads",
    costCents: cost,
  });
  if (ledger === "already_bought") return { ...base, outcome: "already_bought", costCents: 0 };

  const result = await fetchMetaAds({ facebookUrl: link.value });

  // `not_found` is the archive answering: this page has never run an ad it holds. Recorded as a
  // real state so the next pass does not buy it again, and so the record can say "we checked".
  if (!isMetaAdsOk(result) && result.outcome !== "not_found") {
    const fatal = isApifyFatal(result);
    await recordProviderCall(db, {
      businessId,
      provider: "apify",
      endpoint: "apify.metaads",
      costCents: fatal ? 0 : cost,
      status: "failed",
      detail: result.providerMessage ?? result.detail ?? result.outcome,
    });
    return { ...base, outcome: result.outcome, costCents: fatal ? 0 : cost, fatal };
  }

  const found = isMetaAdsOk(result);
  const fields: { fieldName: string; value: string; sourceName: string }[] = [
    { fieldName: "meta_ads_running", value: String(found && result.runningAds), sourceName: "apify_metaads" },
    { fieldName: "meta_ads_checked_at", value: new Date().toISOString(), sourceName: "apify_metaads" },
    // Stored so a screen can say "Meta does not publish this" rather than leaving a blank cell
    // that an operator reads as zero.
    { fieldName: "meta_ads_spend_known", value: "false", sourceName: "apify_metaads" },
  ];

  if (found) {
    fields.push({ fieldName: "meta_ads_active_count", value: String(result.activeCount), sourceName: "apify_metaads" });
    fields.push({ fieldName: "meta_ads_total_count", value: String(result.totalCount), sourceName: "apify_metaads" });
    if (result.runningSince) {
      fields.push({ fieldName: "meta_ads_since", value: result.runningSince, sourceName: "apify_metaads" });
    }
    if (result.platforms.length > 0) {
      fields.push({ fieldName: "meta_ads_platforms", value: result.platforms.join(", "), sourceName: "apify_metaads" });
    }
    if (result.sampleAdTexts.length > 0) {
      fields.push({
        fieldName: "meta_ads_sample",
        value: result.sampleAdTexts.join(" ⏐ ").slice(0, 900),
        sourceName: "apify_metaads",
      });
    }
  }

  try {
    await upsertFieldMetadata(db, businessId, fields);

    /**
     * **The findings, which are the part the score can actually read.**
     *
     * Until this line existed, the most expensive lookup in the product — about 11.6¢ a business
     * with Apify — wrote eight fields onto the record, re-scored, and could not move the number by
     * construction: scoring reads `findings`, and nothing wrote one from this purchase. D5 ("not
     * currently advertising", a problem worth 15) and N2 ("currently running Meta ads", 25 points
     * of intent) both had no producer at all.
     *
     * A failed lookup lands too, as an unmeasured finding carrying the reason. Silence and "we
     * looked and they run no ads" must never look the same on the record.
     */
    await upsertFindings(
      db,
      businessId,
      runMetaAdsChecks({
        pageFound: found,
        runningAds: found ? result.runningAds : null,
        activeCount: found ? result.activeCount : null,
        runningSince: found ? result.runningSince : null,
        unavailableReason: found ? null : "Their Facebook page could not be read.",
      }),
      { sourceName: "apify_metaads" },
    );
  } catch (err) {
    throw new Error(`failed to record Meta ads for ${business.name}: ${describeDbError(err)}`);
  }

  /**
   * Re-scored, because what was just bought is part of the score.
   *
   * Only the Google-listing purchase used to do this. Buying someone's Instagram — whose follower
   * count is exactly what the demand rule reads to lift a no-website business to Priority 1 — wrote
   * the followers onto the record and left the score, the priority and the row colour where they
   * were. The operator's report was precise: the task ran and nothing changed. The data had
   * changed; nothing had read it.
   *
   * Arithmetic over stored findings, so it costs nothing. A failure here costs the refresh, never
   * the purchase, which is already paid for and already stored.
   */
  try {
    await scoreAndStore(db, businessId);
  } catch {
    // The next re-score picks it up.
  }

  return {
    businessId,
    name: business.name,
    outcome: found ? "ok" : "no_ads",
    runningAds: found ? result.runningAds : false,
    activeCount: found ? result.activeCount : 0,
    runningSince: found ? result.runningSince : null,
    costCents: cost,
    fatal: false,
  };
}
