/**
 * Buys Google listing details for businesses past the Stage 5 gate and records §5.3's S1/S3/S5/S6
 * and §5.4's R1/R2.
 *
 * **This one spends money.** It prints a costed plan and refuses to proceed without `--confirm`,
 * because §9's whole design is that the paid lookups are rationed and deliberate:
 *
 *   node apps/jobs/run-listing.mjs                 # show the plan and the cost, buy nothing
 *   node apps/jobs/run-listing.mjs --confirm       # actually buy
 *   node apps/jobs/run-listing.mjs --limit 5 --confirm
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
const { PLACES_DETAILS_COST_CENTS } = await import("@lead-intel/shared");
const { listingBusiness } = await import("./dist/listing.js");

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 5000;
const confirmed = args.includes("--confirm");

const CONCURRENCY = 4;
const db = createDbClient();

const notLookedUp = notExists(
  db
    .select({ one: sql`1` })
    .from(fieldMetadata)
    .where(and(eq(fieldMetadata.businessId, businesses.id), eq(fieldMetadata.fieldName, "listing_outcome"))),
);

// The gate, applied in the selection as well as inside listingBusiness. Two independent places,
// because this is the query that decides how much money a run costs.
const rows = await db
  .select({ id: businesses.id, name: businesses.displayName })
  .from(businesses)
  .where(and(eq(businesses.status, "active"), eq(businesses.passedGate, true), notLookedUp))
  .limit(limit);

const estimateCents = rows.length * PLACES_DETAILS_COST_CENTS;
console.log(`${rows.length} businesses past the Stage 5 gate and not yet looked up.`);
console.log(`Estimated cost: ${(estimateCents / 100).toFixed(2)} USD at ${PLACES_DETAILS_COST_CENTS}c per lookup.\n`);

if (!confirmed) {
  console.log("Nothing was bought. Re-run with --confirm to proceed.");
  process.exit(0);
}

const startedAt = Date.now();
const outcomes = new Map();
let spentCents = 0;
let done = 0;
let failed = 0;
const queue = [...rows];

async function worker() {
  for (;;) {
    const row = queue.shift();
    if (!row) return;
    try {
      const s = await listingBusiness(db, row.id);
      done += 1;
      spentCents += s.costCents;
      outcomes.set(s.outcome, (outcomes.get(s.outcome) ?? 0) + 1);
      const rating = s.rating === null ? "  — " : s.rating.toFixed(1);
      const reviews = s.reviewCount === null ? "    —" : String(s.reviewCount).padStart(5);
      console.log(
        `[${done}/${rows.length}] ${rating}★ ${reviews} reviews  ${s.outcome.padEnd(14)} ${s.name.slice(0, 44)}${s.skipped ? `  (${s.skipped.slice(0, 50)})` : ""}`,
      );
    } catch (err) {
      failed += 1;
      console.error(`[fail] ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\noutcomes:`, Object.fromEntries([...outcomes].sort((a, b) => b[1] - a[1])));
console.log(
  `done: ${done} looked up, ${failed} failed, ${(spentCents / 100).toFixed(2)} USD spent, ${Math.round((Date.now() - startedAt) / 1000)}s`,
);
process.exit(0);
