import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * Two different connection modes on purpose:
 *  - the web app (Vercel) should use the Supabase transaction pooler and the ANON key's RLS
 *    context — build guide §3.7. It does NOT create its client from this file with a bare
 *    DATABASE_URL; it goes through Supabase's server-side auth helpers instead.
 *  - Trigger.dev workers use the service role and a direct/session-pooled connection, which is
 *    what this factory is for.
 *
 * Never import this from anywhere that runs in the browser.
 */
export function createDbClient(connectionString: string = requireDatabaseUrl()) {
  const client = postgres(connectionString, {
    // Required by Supabase's transaction pooler, which cannot hold prepared statements across
    // its connection reuse. Harmless on a direct connection.
    prepare: false,
    // A discovery run issues thousands of small sequential queries over several minutes. The
    // defaults left connections open long enough for Supabase to reset them mid-run — the live
    // failure was "could not receive data from client: Connection reset by peer", seen in the
    // Postgres logs at the exact second the task died. Recycling connections well before that
    // point, and keeping the pool small, is what makes a long run survivable.
    max: 5,
    idle_timeout: 20, // seconds a connection may sit unused before being closed
    max_lifetime: 60 * 10, // recycle every 10 minutes regardless of activity
    connect_timeout: 15,
  });
  return drizzle(client, { schema });
}

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — see .env.example at the repo root.");
  }
  return url;
}

export type Database = ReturnType<typeof createDbClient>;
