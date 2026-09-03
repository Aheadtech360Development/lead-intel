/**
 * Runs the website audit directly against the database, over the same `auditBusiness` the
 * Trigger.dev task calls. Only the queueing differs — the crawl, the classification, the checks
 * and the writes are the identical code path.
 *
 * This exists so a batch can be verified against real sites and the results read back
 * immediately, which is how every production bug in this project has been found so far.
 *
 *   node apps/jobs/run-audit.mjs                # everything not yet analysed
 *   node apps/jobs/run-audit.mjs --limit 10
 *   node apps/jobs/run-audit.mjs --all          # re-audit everything, including analysed records
 *   node apps/jobs/run-audit.mjs --stale 90     # only records whose findings are >90 min old
 *   node apps/jobs/run-audit.mjs --outcome dns_temporary --concurrency 3
 *
 * `--outcome` re-runs only the businesses whose last crawl ended a particular way. It exists
 * because a local network can fail in bulk: one pass produced `dns_temporary` for 112 of 209
 * businesses — this machine's resolver buckling under eight concurrent crawls, not 112 dead
 * domains. The system correctly refused to call any of them dead; this is how they get another
 * try, at a concurrency the resolver can survive.
 *
 * `--stale` exists because this runner has no retry, and a transient network failure therefore
 * leaves one business carrying findings from before whatever change prompted the re-run. (The
 * Trigger.dev task does retry — that is one of the reasons the audit is one task per business.)
 * Re-running with a staleness window picks up exactly those without re-crawling the rest.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Load apps/jobs/.env in-process. Deliberately not `source .env` from a shell: DATABASE_URL
// contains the database password, and a shell that cannot parse a line echoes it into the
// terminal. Read it here and it never leaves the process.
for (const line of readFileSync(join(dirname(fileURLToPath(import.meta.url)), ".env"), "utf8").split("\n")) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match?.[1] && !process.env[match[1]]) {
    process.env[match[1]] = (match[2] ?? "").replace(/^["']|["']$/g, "");
  }
}

const { createDbClient, businesses, findings } = await import("@lead-intel/db");
const { and, eq, notExists, sql } = await import("drizzle-orm");
const { auditBusiness } = await import("./dist/audit.js");

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 5000;
const recrawlAll = args.includes("--all");

/**
 * Matches the task queue's limit by default, so a local run behaves like the production one —
 * but overridable, because the constraint is sometimes this machine rather than politeness. Eight
 * parallel crawls, each resolving several hostnames, is enough to exhaust a home DNS resolver.
 */
const concurrencyArg = args.indexOf("--concurrency");
const CONCURRENCY = concurrencyArg >= 0 ? Math.max(1, Number(args[concurrencyArg + 1])) : 8;

const db = createDbClient();

const staleArg = args.indexOf("--stale");
const staleMinutes = staleArg >= 0 ? Number(args[staleArg + 1]) : null;
const outcomeArg = args.indexOf("--outcome");
const outcomeFilter = outcomeArg >= 0 ? String(args[outcomeArg + 1]) : null;

const notAnalysed = notExists(
  db.select({ one: sql`1` }).from(findings).where(eq(findings.businessId, businesses.id)),
);
/** Analysed, but not since the cutoff — a record left behind by a failed pass. */
const stale = sql`not exists (
  select 1 from findings f
  where f.business_id = ${businesses.id}
    and f.measured_at > now() - (${staleMinutes} * interval '1 minute')
)`;

/** Businesses whose last crawl ended with a particular outcome. */
const lastOutcomeWas = sql`exists (
  select 1 from field_metadata fm
  where fm.business_id = ${businesses.id}
    and fm.field_name = 'crawl_outcome'
    and fm.value = ${outcomeFilter}
)`;

const conditions = [eq(businesses.status, "active")];
if (outcomeFilter !== null) conditions.push(lastOutcomeWas);
else if (staleMinutes !== null) conditions.push(stale);
else if (!recrawlAll) conditions.push(notAnalysed);

const rows = await db
  .select({ id: businesses.id })
  .from(businesses)
  .where(and(...conditions))
  .limit(limit);

console.log(`auditing ${rows.length} businesses at concurrency ${CONCURRENCY}\n`);

const startedAt = Date.now();
let done = 0;
let failed = 0;
const queue = [...rows];

async function worker() {
  for (;;) {
    const row = queue.shift();
    if (!row) return;
    try {
      const s = await auditBusiness(db, row.id);
      done += 1;
      console.log(
        `[${done}/${rows.length}] ${s.status.padEnd(8)} ${String(s.problemsFound).padStart(2)} problems  ` +
          `${String(s.unmeasured).padStart(2)} unmeasured  ${s.pagesRead}p  ${(s.domain ?? "no domain").padEnd(34)} ${s.name.slice(0, 42)}`,
      );
    } catch (err) {
      failed += 1;
      console.error(`[fail] ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(
  `\ndone: ${done} audited, ${failed} failed, ${Math.round((Date.now() - startedAt) / 1000)}s total`,
);
process.exit(0);
