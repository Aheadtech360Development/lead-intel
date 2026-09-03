import { runPerformanceChecks, sharedPlatformDomain, type PerformanceEvidence } from "@lead-intel/core";
import { businesses, describeDbError, identityKeys, type Database } from "@lead-intel/db";
import { isPageSpeedOk, runPageSpeed } from "@lead-intel/providers";
import { and, eq } from "drizzle-orm";
import { upsertFieldMetadata } from "./field-metadata.js";
import { upsertFindings } from "./findings.js";
import { scoreAndStore } from "./scoring.js";

export interface PageSpeedSummary {
  businessId: string;
  name: string;
  domain: string | null;
  outcome: string;
  performanceScore: number | null;
  lcpMs: number | null;
  skipped: string | null;
  elapsedMs: number;
}

/**
 * Runs PageSpeed for one business, records W6 and W7, and refreshes its score.
 *
 * Independent of the crawl on purpose. PageSpeed drives a real browser through Google's own
 * infrastructure, so it succeeds on sites our crawler cannot read at all — a single-page app, or
 * a site whose bot protection turned us away with a 403. Those are among the sites most worth
 * measuring, and tying this to a successful crawl would have excluded exactly them.
 *
 * It writes only W6 and W7, leaving every other finding untouched, then rescores from what is
 * stored. So a PageSpeed pass costs no crawling and can be re-run on its own.
 */
export async function pageSpeedBusiness(db: Database, businessId: string): Promise<PageSpeedSummary> {
  const startedAt = Date.now();

  const [business] = await db
    .select({ id: businesses.id, name: businesses.displayName, websiteStatus: businesses.websiteStatus })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) throw new Error(`business ${businessId} not found`);

  const [domainKey] = await db
    .select({ value: identityKeys.keyValue })
    .from(identityKeys)
    .where(and(eq(identityKeys.businessId, businessId), eq(identityKeys.keyType, "domain")))
    .limit(1);
  const domain = domainKey?.value ?? null;

  const base = {
    businessId,
    name: business.name,
    domain,
    performanceScore: null,
    lcpMs: null,
    elapsedMs: 0,
  };

  // Two reasons not to spend a run. Neither is a judgement withheld — W6/W7 stay unmeasured and
  // say why, which is what the operator sees.
  const skip =
    domain === null
      ? "no website to measure"
      : business.websiteStatus === "dead"
        ? "the website is dead — there is nothing to measure the speed of"
        : sharedPlatformDomain(domain)
          ? "the listed website belongs to a platform or a chain, so its speed is not this business's"
          : null;

  if (skip) {
    // Recorded, not just returned. Without a stored outcome a skipped business looks identical to
    // one never attempted, so every future pass would select it again and the operator would
    // never see why W6 and W7 are blank on its record.
    try {
      await upsertFieldMetadata(db, businessId, [
        { fieldName: "pagespeed_outcome", value: "skipped", sourceName: "pagespeed" },
        { fieldName: "pagespeed_detail", value: skip, sourceName: "pagespeed" },
      ]);
      await upsertFindings(
        db,
        businessId,
        runPerformanceChecks({ performanceScore: null, lcpMs: null, unavailableReason: `Not measured — ${skip}.` }),
        { sourceName: "pagespeed" },
      );
    } catch (err) {
      throw new Error(`failed to record PageSpeed skip for ${business.name}: ${describeDbError(err)}`);
    }
    return { ...base, outcome: "skipped", skipped: skip, elapsedMs: Date.now() - startedAt };
  }

  const result = await runPageSpeed({ url: `https://${domain}/`, strategy: "mobile" });

  const performance: PerformanceEvidence = isPageSpeedOk(result)
    ? { performanceScore: result.performanceScore, lcpMs: result.lcpMs }
    : {
        performanceScore: null,
        lcpMs: null,
        // A category tells you the kind of failure; the message tells you which one. Google's own
        // `error.message` when there is one, our own `detail` otherwise — never the bare category,
        // which is what made a live `invalid_response` uninvestigable until this line changed.
        unavailableReason: `PageSpeed could not measure this page (${result.outcome})${
          result.providerMessage ? `: ${result.providerMessage}` : result.detail ? `: ${result.detail}` : ""
        }`,
      };

  try {
    const fields = [
      { fieldName: "pagespeed_outcome", value: result.outcome, sourceName: "pagespeed" },
      { fieldName: "pagespeed_elapsed_ms", value: String(result.elapsedMs), sourceName: "pagespeed" },
    ];
    if (isPageSpeedOk(result)) {
      fields.push({ fieldName: "performance_score", value: String(result.performanceScore), sourceName: "pagespeed" });
      if (result.lcpMs !== null) {
        fields.push({ fieldName: "lcp_ms", value: String(Math.round(result.lcpMs)), sourceName: "pagespeed" });
      }
      if (result.fieldCategory) {
        fields.push({ fieldName: "crux_category", value: result.fieldCategory, sourceName: "pagespeed" });
      }
    } else {
      const diagnostic = result.providerMessage ?? result.detail;
      if (diagnostic) {
        fields.push({ fieldName: "pagespeed_detail", value: diagnostic.slice(0, 500), sourceName: "pagespeed" });
      }
    }
    await upsertFieldMetadata(db, businessId, fields);

    await upsertFindings(db, businessId, runPerformanceChecks(performance), { sourceName: "pagespeed" });
  } catch (err) {
    throw new Error(`failed to record PageSpeed for ${business.name}: ${describeDbError(err)}`);
  }

  await scoreAndStore(db, businessId);

  return {
    ...base,
    outcome: result.outcome,
    performanceScore: performance.performanceScore,
    lcpMs: performance.lcpMs,
    skipped: null,
    elapsedMs: Date.now() - startedAt,
  };
}
