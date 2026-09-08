"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { RAIL_COOKIE, railIsOpen } from "@/lib/rail";
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

  // Every screen draws the rail, so every screen is now stale.
  revalidatePath("/", "layout");
}
