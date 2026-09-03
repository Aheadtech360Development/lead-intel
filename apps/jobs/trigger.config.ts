import { defineConfig } from "@trigger.dev/sdk";

/**
 * The project ref is a public identifier, not a secret — it is committed deliberately, unlike
 * TRIGGER_SECRET_KEY which stays in apps/jobs/.env. From the Trigger.dev dashboard (project
 * "Data Scraping"); see SETUP.md's Phase 3 section.
 */
export default defineConfig({
  project: "proj_qarelorrhbssyawxssqv",
  dirs: ["./trigger"],
  runtime: "node-22",
  maxDuration: 1800, // 30 minutes — a 200-mile grid search is "hours" per the Phase 3 plan's own
  // estimate; this is a per-RUN ceiling meant to catch a genuinely stuck task, not a normal
  // upper bound. Revisit once a real large run's actual duration is measured.
});
