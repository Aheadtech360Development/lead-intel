/** Postgres unique_violation — https://www.postgresql.org/docs/current/errcodes-appendix.html */
export const UNIQUE_VIOLATION = "23505";

/**
 * True when `err`, or anything in its `cause` chain, is a Postgres unique-constraint violation.
 *
 * The chain walk is the whole point. Drizzle wraps driver errors in a `DrizzleQueryError` whose
 * own `.code` is `undefined`; the real `PostgresError` (with `code: "23505"`) sits one level down
 * in `.cause`. Verified against the live driver, not assumed — an earlier version of this check
 * looked only at `err.code`, so it never once returned true in production. That mattered more
 * than it sounds: catching 23505 is how discovery resolves two records turning out to be the
 * same business (build guide §3.4 — insert optimistically, catch the collision, never pre-check).
 * With the check silently failing, the first real discovery run crashed on the first genuine
 * duplicate domain instead of merging it.
 *
 * Unit tests using a fake repository cannot catch this class of bug, because a fake never
 * produces a real wrapped driver error — see errors.test.ts, which asserts against the exact
 * shape captured from the live database.
 */
/**
 * A diagnosable one-line description of a database error, built by walking the same cause chain
 * `isUniqueViolation` walks.
 *
 * Drizzle's own `.message` is only ever "Failed query: insert into ... params: ..." — it names the
 * statement but never says what went wrong with it. The Postgres error one level down carries the
 * SQLSTATE code, the real message, and usually the constraint or column at fault. Reporting only
 * the wrapper (which the discovery task originally did) produces a crash report that shows the
 * query and hides the reason, which is how a live failure stayed un-diagnosable until someone
 * re-ran it by hand.
 */
export function describeDbError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;

  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    if (typeof current === "object") {
      const e = current as {
        code?: unknown;
        message?: unknown;
        detail?: unknown;
        constraint_name?: unknown;
        constraint?: unknown;
        table_name?: unknown;
        column_name?: unknown;
      };
      // Skip Drizzle's wrapper: it has a message but no SQLSTATE, and its message is the query
      // text we already know. Anything carrying a code is a real driver error worth reporting.
      if (e.code !== undefined || depth > 0) {
        const bits = [
          e.code ? `[${String(e.code)}]` : null,
          typeof e.message === "string" ? e.message : null,
          e.detail ? `detail: ${String(e.detail)}` : null,
          e.constraint_name ?? e.constraint ? `constraint: ${String(e.constraint_name ?? e.constraint)}` : null,
          e.column_name ? `column: ${String(e.column_name)}` : null,
        ].filter(Boolean);
        if (bits.length > 0) parts.push(bits.join(" "));
      }
    }
    current = (current as { cause?: unknown })?.cause;
  }

  if (parts.length > 0) return parts.join(" <- ");
  return err instanceof Error ? err.message : String(err);
}

export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  // Bounded rather than `while (current)`: a malformed or cyclic cause chain must not hang the
  // discovery worker. Nothing legitimate nests this deep.
  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
