/**
 * Runs PageSpeed (spec §5.1 W6, W7) over the same `pageSpeedBusiness` the Trigger.dev task calls.
 * Only the queueing differs.
 *
 *   node apps/jobs/run-pagespeed.mjs
 *   node apps/jobs/run-pagespeed.mjs --limit 5
 *   node apps/jobs/run-pagespeed.mjs --all      # re-measure everything
 *   node apps/jobs/run-pagespeed.mjs --retry    # only what has no clean measurement yet
 *
 * `--retry` is the one to reach for after fixing something: it picks up both the businesses that
 * failed and the ones never attempted, without spending 130 runs re-measuring what already worked.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Loaded in-process, never via `source .env` — DATABASE_URL carries the database password.
for (const line of readFileSync(join(dirname(fileURLToPath(import.meta.url)), ".env"), "utf8").split("\n")) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (m?.[1] && !process.env[m[1]]) process.env[m[1]] = (m[2] ?? "").replace(/^["']|["']$/g, "");
}

const { createDbClient, businesses, fieldMetadata } = await import("@lead-intel/db");
const { and, eq, notExists, sql } = await import("drizzle-orm");
const { pageSpeedBusiness } = await import("./dist/pagespeed.js");

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 5000;
const remeasureAll = args.includes("--all");
const retryFailed = args.includes("--retry");

/** Matches the task queue, so a local run behaves like the production one. */
const CONCURRENCY = 5;

const db = createDbClient();

const notMeasured = notExists(
  db
    .select({ one: sql`1` })
    .from(fieldMetadata)
    .where(and(eq(fieldMetadata.businessId, businesses.id), eq(fieldMetadata.fieldName, "pagespeed_outcome"))),
);

/** No stored outcome at all, or one that is not a clean measurement. */
const noCleanMeasurement = notExists(
  db
    .select({ one: sql`1` })
    .from(fieldMetadata)
    .where(
      and(
        eq(fieldMetadata.businessId, businesses.id),
        eq(fieldMetadata.fieldName, "pagespeed_outcome"),
        sql`${fieldMetadata.value} in ('ok', 'skipped')`,
      ),
    ),
);

const conditions = [eq(businesses.status, "active")];
if (retryFailed) conditions.push(noCleanMeasurement);
else if (!remeasureAll) conditions.push(notMeasured);

const rows = await db.select({ id: businesses.id }).from(businesses).where(and(...conditions)).limit(limit);

console.log(`measuring ${rows.length} businesses at concurrency ${CONCURRENCY}\n`);

const startedAt = Date.now();
const outcomes = new Map();
let done = 0;
let failed = 0;
const queue = [...rows];

async function worker() {
  for (;;) {
    const row = queue.shift();
    if (!row) return;
    try {
      const s = await pageSpeedBusiness(db, row.id);
      done += 1;
      outcomes.set(s.outcome, (outcomes.get(s.outcome) ?? 0) + 1);
      const score = s.performanceScore === null ? "  —" : String(s.performanceScore).padStart(3);
      const lcp = s.lcpMs === null ? "     —" : `${(s.lcpMs / 1000).toFixed(1)}s`.padStart(6);
      console.log(
        `[${done}/${rows.length}] score ${score}  lcp ${lcp}  ${s.outcome.padEnd(16)} ${(s.domain ?? "no domain").padEnd(34)} ${s.name.slice(0, 38)}${s.skipped ? `  (${s.skipped})` : ""}`,
      );
    } catch (err) {
      failed += 1;
      console.error(`[fail] ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\noutcomes:`, Object.fromEntries([...outcomes].sort((a, b) => b[1] - a[1])));
console.log(`done: ${done} measured, ${failed} failed, ${Math.round((Date.now() - startedAt) / 1000)}s total`);
process.exit(0);
