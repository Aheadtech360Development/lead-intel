/**
 * The name of the cookie the sidebar's width is remembered in.
 *
 * It lives here, in an ordinary module, rather than beside `toggleRail` in app/actions.ts. A file
 * marked `"use server"` may export **only** async functions — every other export is turned into a
 * callable endpoint, which a string cannot be — so a plain constant there fails the production
 * build while `next dev` runs happily. This project has been caught by that once already, with
 * `DEFAULT_IMPORT_PLAN`.
 */
export const RAIL_COOKIE = "rail";

/** Closed unless the operator has said otherwise. */
export function railIsOpen(value: string | undefined): boolean {
  return value === "open";
}
