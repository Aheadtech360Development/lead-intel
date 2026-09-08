import { playwright } from "@trigger.dev/build/extensions/playwright";
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

  build: {
    /**
     * Playwright is installed, not bundled.
     *
     * Its `playwright-core` ships a pre-bundled `coreBundle.js` containing lazy `require()` calls
     * for `chromium-bidi`, a package that is only needed for the BiDi protocol and is not installed.
     * esbuild resolves those statically and refuses to build — so the whole worker failed to start
     * over a code path Chromium never takes.
     *
     * Marked external, the requires stay as requires and are never reached. This also keeps the
     * bundle small: the browser driver has no business being inlined into the task bundle.
     */
    external: ["playwright", "playwright-core"],
    // Declared as a dependency of apps/jobs too, at the same exact version, purely so npm hoists it
    // to the repo root. Marked external it is resolved at run time from the bundle's own directory
    // (`apps/jobs/.trigger/tmp/...`), and Node walks up from there — which reaches the root but
    // never reaches `packages/providers/node_modules`, where an exact pin would otherwise nest it.
    // Without the second declaration the worker fails to start with "Cannot find package
    // 'playwright'".

    extensions: [
      /**
       * Puts Chromium and its system libraries into the deployed image.
       *
       * Without this the site audit deploys cleanly and then fails on its first run, because
       * `chromium.launch()` has no browser to launch — a failure that looks like a bug in our code
       * and is actually a missing build step.
       *
       * The version is pinned to the `playwright` package in packages/providers. A mismatch between
       * the driver and the installed browser is the other way this breaks, and it breaks at run
       * time rather than at deploy time.
       *
       * **1.57.0 exactly, and it cannot go higher until Trigger.dev updates this extension.**
       * The extension builds the image by running `playwright install --dry-run` and grepping its
       * output for a line reading `browser: chromium-headless-shell`. Playwright changed that
       * output in **1.58.0** — it now prints `Chrome Headless Shell 153.0.8010.12 (playwright
       * chromium-headless-shell v1243)` instead — so the grep matches nothing, exits 1, and the
       * whole image build dies on a line that mentions neither Playwright nor a version.
       *
       * Verified by running `playwright install --dry-run` on each release: 1.55, 1.56 and 1.57
       * print the old line; 1.58, 1.60, 1.61 and 1.63 do not. `@trigger.dev/build` has no release
       * after 4.5.16, so there is no fixed version to move to yet.
       */
      playwright({ browsers: ["chromium"], version: "1.57.0" }),
    ],
  },
});
