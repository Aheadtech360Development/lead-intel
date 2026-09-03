import { describe, expect, it } from "vitest";
import { describeDbError, isUniqueViolation, UNIQUE_VIOLATION } from "./errors.js";

/**
 * Rebuilds the exact error shape captured from the live database during the first real discovery
 * run: Drizzle's wrapper carries no code, the driver's error one level down carries "23505".
 * Checking only the top level — which the original implementation did — silently returns false
 * for every real collision.
 */
function drizzleWrapped(driverCode: string): Error {
  const driverError = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: driverCode,
    name: "PostgresError",
  });
  const wrapper = new Error("Failed query: insert into identity_keys ...", { cause: driverError });
  wrapper.name = "DrizzleQueryError";
  return wrapper;
}

describe("isUniqueViolation", () => {
  it("detects 23505 nested in Drizzle's cause chain — the shape production actually throws", () => {
    const err = drizzleWrapped(UNIQUE_VIOLATION);
    expect((err as { code?: unknown }).code).toBeUndefined(); // the trap: nothing at the top level
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("detects 23505 on a bare driver error too", () => {
    expect(isUniqueViolation({ code: UNIQUE_VIOLATION })).toBe(true);
  });

  it("does not treat other Postgres errors as collisions", () => {
    expect(isUniqueViolation(drizzleWrapped("23503"))).toBe(false); // foreign_key_violation
    expect(isUniqueViolation(drizzleWrapped("42P01"))).toBe(false); // undefined_table
  });

  it("is false for non-database errors, so real bugs still surface", () => {
    expect(isUniqueViolation(new Error("network down"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false); // a bare string is not an error object
  });

  it("terminates on a cyclic cause chain instead of hanging the worker", () => {
    const a: { cause?: unknown } = {};
    const b: { cause?: unknown } = { cause: a };
    a.cause = b;
    expect(isUniqueViolation(a)).toBe(false);
  });
});

describe("describeDbError", () => {
  it("surfaces the driver's reason, not just Drizzle's query text", () => {
    const driver = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint_name: "identity_keys_type_value_unique",
      detail: "Key (key_type, key_value)=(domain, kingdtg.com) already exists.",
    });
    const wrapper = new Error("Failed query: insert into identity_keys ... params: ...", {
      cause: driver,
    });

    const described = describeDbError(wrapper);
    expect(described).toContain("23505");
    expect(described).toContain("duplicate key value");
    expect(described).toContain("identity_keys_type_value_unique");
    // The point of the helper: the wrapper alone told us nothing about the cause.
    expect(wrapper.message).not.toContain("duplicate key value");
  });

  it("falls back to the plain message for non-database errors", () => {
    expect(describeDbError(new Error("socket hang up"))).toBe("socket hang up");
  });

  it("handles a bare driver error with no wrapper", () => {
    const described = describeDbError({ code: "40P01", message: "deadlock detected" });
    expect(described).toContain("40P01");
    expect(described).toContain("deadlock detected");
  });
});
