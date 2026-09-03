/**
 * Buys Instagram profiles for businesses whose website linked one.
 *
 *   node apps/jobs/run-instagram.mjs                    # everything linked and not yet looked up
 *   node apps/jobs/run-instagram.mjs --limit 20         # try a few first
 *   node apps/jobs/run-instagram.mjs --cap 25           # never spend more than 25 cents
 *
 * **This one spends money**, which is why it differs from the other runners in three ways.
 *
 * 1. It only ever considers businesses that already have an `instagram_url` — the operator's
 *    instruction, and also the only sane rule: the lookup takes a handle, so a business whose site
 *    never mentioned Instagram has nothing to look up at any price.
 * 2. It works in small chunks and carries the remaining budget into each one, so the ceiling holds
 *    across the whole pass rather than per chunk.
 * 3. It stops if the first chunk buys nothing and fails everything. A bad token or an empty Apify
 *    balance fails identically 167 times otherwise — slow, noisy, and a good way to get an account
 *    rate-limited for the trouble.
 *
 * The ledger is still the authority on what has been paid for: `runEnrichmentSource` writes
 * `provider_calls` before each call and refuses anything already bought, so re-running this after
 * an interruption costs nothing for what it already has.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

for (const line of readFileSync(join(dirname(fileURLToPath(import.meta.url)), ".env"), "utf8").split("\n")) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match?.[1] && !process.env[match[1]]) {
    process.env[match[1]] = (match[2] ?? "").replace(/^["']|["']$/g, "");
  }
}

const { createDbClient, businesses, fieldMetadata } = await import("@lead-intel/db");
const { and, eq, exists, notExists, sql } = await import("drizzle-orm");
const { runEnrichmentSource } = await import("./dist/enrich.js");

const args = process.argv.slice(2);
const numberArg = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const limit = numberArg("--limit", 5000);
// Cents. 167 profiles at 0.26¢ is about 43¢; 60 leaves room without leaving room for a surprise.
const capCents = numberArg("--cap", 60);
const CHUNK = 10;

const db = createDbClient();

const hasInstagram = exists(
  db
    .select({ one: sql`1` })
    .from(fieldMetadata)
    .where(and(eq(fieldMetadata.businessId, businesses.id), eq(fieldMetadata.fieldName, "instagram_url"))),
);
const notLookedUp = notExists(
  db
    .select({ one: sql`1` })
    .from(fieldMetadata)
    .where(and(eq(fieldMetadata.businessId, businesses.id), eq(fieldMetadata.fieldName, "instagram_followers"))),
);

const rows = await db
  .select({ id: businesses.id, name: businesses.displayName })
  .from(businesses)
  .where(and(eq(businesses.status, "active"), hasInstagram, notLookedUp))
  .limit(limit);

console.log(`${rows.length} businesses have an Instagram link and have never been looked up.`);
console.log(`At 0.26c each that is about $${((rows.length * 0.26) / 100).toFixed(2)}.`);
console.log(`Hard ceiling for this run: $${(capCents / 100).toFixed(2)}. Nothing already bought is bought again.\n`);

const startedAt = Date.now();
const totals = { bought: 0, alreadyBought: 0, ineligible: 0, failed: 0, spentCents: 0 };
const errors = [];
let stopped = null;

for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const remaining = capCents - totals.spentCents;
  if (remaining < 0.26) {
    stopped = "cap";
    break;
  }

  const result = await runEnrichmentSource(db, {
    source: "instagram_profile",
    businessIds: chunk.map((r) => r.id),
    capCents: remaining,
  });

  totals.bought += result.bought;
  totals.alreadyBought += result.skippedAlreadyBought;
  totals.ineligible += result.skippedIneligible;
  totals.failed += result.failed;
  totals.spentCents += result.spentCents;
  errors.push(...result.errors);

  const done = Math.min(i + CHUNK, rows.length);
  console.log(
    `[${String(done).padStart(4)}/${rows.length}] bought ${String(totals.bought).padStart(4)}  ` +
      `failed ${String(totals.failed).padStart(3)}  spent $${(totals.spentCents / 100).toFixed(4)}`,
  );

  // The guard. If the very first chunk bought nothing and failed everything, the problem is the
  // account or the token, not these ten businesses — and it will be the problem for all 167.
  if (i === 0 && result.bought === 0 && result.failed === chunk.length) {
    stopped = "all_failed";
    break;
  }
  if (result.stoppedAtCap) {
    stopped = "cap";
    break;
  }
}

console.log(`\n--- done in ${Math.round((Date.now() - startedAt) / 1000)}s ---`);
console.log(`bought:            ${totals.bought}`);
console.log(`already had:       ${totals.alreadyBought}`);
console.log(`nothing to look up:${totals.ineligible}`);
console.log(`failed:            ${totals.failed}`);
console.log(`spent:             $${(totals.spentCents / 100).toFixed(4)}`);

if (stopped === "cap") console.log(`\nStopped at the spending ceiling. Re-run with a higher --cap to continue.`);
if (stopped === "all_failed") {
  console.log(`\nStopped: the first ${CHUNK} all failed, so this is the token or the Apify balance,`);
  console.log(`not these businesses. Nothing further was attempted.`);
}
if (errors.length > 0) {
  console.log(`\nfirst few errors:`);
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
}
process.exit(0);
