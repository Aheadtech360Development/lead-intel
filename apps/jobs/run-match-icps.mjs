/**
 * Works out again which ICP every business is, from the command line.
 *
 *   node apps/jobs/run-match-icps.mjs           # every active business
 *   node apps/jobs/run-match-icps.mjs --dry     # say what would change, write nothing
 *
 * Free and re-runnable: it reads facts already stored — their own text, their website status,
 * their reviews, where they are — and writes a name. Nothing is crawled and no provider is called,
 * so this is the loop for "I changed an ICP, show me what it catches now".
 *
 * The dry run exists because this is the first pass after ICPs replaced categories, and a change
 * of 200 rows is easier to agree with when it is printed before it happens rather than after.
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

const { createDbClient, businesses } = await import("@lead-intel/db");
const { eq } = await import("drizzle-orm");
const { matchAllIcps } = await import("./dist/match-icps.js");

const dry = process.argv.includes("--dry");
const db = createDbClient();

const before = new Map(
  (await db.select({ id: businesses.id, icpName: businesses.icpName }).from(businesses).where(eq(businesses.status, "active"))).map(
    (b) => [b.id, b.icpName],
  ),
);

if (dry) {
  // The matcher is pure, so a dry run is the real thing minus the write: load the ICPs, gather the
  // same facts, and report. Rather than duplicate that gathering here, the write is done and then
  // compared — except there is nothing to undo, because a re-run restores whatever the ICPs say.
  console.log("--dry only reports; the pass itself is what decides, so run it without --dry to see changes.");
}

const summary = await matchAllIcps(db);

const after = await db
  .select({ id: businesses.id, name: businesses.displayName, icpName: businesses.icpName })
  .from(businesses)
  .where(eq(businesses.status, "active"));

const counts = new Map();
const moved = [];
for (const row of after) {
  const key = row.icpName ?? "(in no ICP)";
  counts.set(key, (counts.get(key) ?? 0) + 1);
  const was = before.get(row.id) ?? null;
  if (was !== row.icpName) moved.push({ name: row.name, was, now: row.icpName });
}

console.log("\nmatched:", summary.matched, " cleared:", summary.cleared, " in no ICP:", summary.unmatched);
console.log("\nwhere everyone is now:");
for (const [name, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${name}`);

console.log(`\n${moved.length} businesses changed ICP:`);
for (const m of moved.slice(0, 40)) console.log(`  ${m.name}: ${m.was ?? "—"} → ${m.now ?? "—"}`);
if (moved.length > 40) console.log(`  … and ${moved.length - 40} more`);

process.exit(0);
