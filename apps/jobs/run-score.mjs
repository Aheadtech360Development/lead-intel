/**
 * Rescores every analysed business from the findings already stored — no crawling, no cost.
 * Same `scoreAndStore` the Trigger.dev `score-run` task calls.
 *
 *   node apps/jobs/run-score.mjs
 *
 * Use it after changing a weight, the coverage floor, or the gate cut-off (§10.3's "lever") to
 * see what actually moves, without re-fetching a single page.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Loaded in-process, never via `source .env` — DATABASE_URL carries the database password and a
// shell that cannot parse a line echoes it into the terminal.
for (const line of readFileSync(join(dirname(fileURLToPath(import.meta.url)), ".env"), "utf8").split("\n")) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match?.[1] && !process.env[match[1]]) {
    process.env[match[1]] = (match[2] ?? "").replace(/^["']|["']$/g, "");
  }
}

const { createDbClient, businesses, findings } = await import("@lead-intel/db");
const { and, eq, exists, sql } = await import("drizzle-orm");
const { scoreAndStore } = await import("./dist/scoring.js");

const db = createDbClient();

const analysed = exists(
  db.select({ one: sql`1` }).from(findings).where(eq(findings.businessId, businesses.id)),
);

const rows = await db
  .select({ id: businesses.id, name: businesses.displayName })
  .from(businesses)
  .where(and(eq(businesses.status, "active"), analysed));

console.log(`rescoring ${rows.length} businesses\n`);

const tiers = new Map();
let unscorable = 0;
let passedGate = 0;

for (const row of rows) {
  const s = await scoreAndStore(db, row.id);
  if (s.problemScore === null) unscorable += 1;
  if (s.passedGate) passedGate += 1;
  const key = s.tier === null ? "unscorable" : `tier ${s.tier}`;
  tiers.set(key, (tiers.get(key) ?? 0) + 1);
}

console.log("tiers:", Object.fromEntries([...tiers].sort()));
console.log(`unscorable: ${unscorable}   passed the gate: ${passedGate} / ${rows.length}`);
process.exit(0);
