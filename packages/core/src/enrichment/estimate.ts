import {
  ENRICHMENT_DEFINITIONS,
  type EnrichmentSource,
} from "@lead-intel/shared";

/**
 * What one business needs from one source. `alreadyBought` comes from `provider_calls` — the
 * ledger that records every paid call before it is made.
 */
export interface EnrichmentCandidate {
  businessId: string;
  /** True when this exact source has already been bought successfully for this business. */
  alreadyBought: boolean;
  /** False when the business has nothing for this source to work with (no place id, no domain). */
  eligible: boolean;
  /** Why it is ineligible, shown to the operator so a skipped row is never unexplained. */
  ineligibleReason?: string | null;
}

export interface SourceEstimate {
  source: EnrichmentSource;
  label: string;
  provider: string;
  costCentsEach: number;
  /** How many of the selected businesses would actually be bought. */
  willBuy: number;
  /** Already on the record — costs nothing, and the operator should see that it is free. */
  alreadyHave: number;
  /** Nothing for this source to work with. */
  cannotBuy: number;
  /** What this run will actually be charged. Zero for a source that cannot be bought. */
  totalCents: number;
  /**
   * What it *would* cost if it were connected — always `willBuy × costCentsEach`.
   *
   * Kept separate from `totalCents` so an unconnected source can show its real price rather than
   * "$0.00". Displaying free next to something that costs $2.19 is the kind of small lie that
   * makes an operator stop trusting the whole screen.
   */
  wouldCostCents: number;
  /** True when the source's API key is missing — priced and listed, but not purchasable. */
  unavailable: boolean;
  unavailableReason: string | null;
  warning: string | null;
  fills: string[];
  describes: string;
}

export interface EnrichmentEstimate {
  selectedBusinesses: number;
  perSource: SourceEstimate[];
  /** Sum across every source the operator ticked. */
  totalCents: number;
  /** True when totalCents exceeds the cap — the confirm button must be refused. */
  overCap: boolean;
  capCents: number;
}

/**
 * Prices an enrichment run before any of it happens.
 *
 * Pure and deterministic — the same bar as the checks and the scorer. It reads a list of
 * candidates and returns money; nothing here calls a provider or a database, which is what makes
 * the number on the confirm screen testable.
 *
 * Two rules carry the weight:
 *
 * - **Already-bought is free, and says so.** The ledger check exists (`provider_calls` is
 *   consulted before every paid call), so re-selecting a business the operator already bought
 *   costs nothing. Showing that as `alreadyHave` rather than silently dropping it is the
 *   difference between "why is this cheaper than I expected" and a number that explains itself.
 * - **Ineligible is not the same as free.** A business with no Google place id cannot have its
 *   listing bought at any price. Counting it as "already have" would imply we hold data we do
 *   not, so it gets its own column and its own reason.
 */
export function estimateEnrichment(params: {
  /** Per source, the businesses selected for it. */
  candidatesBySource: Partial<Record<EnrichmentSource, EnrichmentCandidate[]>>;
  /** Which sources the operator actually ticked. */
  sources: EnrichmentSource[];
  selectedBusinesses: number;
  capCents: number;
  /** Env var names present in this environment, so a source without its key is shown disabled. */
  availableEnvVars: string[];
}): EnrichmentEstimate {
  const perSource: SourceEstimate[] = params.sources.map((source) => {
    const definition = ENRICHMENT_DEFINITIONS[source];
    const candidates = params.candidatesBySource[source] ?? [];

    const alreadyHave = candidates.filter((c) => c.alreadyBought).length;
    const cannotBuy = candidates.filter((c) => !c.alreadyBought && !c.eligible).length;
    const willBuy = candidates.filter((c) => !c.alreadyBought && c.eligible).length;

    const missingKey =
      definition.requiresEnvVar !== null && !params.availableEnvVars.includes(definition.requiresEnvVar);

    return {
      source,
      label: definition.label,
      provider: definition.provider,
      costCentsEach: definition.costCents,
      willBuy,
      alreadyHave,
      cannotBuy,
      totalCents: missingKey ? 0 : round2(willBuy * definition.costCents),
      wouldCostCents: round2(willBuy * definition.costCents),
      unavailable: missingKey,
      unavailableReason: missingKey
        ? `Not connected yet — ${definition.provider} needs ${definition.requiresEnvVar} in apps/jobs/.env before this can be bought.`
        : null,
      warning: definition.warning,
      fills: definition.fills,
      describes: definition.describes,
    };
  });

  const totalCents = round2(perSource.reduce((sum, s) => sum + s.totalCents, 0));

  return {
    selectedBusinesses: params.selectedBusinesses,
    perSource,
    totalCents,
    overCap: totalCents > params.capCents,
    capCents: params.capCents,
  };
}

/**
 * Money as the operator reads it: "$2.19", never "219 cents" or a float with nine digits.
 *
 * Rounds up rather than to nearest, so the confirm screen can never quote less than what will
 * actually be spent. Under-quoting by a cent is a small error that erodes a large thing — the
 * operator's willingness to believe the number at all.
 */
export function formatCents(cents: number): string {
  return `$${(Math.ceil(cents) / 100).toFixed(2)}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
