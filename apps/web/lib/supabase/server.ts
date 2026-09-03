import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Component / Server Action / Route Handler client. Uses the signed-in user's own
 * session — never the service role key — so every query goes through RLS exactly as build
 * guide §3.7 requires. The service role key belongs to Trigger.dev workers only, never here.
 *
 * A new client is created on every call rather than cached globally: on the server this is
 * cheap (it mainly configures a fetch call), and each request carries its own cookies, so a
 * shared instance would leak one user's session into another's request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // setAll was called from a Server Component, which can't write cookies. Safe to
            // ignore here because the proxy (lib/supabase/proxy.ts) refreshes the session on
            // every request regardless.
          }
        },
      },
    },
  );
}
