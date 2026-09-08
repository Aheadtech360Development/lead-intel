/**
 * Measures what browser rendering actually costs, before committing to it for every business.
 *
 *   node apps/jobs/measure-render.mjs            # 10 sites
 *   node apps/jobs/measure-render.mjs --limit 5
 *
 * The plan's cost estimate is interpolated, not quoted: Trigger.dev publishes only the two ends of
 * its per-second range and nothing in between. So phase 1 ends here rather than with a number that
 * sounds authoritative and was arrived at by arithmetic on a guess.
 *
 * **Deliberately weighted towards the hard cases.** A sample of ten sites that already worked would
 * measure the easy half and predict the whole. This picks sites the plain crawler failed on — the
 * ones that came back empty because they are built by JavaScript, and the ones that answered 403 —
 * because those are slower, and because whether the browser fixes them at all is the other question
 * this run has to answer.
 *
 * Writes nothing. It reads URLs, renders them, and prints what it found.
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
const { eq, inArray } = await import("drizzle-orm");
const { startBrowser, renderPage, isRenderOk } = await import("@lead-intel/providers/render");

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 10;
// The rescue rate is the question phase 1 exists to answer, and a 60/40 sample answers it six
// businesses at a time. --hard-only spends the whole sample on it.
const hardOnly = args.includes("--hard-only");

const db = createDbClient();

// Two plain queries and a join in memory. Correlated subqueries through Drizzle's sql template
// silently returned nothing here, and a measurement script that quietly measures zero sites is
// worse than one that is a little verbose.
const bizRows = await db
  .select({ id: businesses.id, name: businesses.displayName })
  .from(businesses)
  .where(eq(businesses.status, "active"))
  .limit(2000);

const metaRows = await db
  .select({ businessId: fieldMetadata.businessId, fieldName: fieldMetadata.fieldName, value: fieldMetadata.value })
  .from(fieldMetadata)
  .where(inArray(fieldMetadata.fieldName, ["website_url", "crawl_outcome", "site_text"]));

const byBusiness = new Map();
for (const m of metaRows) {
  if (!m.businessId) continue;
  const bag = byBusiness.get(m.businessId) ?? {};
  bag[m.fieldName] = m.value;
  byBusiness.set(m.businessId, bag);
}

const rows = bizRows.map((b) => {
  const bag = byBusiness.get(b.id) ?? {};
  return {
    id: b.id,
    name: b.name,
    url: bag.website_url ?? null,
    outcome: bag.crawl_outcome ?? null,
    hadText: bag.site_text !== undefined,
  };
});

const withUrl = rows.filter((r) => r.url);
const hard = withUrl.filter((r) => r.outcome === "http_error" || (r.outcome === "ok" && !r.hadText));
const easy = withUrl.filter((r) => r.outcome === "ok" && r.hadText);

// Two thirds hard, one third easy — the easy ones are the timing baseline.
const pick = hardOnly
  ? hard.slice(0, limit)
  : [...hard.slice(0, Math.ceil(limit * 0.6)), ...easy.slice(0, Math.floor(limit * 0.4))].slice(0, limit);

console.log(`${withUrl.length} sites have a URL. ${hard.length} of them the plain crawler could not read.`);
console.log(`Rendering ${pick.length}: ${pick.filter((p) => hard.includes(p)).length} hard, ${pick.filter((p) => easy.includes(p)).length} known-good.\n`);

const started = await startBrowser();
if (!started.ok) {
  console.error(`Browser would not start: ${started.detail}`);
  process.exit(1);
}

const launchMs = Date.now();
console.log(`browser up\n`);

const results = [];
for (const row of pick) {
  const url = String(row.url).startsWith("http") ? String(row.url) : `https://${row.url}`;
  const wasHard = hard.includes(row);
  const page = await renderPage({ browser: started.session.browser, url, screenshot: true });

  const textLength = isRenderOk(page)
    ? page.html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length
    : 0;

  results.push({ ...page, wasHard, textLength, name: row.name });
  console.log(
    `${(page.outcome + "        ").slice(0, 9)} ${String(page.elapsedMs).padStart(6)}ms  ` +
      `text ${String(textLength).padStart(6)}  ` +
      `shot ${page.screenshot ? String(Math.round(page.screenshot.length * 0.75 / 1024)).padStart(4) + "KB" : "   —"}  ` +
      `${wasHard ? "[was failing] " : "              "}${String(row.name).slice(0, 32)}`,
  );
}

await started.session.close();

const totalMs = Date.now() - launchMs;
const ok = results.filter((r) => r.outcome === "ok");
const rescued = results.filter((r) => r.wasHard && r.outcome === "ok" && r.textLength > 200);
const avgMs = ok.length ? Math.round(ok.reduce((s, r) => s + r.elapsedMs, 0) / ok.length) : 0;
const avgShotKb = ok.length
  ? Math.round(ok.reduce((s, r) => s + (r.screenshot ? r.screenshot.length * 0.75 / 1024 : 0), 0) / ok.length)
  : 0;

console.log(`\n${"─".repeat(72)}`);
console.log(`rendered ok:        ${ok.length} / ${results.length}`);
console.log(`previously failing: ${results.filter((r) => r.wasHard).length}, of which ${rescued.length} now readable`);
console.log(`average per page:   ${avgMs}ms`);
console.log(`average screenshot: ${avgShotKb} KB`);
console.log(`whole run:          ${(totalMs / 1000).toFixed(1)}s for ${results.length} pages\n`);

// The projection the plan asked for, from measured seconds rather than an interpolated rate.
const PAGES_PER_SITE = 6;
const SITES = withUrl.length;
const secondsPerSite = 3 + (avgMs / 1000) * PAGES_PER_SITE;
const totalSeconds = Math.round(secondsPerSite * SITES);
console.log(`Projection for all ${SITES} sites at ${PAGES_PER_SITE} pages each:`);
console.log(`  ${Math.round(secondsPerSite)}s per site -> ${totalSeconds}s (${(totalSeconds / 3600).toFixed(1)} hours) of machine time`);
console.log(`  screenshots, home + product only: ~${Math.round((avgShotKb * SITES * 1.1) / 1024)} MB`);
console.log(`\nTrigger.dev bills machine time by the second. Multiply the seconds above by the`);
console.log(`medium-1x rate on the dashboard to get the real cost of one pass.`);
process.exit(0);
