/**
 * Deterministic idempotency key for a single Places search request, so a retried grid cell
 * reuses provider_calls' record instead of paying for the same search twice (spec §9 Stage 1 —
 * "discovery is the main cost"; schema.ts's provider_calls comment calls for this to be computed
 * here, not inline in apps/jobs). Not a cryptographic hash — just a deterministic, readable join;
 * provider_calls.idempotency_key is plain text with no length constraint, so there's no reason
 * to compress it into something harder to debug.
 */
export function discoveryCallIdempotencyKey(params: {
  runId: string;
  cellId: string;
  page: number;
}): string {
  return `${params.runId}:discover:${params.cellId}:page${params.page}`;
}
