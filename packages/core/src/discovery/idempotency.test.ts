import { describe, expect, it } from "vitest";
import { discoveryCallIdempotencyKey } from "./idempotency.js";

describe("discoveryCallIdempotencyKey", () => {
  it("is deterministic for the same inputs", () => {
    const a = discoveryCallIdempotencyKey({ runId: "run-1", cellId: "cell-1", page: 0 });
    const b = discoveryCallIdempotencyKey({ runId: "run-1", cellId: "cell-1", page: 0 });
    expect(a).toBe(b);
  });

  it("differs when the page differs, so pagination doesn't collide", () => {
    const page0 = discoveryCallIdempotencyKey({ runId: "run-1", cellId: "cell-1", page: 0 });
    const page1 = discoveryCallIdempotencyKey({ runId: "run-1", cellId: "cell-1", page: 1 });
    expect(page0).not.toBe(page1);
  });

  it("differs when the cell differs, even within the same run", () => {
    const cellA = discoveryCallIdempotencyKey({ runId: "run-1", cellId: "cell-a", page: 0 });
    const cellB = discoveryCallIdempotencyKey({ runId: "run-1", cellId: "cell-b", page: 0 });
    expect(cellA).not.toBe(cellB);
  });
});
