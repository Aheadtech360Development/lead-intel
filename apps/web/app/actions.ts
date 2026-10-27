"use server";

import { runs } from "@trigger.dev/sdk";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { RAIL_COOKIE, railIsOpen } from "@/lib/rail";
import { NEXT_THEME, readTheme, THEME_COOKIE, type Theme } from "@/lib/theme";
import { createClient } from "@/lib/supabase/server";

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Opens and closes the left rail.
 *
 * **A cookie rather than a checkbox.** The obvious zero-JavaScript collapse is a hidden checkbox
 * and a CSS sibling selector, and it would work — until the first navigation. `AppShell` is
 * rendered by each page rather than by the root layout, so it is built fresh on every route change
 * and any state living in the DOM goes with it. The rail would snap back open, or shut, every time
 * the operator clicked anything in it.
 *
 * A cookie survives that, costs one header, and needs no client-side code — which keeps the promise
 * the rest of this application makes.
 *
 * It defaults to **closed**, because that is what was asked for: "ager chahye hoga to khol loonga
 * werna bund rehne do".
 */
export async function toggleRail(): Promise<void> {
  const jar = await cookies();
  const open = railIsOpen(jar.get(RAIL_COOKIE)?.value);

  jar.set(RAIL_COOKIE, open ? "closed" : "open", {
    path: "/",
    // A year. This is a display preference, not a session: being asked to re-open the rail every
    // morning would be its own small annoyance.
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });

  /**
   * Nothing to revalidate.
   *
   * This used to call `revalidatePath("/", "layout")`, which throws away the router cache for
   * **every route in the product** — so opening the sidebar made the next click on anything slow,
   * and the one after that. It was also unnecessary: Next re-renders the current route once a
   * server action returns, and this render reads `cookies()`, so the new width is already applied.
   *
   * Other routes pick it up when they are next visited, which is exactly when they need it.
   */
}

/**
 * Moves the product between light, dark and following-your-device.
 *
 * A cookie for the same reason the rail is a cookie: `AppShell` is rendered by each page rather
 * than by the root layout, so anything held in the DOM is rebuilt — and lost — on every click.
 * The cookie is read by the root layout, which stamps `data-theme` on <html>, so the first paint
 * of a navigation is already in the right theme and nothing flashes.
 *
 * It takes the state it is moving **from**, rather than reading the cookie itself, so a stale tab
 * cannot cycle the theme somewhere the operator did not press.
 */
export async function setTheme(formData: FormData): Promise<void> {
  const from = readTheme(String(formData.get("from") ?? ""));
  const asked = String(formData.get("to") ?? "");
  const to: Theme = asked === "system" || asked === "light" || asked === "dark" ? asked : NEXT_THEME[from];

  const jar = await cookies();
  if (to === "system") {
    jar.delete(THEME_COOKIE);
  } else {
    jar.set(THEME_COOKIE, to, {
      path: "/",
      // A year. A display preference, not a session.
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  // Nothing to revalidate: Next re-renders the current route once an action returns, and that
  // render reads the cookie. Revalidating the layout would throw away the router cache for every
  // route in the product and make the next click slow — see toggleRail above.
}

/**
 * Stops a job the operator started, by mistake or otherwise.
 *
 * Two things happen, and the second is the one that can be relied on. The Trigger.dev run is asked
 * to cancel; and the job's own row is marked stopped, which every long job here checks between
 * batches and stops at. The second does not depend on how the platform treats child runs already in
 * flight — a site already open in a browser finishes its current page, and nothing new starts.
 *
 * Nothing already bought or measured is undone. Stopping is "no more", never "take it back".
 */
export async function stopJobRun(formData: FormData): Promise<void> {
  const id = String(formData.get("jobRunId") ?? "");
  const back = String(formData.get("back") ?? "/records");
  if (!id) redirect(back);

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") redirect("/login");

  const { data: job } = await supabase.from("job_runs").select("trigger_run_id, status").eq("id", id).maybeSingle();

  if (job?.trigger_run_id) {
    try {
      await runs.cancel(job.trigger_run_id);
    } catch {
      // Already finished, or the worker is unreachable. The row below still stops the loop.
    }
  }

  await supabase
    .from("job_runs")
    .update({
      status: "failed",
      detail: "Stopped by you. Anything already read or bought is kept; nothing new was started.",
      step: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", id)
    .in("status", ["queued", "running"]);

  const sep = back.includes("?") ? "&" : "?";
  redirect(`${back}${sep}saved=${encodeURIComponent("Stopped. Anything already done is kept.")}`);
}
