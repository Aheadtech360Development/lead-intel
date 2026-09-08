import {
  buildInitialGrid,
  discoveryCallIdempotencyKey,
  MAX_SUBDIVISION_DEPTH,
  resolveBusinessForRawResult,
  subdivideCell,
  type DiscoveredFieldUpdate,
  type GridCell,
} from "@lead-intel/core";
import {
  businesses,
  createDbClient,
  describeDbError,
  exclusions,
  identityKeys,
  providerCalls,
  runGridCells,
  runs,
  type Database,
} from "@lead-intel/db";
import { resolveSearchCenter, searchNicheAtPoint, type DiscoveredPlaceResult } from "@lead-intel/providers";
import { PLACES_CENTER_LOOKUP_COST_CENTS, PLACES_TEXT_SEARCH_COST_CENTS } from "@lead-intel/shared";
import { logger, task } from "@trigger.dev/sdk";
import { getGooglePlacesApiKey } from "@lead-intel/providers";
import { jobProgress } from "../src/job-progress.js";
import { and, eq, sql } from "drizzle-orm";
import { createDiscoveryRepo } from "../src/repo.js";
import { analyseRunTask } from "./analyse-run.js";

type RunRow = typeof runs.$inferSelect;
type RunGridCellRow = typeof runGridCells.$inferSelect;

/**
 * Discovery — Phase 3 pipeline stages 0 (Plan, already done by the search UI before this task is
 * triggered) through 3 (Classify presence, narrowed per the Phase 3 plan's scope decision: this
 * records the raw Places website-field signal only, never a full website_status classification —
 * that needs Phase 4's crawler).
 *
 * Resumability is at CELL granularity only, not page-within-a-cell: a crashed run's "pending"
 * cells are picked up again on retrigger without re-paying for cells already "done"/"saturated",
 * but a cell that crashed mid-pagination re-fetches its earlier pages too (their raw responses
 * aren't cached — see pre-build-risks-and-api-limits.md's "never store raw HTML" rule; Places
 * JSON responses are small enough that caching them would be reasonable, but wasn't built this
 * pass — a documented limitation, not a silent one).
 */
export const discoveryTask = task({
  id: "discovery",
  maxDuration: 1800,
  run: async (payload: { runId: string; jobRunId?: string | null }) => {
    const db = createDbClient();
    const repo = createDiscoveryRepo(db);
    const progress = jobProgress(db, payload.jobRunId);

    const [run] = await db.select().from(runs).where(eq(runs.id, payload.runId)).limit(1);
    if (!run) throw new Error(`run ${payload.runId} not found`);
    if (!run.niche || !run.location || !run.radiusMiles) {
      throw new Error(`run ${payload.runId} is missing niche/location/radiusMiles — the search UI should never enqueue an incomplete run`);
    }

    await db.update(runs).set({ status: "running", startedAt: new Date() }).where(eq(runs.id, run.id));

    /**
     * The key is checked before any work starts, not when the first search needs it.
     *
     * Without this the run marks itself "running", seeds a grid, and only then throws
     * `GOOGLE_PLACES_API_KEY is not set` from somewhere three layers down — which is what a live
     * production run actually did. The operator's report was "Trigger.dev ki kisi API key ko
     * missing bata raha tha", and the message was accurate but arrived attached to a run that
     * looked half-done and named no place to put the key.
     *
     * The environment variables belong to the **worker**, not to the website: Trigger.dev
     * dashboard, Environment Variables, with the environment set to Production.
     */
    try {
      getGooglePlacesApiKey();
    } catch {
      const why =
        "This search cannot run: the worker has no GOOGLE_PLACES_API_KEY, so it cannot ask Google " +
        "Maps for anything. Set it in the Trigger.dev dashboard under Environment Variables, with " +
        "the environment set to Production. Nothing was searched and nothing was spent.";
      await db
        .update(runs)
        .set({ status: "failed", finishedAt: new Date(), errors: { config: why } })
        .where(eq(runs.id, run.id));
      await progress.finish({ ok: false, detail: why });
      logger.error("discovery not run", { why });
      return;
    }

    // The total is genuinely unknown here: the grid splits itself wherever Google comes back
    // full, so how many searches this will take is decided while it runs. The banner draws a
    // moving stripe rather than inventing a denominator.
    await progress.say(`Searching around ${run.location}`);

    // Anything that escapes the pipeline below marks the run "failed" with the reason before it
    // propagates to Trigger.dev. Without this the row keeps saying "running" forever after a
    // crash — which is exactly what the first live run did: the task died on a duplicate domain,
    // and the status page went on showing an in-progress run with no way to tell it from a slow
    // one. A step that died must never look like a step still working.
    try {
      await runPipeline(db, repo, run);

      const [finished] = await db.select().from(runs).where(eq(runs.id, run.id)).limit(1);
      const counters = (finished?.counters ?? {}) as Record<string, number>;
      const spend = (finished?.spend ?? {}) as Record<string, number>;
      await progress.finish({
        ok: true,
        detail:
          `Found ${counters.businessesFound ?? 0} businesses across ${counters.cellsDone ?? 0} searches. ` +
          `Cost ${((spend.totalCents ?? 0) / 100).toFixed(2)} dollars with Google Places.`,
      });
    } catch (err) {
      await db
        .update(runs)
        .set({
          status: "failed",
          finishedAt: new Date(),
          // describeDbError, not err.message: Drizzle's wrapper message names the failing query
          // but never the reason. See packages/db/src/errors.ts.
          errors: sql`coalesce(${runs.errors}, '{}'::jsonb) || ${JSON.stringify({
            crash: describeDbError(err),
          })}::jsonb`,
        })
        .where(eq(runs.id, run.id));
      await refreshRunAggregates(db, run.id);
      await progress.finish({ ok: false, detail: `The search stopped: ${describeDbError(err)}` });
      throw err; // still surfaces in Trigger.dev's own run history for the full stack trace
    }
  },
});

async function runPipeline(
  db: Database,
  repo: ReturnType<typeof createDiscoveryRepo>,
  run: RunRow,
): Promise<void> {
  {
    const isFreshRun = await hasNoGridCellsYet(db, run.id);
    if (isFreshRun) {
      const seeded = await seedInitialGrid(db, run);
      if (!seeded) return; // centre lookup failed — run already marked "failed", nothing more to do
    }

    while (true) {
      const [cell] = await db
        .select()
        .from(runGridCells)
        .where(and(eq(runGridCells.runId, run.id), eq(runGridCells.status, "pending")))
        .orderBy(runGridCells.depth, runGridCells.createdAt)
        .limit(1);
      if (!cell) break; // queue empty — every cell is done, saturated (at max depth), or failed

      const ceilingHit = await ceilingReached(db, run);
      if (ceilingHit) break; // spec §10.3: stop cleanly, keep everything already done

      await processCell(db, repo, run, cell);
      await refreshRunAggregates(db, run.id);
    }

    const [stillPending, done, saturated, failedCells] = await Promise.all([
      countCells(db, run.id, "pending"),
      countCells(db, run.id, "done"),
      countCells(db, run.id, "saturated"),
      countCells(db, run.id, "failed"),
    ]);
    const searchedAnything = done + saturated + failedCells > 0;

    // A run that searched nothing at all is not "complete" — it did not do the thing it exists to
    // do. The first live run reported exactly that (0 cells, 0 calls, "complete") because a
    // bigint-as-string comparison stopped the grid from ever being seeded; the count bug is fixed
    // above, and this guard makes the same class of silent no-op impossible to report as success.
    const status = !searchedAnything ? "failed" : stillPending > 0 ? "partial" : "complete";

    await db
      .update(runs)
      .set({
        status,
        finishedAt: new Date(),
        ...(searchedAnything
          ? {}
          : {
              errors: {
                pipeline:
                  "No grid cells were searched. The run ended without making a single provider call — treat this as a failure, not an empty result set.",
              },
            }),
      })
      .where(eq(runs.id, run.id));

    // Finding businesses and never looking at them is not a finished job. Until now discovery
    // stopped here and the crawl had to be started by hand from a terminal — the same gap the CSV
    // importer had: records arrive, sit unread, and display "Not scored" as though that were a
    // finding about them rather than an admission that nobody looked.
    //
    // Not fatal. The run itself succeeded, and the leads list carries an "Analyse them now"
    // button for the case where this could not be queued.
    if (searchedAnything) {
      try {
        // `categoriseAll` so a search behaves like an import. An import sorts its rows because its
        // plan says to; a search had no equivalent, so businesses found by search arrived analysed
        // and uncategorised while imported ones arrived analysed and labelled. Two ways in, two
        // different results, for no reason the operator could see.
        await analyseRunTask.trigger({ businessIds: [], categoriseAll: true });
      } catch (err) {
        logger.warn("could not start the analysis; the leads list will offer it", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await refreshRunAggregates(db, run.id);
  }
}

/**
 * Postgres `count()` and `sum()` return bigint/numeric, which the `postgres` driver hands back as
 * a STRING — never a JS number, because bigint does not fit safely in one. Annotating the column
 * as `sql<number>` does not change the runtime value; it only tells TypeScript something untrue,
 * which is exactly how `(row?.count ?? 0) === 0` silently compared "0" to 0, got false, and made
 * the first live run seed no grid at all and then report itself "complete". Every aggregate read
 * in this file goes through here.
 */
function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function hasNoGridCellsYet(db: Database, runId: string): Promise<boolean> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(runGridCells)
    .where(eq(runGridCells.runId, runId));
  return toCount(row?.count) === 0;
}

/** Resolves the run's location to a centre and inserts the initial grid as "pending" cells.
 *  Returns false (run marked "failed") if the location didn't resolve, or resolved to something
 *  the guards refused — never fabricates a centre to grid around. */
async function seedInitialGrid(db: Database, run: RunRow): Promise<boolean> {
  const centre = await resolveSearchCenter({ locationText: run.location as string });

  await db.insert(providerCalls).values({
    idempotencyKey: `${run.id}:center`,
    runId: run.id,
    provider: "google_places",
    endpoint: "searchText:center",
    status: centre.succeeded ? "succeeded" : "failed",
    errorCode: centre.errorCode ?? undefined,
    // The column is numeric(12,4) now, so the exact rate is stored rather than a rounded
    // one. Drizzle takes numeric as a string so the value does not pass through a float.
    costCents: String(PLACES_CENTER_LOOKUP_COST_CENTS),
  });

  if (!centre.succeeded || !centre.center) {
    await db
      .update(runs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errors: {
          // rejectedReason is the operator-facing one ("resolved to X in PK, not US — add a
          // state"); errorCode/providerMessage cover the case where the provider itself failed.
          // Google's own words matter here: the difference between a status page that says
          // "PROVIDER_AUTH_FAILED" and one that says "you must enable Billing" is the difference
          // between a mystery and a fix.
          location:
            centre.rejectedReason ??
            centre.errorCode ??
            "could not resolve a location for the given text",
          ...(centre.providerMessage ? { locationDetail: centre.providerMessage } : {}),
        },
      })
      .where(eq(runs.id, run.id));
    return false;
  }

  const initialCells = buildInitialGrid({ center: centre.center, radiusMiles: run.radiusMiles as number });
  await db.insert(runGridCells).values(
    initialCells.map((cell) => ({
      runId: run.id,
      parentCellId: null,
      depth: cell.depth,
      centerLat: cell.center.lat,
      centerLng: cell.center.lng,
      radiusMeters: Math.round(cell.radiusMeters),
      status: "pending" as const,
    })),
  );
  return true;
}

async function ceilingReached(db: Database, run: RunRow): Promise<boolean> {
  if (run.maxBusinesses !== null && run.maxBusinesses !== undefined) {
    const [row] = await db
      .select({ count: sql<string>`count(*)` })
      .from(businesses)
      .where(eq(businesses.discoveredInRun, run.id));
    if (toCount(row?.count) >= run.maxBusinesses) return true;
  }
  if (run.maxSpendCents !== null && run.maxSpendCents !== undefined) {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${providerCalls.costCents}), 0)` })
      .from(providerCalls)
      .where(eq(providerCalls.runId, run.id));
    if (toCount(row?.total) >= run.maxSpendCents) return true;
  }
  return false;
}

async function processCell(db: Database, repo: ReturnType<typeof createDiscoveryRepo>, run: RunRow, cellRow: RunGridCellRow) {
  let page = 0;
  let pageToken: string | undefined;
  let totalResults = 0;
  let anyFailure = false;

  while (true) {
    const result = await searchNicheAtPoint({
      niche: run.niche as string,
      center: { lat: cellRow.centerLat, lng: cellRow.centerLng },
      radiusMeters: cellRow.radiusMeters,
      ...(pageToken ? { pageToken } : {}),
    });

    await db
      .insert(providerCalls)
      .values({
        idempotencyKey: discoveryCallIdempotencyKey({ runId: run.id, cellId: cellRow.id, page }),
        runId: run.id,
        provider: "google_places",
        endpoint: "searchText",
        status: result.succeeded ? "succeeded" : "failed",
        errorCode: result.errorCode ?? undefined,
        costCents: String(PLACES_TEXT_SEARCH_COST_CENTS),
      })
      .onConflictDoNothing();

    if (!result.succeeded) {
      anyFailure = true;
      // Same reasoning as the geocoding failure above: record Google's own explanation, not just
      // our error code, so the operator can see what to fix without re-running anything.
      await db
        .update(runs)
        .set({
          errors: sql`coalesce(${runs.errors}, '{}'::jsonb) || ${JSON.stringify({
            [`cell_${cellRow.id}`]: result.providerMessage ?? result.errorCode ?? "search failed",
          })}::jsonb`,
        })
        .where(eq(runs.id, run.id));
      break;
    }

    for (const place of result.places) {
      const outcome = await resolveBusinessForRawResult({
        business: place.business,
        fields: placeToFieldUpdates(place),
        repo,
      });
      if (outcome.action === "created") {
        await db
          .update(businesses)
          .set({ discoveredInRun: run.id })
          .where(and(eq(businesses.id, outcome.businessId), sql`${businesses.discoveredInRun} is null`));
      }
      if (outcome.action === "created" || outcome.action === "attached") {
        await applyExclusionMatch(db, outcome.businessId);
      }
    }

    totalResults += result.returnedCount;
    page += 1;

    if (!result.nextPageToken || page >= 3) break; // 3 pages of 20 = the platform's 60-result cap
    pageToken = result.nextPageToken;
  }

  const saturated = totalResults >= 60;
  const status = anyFailure ? "failed" : saturated ? "saturated" : "done";

  await db
    .update(runGridCells)
    .set({ status, resultCount: totalResults, searchedAt: new Date() })
    .where(eq(runGridCells.id, cellRow.id));

  if (saturated && cellRow.depth < MAX_SUBDIVISION_DEPTH) {
    const asGridCell: GridCell = {
      id: cellRow.id,
      parentId: cellRow.parentCellId,
      depth: cellRow.depth,
      center: { lat: cellRow.centerLat, lng: cellRow.centerLng },
      radiusMeters: cellRow.radiusMeters,
    };
    const children = subdivideCell(asGridCell);
    if (children.length > 0) {
      await db.insert(runGridCells).values(
        children.map((child) => ({
          runId: run.id,
          parentCellId: cellRow.id,
          depth: child.depth,
          centerLat: child.center.lat,
          centerLng: child.center.lng,
          radiusMeters: Math.round(child.radiusMeters),
          status: "pending" as const,
        })),
      );
    }
  }
}

function placeToFieldUpdates(place: DiscoveredPlaceResult): DiscoveredFieldUpdate[] {
  const fields: DiscoveredFieldUpdate[] = [
    { fieldName: "has_website_field", value: String(place.hasWebsiteField), sourceName: "google_places" },
  ];
  if (place.business.domain) fields.push({ fieldName: "website_url", value: place.business.domain, sourceName: "google_places" });
  if (place.business.phone) fields.push({ fieldName: "phone", value: place.business.phone, sourceName: "google_places" });
  if (place.rating !== null) fields.push({ fieldName: "rating", value: String(place.rating), sourceName: "google_places" });
  if (place.userRatingCount !== null) {
    fields.push({ fieldName: "review_count", value: String(place.userRatingCount), sourceName: "google_places" });
  }
  if (place.businessStatus) fields.push({ fieldName: "business_status", value: place.businessStatus, sourceName: "google_places" });
  return fields;
}

/** Spec §10.3: "exclusions are matched before any paid lookup." Nothing paid happens to a
 *  business until Phase 5 (Stage 6), but flagging the match now means that gate is already
 *  closed by the time Phase 5 exists, rather than being a check someone has to remember to add. */
async function applyExclusionMatch(db: Database, businessId: string): Promise<void> {
  const keys = await db
    .select({ keyType: identityKeys.keyType, keyValue: identityKeys.keyValue })
    .from(identityKeys)
    .where(eq(identityKeys.businessId, businessId));

  for (const key of keys) {
    const [match] = await db
      .select({ id: exclusions.id })
      .from(exclusions)
      .where(and(eq(exclusions.keyType, key.keyType), eq(exclusions.keyValue, key.keyValue)))
      .limit(1);
    if (match) {
      await db.update(businesses).set({ exclusionFlag: true, status: "excluded" }).where(eq(businesses.id, businessId));
      return;
    }
  }
}

async function countCells(db: Database, runId: string, status: "pending" | "done" | "saturated" | "failed"): Promise<number> {
  const [row] = await db
    .select({ count: sql<string>`count(*)` })
    .from(runGridCells)
    .where(and(eq(runGridCells.runId, runId), eq(runGridCells.status, status)));
  return toCount(row?.count);
}

/** Recomputes runs.counters/spend from source tables — always consistent with reality (including
 *  after a resume), rather than an in-memory accumulator that could drift from a crash mid-run. */
async function refreshRunAggregates(db: Database, runId: string): Promise<void> {
  const [pending, done, saturated, failed] = await Promise.all([
    countCells(db, runId, "pending"),
    countCells(db, runId, "done"),
    countCells(db, runId, "saturated"),
    countCells(db, runId, "failed"),
  ]);
  const [businessCounts] = await db
    .select({
      total: sql<string>`count(*)`,
      excluded: sql<string>`count(*) filter (where ${businesses.exclusionFlag})`,
    })
    .from(businesses)
    .where(eq(businesses.discoveredInRun, runId));
  const [spend] = await db
    .select({ totalCents: sql<string>`coalesce(sum(${providerCalls.costCents}), 0)`, callCount: sql<string>`count(*)` })
    .from(providerCalls)
    .where(eq(providerCalls.runId, runId));

  // Coerced before storing, not just before comparing: these land in JSONB and are read straight
  // back out by the run status page, where a string "0" would render fine but arithmetic on it
  // (totals, percentages) would not.
  await db
    .update(runs)
    .set({
      counters: {
        cellsPending: pending,
        cellsDone: done,
        cellsSaturated: saturated,
        cellsFailed: failed,
        businessesFound: toCount(businessCounts?.total),
        businessesExcluded: toCount(businessCounts?.excluded),
      },
      spend: {
        totalCents: toCount(spend?.totalCents),
        providerCallCount: toCount(spend?.callCount),
      },
    })
    .where(eq(runs.id, runId));
}
