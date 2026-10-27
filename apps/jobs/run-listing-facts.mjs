/**
 * Scores the Google facts this product already had, then re-scores everybody.
 *
 *   node apps/jobs/run-listing-facts.mjs --dry    # count what would change, write nothing
 *   node apps/jobs/run-listing-facts.mjs
 *
 * Free and re-runnable. It reads `field_metadata` — the rating and review count that came back
 * with the Maps search that found each business — turns them into findings, and runs the same
 * arithmetic the worker runs. No website is crawled and no provider is called.
 *
 * It exists because those two facts were stored for 414 businesses and scored for 79: R1 ("very
 * few reviews", 35 points) and R2 ("weak rating", 30 points) were only ever produced behind the
 * paid Place Details purchase. See apps/jobs/src/listing-facts.ts for the whole story.
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
const { and, eq, inArray, sql } = await import("drizzle-orm");
const { applyStoredListingFacts } = await import("./dist/listing-facts.js");
const { scoreManyAndStore } = await import("./dist/scoring.js");

const dry = process.argv.includes("--dry");
const db = createDbClient();

const before = await db
  .select({
    id: businesses.id,
    name: businesses.displayName,
    tier: businesses.tier,
    problem: businesses.problemScore,
    intent: businesses.intentScore,
    route: businesses.route,
    gate: businesses.passedGate,
  })
  .from(businesses)
  .where(eq(businesses.status, "active"));

console.log(`${before.length} active businesses.`);

// Everyone Google ever told us a rating about — the scope of the listing pass.
const withRating = await db
  .select({ id: businesses.id })
  .from(businesses)
  .where(
    and(
      eq(businesses.status, "active"),
      sql`exists (select 1 from ${fieldMetadata} fm where fm.business_id = ${businesses.id} and fm.field_name = 'rating')`,
    ),
  );

console.log(`${withRating.length} of them have a Google rating stored.`);

if (dry) {
  console.log("\n--dry: nothing written. Run it without --dry to apply.");
  process.exit(0);
}

const facts = await applyStoredListingFacts(
  db,
  withRating.map((r) => r.id),
);
console.log(`\nlisting facts: answered ${facts.answered}, skipped ${facts.skippedBought} (full listing already bought), ${facts.nothingStored} had nothing stored.`);

const ids = before.map((b) => b.id);
let last = 0;
const { scored } = await scoreManyAndStore(db, ids, {
  onProgress: (done) => {
    if (done - last >= 200 || done === ids.length) {
      last = done;
      console.log(`  scored ${done} of ${ids.length}`);
    }
  },
});
console.log(`re-scored ${scored.length}.`);

const after = await db
  .select({
    id: businesses.id,
    name: businesses.displayName,
    tier: businesses.tier,
    problem: businesses.problemScore,
    intent: businesses.intentScore,
    route: businesses.route,
    gate: businesses.passedGate,
  })
  .from(businesses)
  .where(eq(businesses.status, "active"));

const was = new Map(before.map((b) => [b.id, b]));
const moved = [];
let tierChanged = 0;
let gateChanged = 0;
let nowScored = 0;

for (const row of after) {
  const old = was.get(row.id);
  if (!old) continue;
  const problemMoved = Number(old.problem ?? -1) !== Number(row.problem ?? -1);
  if (old.tier !== row.tier) tierChanged += 1;
  if (old.gate !== row.gate) gateChanged += 1;
  if (old.problem === null && row.problem !== null) nowScored += 1;
  if (problemMoved || old.tier !== row.tier) {
    moved.push({ name: row.name, was: old.problem, now: row.problem, wasTier: old.tier, nowTier: row.tier });
  }
}

console.log(`\n${moved.length} businesses changed score, ${tierChanged} changed priority, ${gateChanged} changed gate, ${nowScored} became scorable for the first time.`);
for (const m of moved.slice(0, 25)) {
  console.log(`  ${m.name}: problem ${m.was ?? "—"} → ${m.now ?? "—"}, priority ${m.wasTier ?? "—"} → ${m.nowTier ?? "—"}`);
}
if (moved.length > 25) console.log(`  … and ${moved.length - 25} more`);

const tiers = new Map();
for (const row of after) {
  const key = row.tier === null ? "not scored" : `priority ${row.tier}`;
  tiers.set(key, (tiers.get(key) ?? 0) + 1);
}
console.log("\nwhere everyone is now:");
for (const [k, v] of [...tiers.entries()].sort()) console.log(`  ${String(v).padStart(4)}  ${k}`);

process.exit(0);
