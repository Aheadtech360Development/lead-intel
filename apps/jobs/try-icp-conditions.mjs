/**
 * Asks "what would this ICP catch if I added that condition?" — and writes nothing.
 *
 *   node apps/jobs/try-icp-conditions.mjs "Screen printing"
 *
 * The three conditions are new, and each of them refuses when the fact is unknown. That rule is
 * easy to state and hard to feel, so this prints it against the operator's own list: how many
 * businesses an ICP takes now, and how many it would still take with a website, a review floor or
 * a place attached.
 *
 * Free: it reads stored facts and runs the same pure matcher the worker runs.
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
const { matchIcp } = await import("@lead-intel/core");
const { loadRules, gatherEvidence } = await import("./dist/match-icps.js");

const wanted = process.argv[2];
const db = createDbClient();

const rules = await loadRules(db);
const icp = wanted ? rules.find((r) => r.name.toLowerCase() === wanted.toLowerCase()) : rules[0];
if (!icp) {
  console.log("No such ICP. Yours are:", rules.map((r) => r.name).join(", "));
  process.exit(1);
}

const rows = await db
  .select({
    id: businesses.id,
    name: businesses.displayName,
    websiteStatus: businesses.websiteStatus,
    city: businesses.city,
    state: businesses.state,
  })
  .from(businesses)
  .where(eq(businesses.status, "active"));

const evidence = await gatherEvidence(
  db,
  rows.map((r) => r.id),
);

const factsFor = (row) => ({
  businessName: row.name,
  hasWebsite: row.websiteStatus === "live" ? true : row.websiteStatus === "unclear" ? null : false,
  city: row.city,
  state: row.state,
  ...(evidence.get(row.id) ?? {}),
});

const countWith = (variant) => {
  const only = [{ ...icp, ...variant }];
  return rows.filter((row) => matchIcp(only, factsFor(row)) !== null).length;
};

const known = {
  website: rows.filter((r) => r.websiteStatus === "live").length,
  reviews: rows.filter((r) => (evidence.get(r.id)?.reviewCount ?? null) !== null).length,
  place: rows.filter((r) => r.city || r.state).length,
};

console.log(`\nICP: ${icp.name}  (${icp.industry})`);
console.log(`words: ${[...icp.anyOf, ...icp.websiteAnyOf, ...icp.instagramAnyOf].join(", ") || "none"}`);
console.log(`\nof ${rows.length} active businesses:`);
console.log(`  as it stands                          ${countWith({})}`);
console.log(`  + must have a working website         ${countWith({ requiresWebsite: true })}   (only ${known.website} sites were reachable at all)`);
console.log(`  + at least 20 Google reviews          ${countWith({ minReviews: 20 })}   (only ${known.reviews} listings have ever been bought)`);
console.log(`  + only in Texas                       ${countWith({ places: ["TX"] })}   (${known.place} have a town or state stored)`);
console.log(`  + all three at once                   ${countWith({ requiresWebsite: true, minReviews: 20, places: ["TX"] })}`);
console.log("\nNothing was written. A condition nobody can answer refuses rather than passes, which is why the numbers drop.");

process.exit(0);
