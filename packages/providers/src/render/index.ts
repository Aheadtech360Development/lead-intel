/**
 * The browser-based renderer.
 *
 * Deliberately **not** re-exported from the package index. `apps/web` imports
 * `@lead-intel/providers` for Gemini and the Instagram handle parser; if Playwright came along with
 * them it would be bundled into the website — a native dependency with browser binaries attached,
 * in an app that never renders anything. That exact mistake broke the build once already, when a
 * runtime import pulled the worker's dependency tree into the web bundle.
 *
 * The worker imports this by subpath: `@lead-intel/providers/render`.
 */
export * from "./browser.js";
export * from "./render-page.js";
export * from "./types.js";
export * from "./measure-layout.js";
