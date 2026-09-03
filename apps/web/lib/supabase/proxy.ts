import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Auth session on every request and redirects signed-out users to /login.
 * Called from the root proxy.ts, which is Next.js 16's name for what used to be middleware.ts.
 *
 * Uses getClaims(), not getSession() — getClaims() validates the JWT signature against the
 * project's published public keys on every call, so it is safe to trust for routing decisions.
 * getSession() is not guaranteed to revalidate the token and must never be trusted here.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Do not run code between createServerClient and getClaims() below — a stray call in between
  // can make it very hard to debug users being randomly signed out.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value));
        },
      },
    },
  );

  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const isAuthRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth") ||
    request.nextUrl.pathname.startsWith("/error");

  if (!user && !isAuthRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Must return supabaseResponse as-is (or a clone that carries its cookies forward) — changing
  // this can desync the browser and server session state and sign the user out prematurely.
  return supabaseResponse;
}
