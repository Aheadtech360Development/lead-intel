import { createBrowserClient } from "@supabase/ssr";

/**
 * Client Component client — for code that runs in the browser (a realtime subscription, an
 * interactive form that needs the session directly). Server Components, Server Actions, and
 * Route Handlers use lib/supabase/server.ts instead; that split exists because the two run in
 * different environments and need different cookie-handling strategies.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
