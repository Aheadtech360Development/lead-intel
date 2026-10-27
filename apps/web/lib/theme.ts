/**
 * Light, dark, or whatever the machine says.
 *
 * The name and the parsing live here, in an ordinary module, rather than beside the action that
 * sets them: a file marked `"use server"` may export **only** async functions, so a plain constant
 * there fails the production build while `next dev` runs happily. This project has been caught by
 * that twice — `DEFAULT_IMPORT_PLAN` and `RAIL_COOKIE`.
 *
 * Three states rather than two, because a viewer who never chose is a real state and not a tie:
 * "system" stamps nothing on <html> and lets `prefers-color-scheme` decide, while a choice stamps
 * `data-theme` and beats the operating system in both directions. No client-side JavaScript is
 * involved anywhere in that — the choice is a cookie, read while the page is being rendered.
 */
export const THEME_COOKIE = "theme";

export type Theme = "system" | "light" | "dark";

export function readTheme(value: string | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * What the one button in the top bar does next.
 *
 * A cycle rather than a switch, because a switch cannot reach the third state. The order follows
 * the machine: whatever the system is giving you, the first press is the other one.
 */
export const NEXT_THEME: Record<Theme, Theme> = {
  system: "dark",
  dark: "light",
  light: "system",
};

export const THEME_LABEL: Record<Theme, string> = {
  system: "Following your device",
  light: "Light",
  dark: "Dark",
};
