/**
 * Looks up YouTube channels for businesses that have not been checked, recording O8.
 *
 *   node apps/jobs/run-youtube.mjs                 # everything not yet looked up
 *   node apps/jobs/run-youtube.mjs --limit 90
 *   node apps/jobs/run-youtube.mjs --recheck       # look again, including businesses already done
 *
 * **This one is quota-bound, not politeness-bound.** YouTube gives 10,000 units a day; finding a
 * channel by name costs 100 of them, so a day covers roughly 100 businesses however fast this
 * runs. Concurrency is deliberately low — going faster does not buy more lookups, it only reaches
 * the ceiling sooner and makes the stop less tidy.
 *
 * When the quota runs out the pass **stops** rather than continuing. Every other failure is a fact
 * about one business; this one is a fact about the day, and carrying on would write "we looked and
 * found nothing" against businesses nobody looked at. Re-run tomorrow and it resumes where it
 * stopped, because those businesses still have no stored outcome.
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
const { and, eq, notExists, sql } = await import("drizzle-orm");
const { youTubeBusiness } = await import("./dist/youtube.js");

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 5000;
const recheck = args.includes("--recheck");
const CONCURRENCY = 2;

const db = createDbClient();

const notLookedUp = notExists(
  db
    .select({ one: sql`1` })
    .from(fieldMetadata)
    .where(and(eq(fieldMetadata.businessId, businesses.id), eq(fieldMetadata.fieldName, "youtube_outcome"))),
);

const conditions = [eq(businesses.status, "active")];
if (!recheck) conditions.push(notLookedUp);

const rows = await db.select({ id: businesses.id }).from(businesses).where(and(...conditions)).limit(limit);

console.log(`looking up ${rows.length} businesses (about 100 fit in one day's free quota)\n`);

const startedAt = Date.now();
const outcomes = new Map();
let done = 0;
let failed = 0;
let stopped = false;
const queue = [...rows];

async function worker() {
  for (;;) {
    if (stopped) return;
    const row = queue.shift();
    if (!row) return;
    try {
      const s = await youTubeBusiness(db, row.id);
      if (s.quotaExhausted) {
        stopped = true;
        console.log(`\n*** daily quota reached after ${done} lookups — stopping. Re-run tomorrow to continue. ***`);
        return;
      }
      done += 1;
      outcomes.set(s.outcome, (outcomes.get(s.outcome) ?? 0) + 1);
      const posted = s.latestVideoAt ? s.latestVideoAt.slice(0, 10) : "never posted";
      console.log(
        `[${done}/${rows.length}] ${s.outcome.padEnd(16)} ${(s.channelTitle ?? "-").slice(0, 34).padEnd(34)} ${posted.padEnd(12)} ${s.name.slice(0, 34)}`,
      );
    } catch (err) {
      failed += 1;
      console.error(`[fail] ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\noutcomes:`, Object.fromEntries([...outcomes].sort((a, b) => b[1] - a[1])));
console.log(`done: ${done} looked up, ${failed} failed, ${Math.round((Date.now() - startedAt) / 1000)}s total`);
if (stopped) console.log(`${queue.length + 1} businesses still waiting — run again tomorrow.`);
process.exit(0);
