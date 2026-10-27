import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Who is signed in, and what they are allowed to be shown.
 *
 * The design has two sides — an administrator's and a member's — and until now the web app had
 * neither: every screen was built for whoever happened to be signed in, because there was exactly
 * one account. `user_roles` has been in the database since 0001_rls_policies.sql, so the role was
 * always there to read; nothing in `apps/web` ever read it.
 *
 * This is the one place that does. Every screen asks it the same question and gets the same
 * answer, so a page cannot disagree with the navigation about what a member may see.
 *
 * **What this is not.** Hiding a link is not security. The real boundary is row-level security in
 * Postgres, where a member's own policies decide what rows come back — that is what makes typing
 * an address by hand give the same answer the navigation does. This file decides what to *draw*;
 * the database decides what *exists*. Both have to be right, and the database is the one that
 * matters. See `specs/multi-user/spec.md` §2.
 */

export type Role = "admin" | "member";

export type Viewer = {
  id: string;
  email: string | null;
  role: Role;
  isAdmin: boolean;
};

/**
 * The signed-in person, with their role.
 *
 * Least privilege when the answer is unclear: a signed-in account with no row in `user_roles` is
 * treated as a **member**, not an administrator. An account becomes an admin only by someone
 * putting a row in that table — there is deliberately no path for a new sign-up to grant itself
 * the role, and that stays true here.
 *
 * Returns `null` when nobody is signed in. Pages are already behind the proxy's redirect, so a
 * null viewer means the session expired between the redirect and the query, and the page should
 * send the person to sign in again rather than guess.
 */
export async function getViewer(): Promise<Viewer | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const id = claims?.sub ? String(claims.sub) : null;
  if (!id) return null;

  const { data: roleRow } = await supabase.from("user_roles").select("role").eq("user_id", id).maybeSingle();

  const role: Role = roleRow?.role === "admin" ? "admin" : "member";
  const email = typeof claims?.email === "string" ? claims.email : null;

  return { id, email, role, isAdmin: role === "admin" };
}

/**
 * The filter that turns "every lead" into "this person's leads".
 *
 * `null` means no filter — an administrator sees the whole list, which is the product's own
 * position: the admin hands leads out, so they have to be able to see what they are handing.
 *
 * For a member it returns the column and value to filter on. Today that column is `claimed_by`,
 * because claiming is the only ownership the database actually has. **Assignment is specified and
 * not built** (`specs/multi-user/spec.md` §2, `tasks.md` stage 1): when `businesses.owner_id`
 * exists, this function changes and nothing else does — which is the whole reason it is a function
 * rather than a `.eq()` copied into fourteen pages.
 */
export function leadScope(viewer: Viewer): { column: "claimed_by"; value: string } | null {
  if (viewer.isAdmin) return null;
  return { column: "claimed_by", value: viewer.id };
}

/**
 * What the member side says when an admin-only address is typed in by hand.
 *
 * One sentence, naming the thing and the reason, because "403" tells a salesperson nothing they
 * can act on. The caller renders it; this is only the words, so they are the same everywhere.
 */
export const ADMIN_ONLY_REASON: Record<string, string> = {
  search:
    "Searching Google Maps creates businesses nobody has seen yet and costs money for every search. The administrator runs it and hands out what it finds.",
  users: "Adding people, setting budgets and approving transfers are the administrator's job.",
};

/**
 * Refuses an action a member may not take.
 *
 * Called at the top of every server action that belongs to the administrator. It redirects rather
 * than throwing, because a member who somehow posted this form is not an attacker to be shown a
 * stack trace — they are a salesperson whose page was out of date, and the screen they land on
 * says what happened.
 *
 * This is a second lock, not the only one: the database's own policies are what make it true for
 * a request that never goes through this app at all.
 */
export async function requireAdmin(where: string): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.isAdmin) redirect(`${where}?error=${encodeURIComponent("That is the administrator's to change.")}`);
  return viewer;
}
