# Lead Intelligence & Enrichment System — Constitution

The principles below govern every change to this codebase. They exist because this system's
failure modes are **silent**: bad identity resolution, fabricated confidence, and unnoticed
spend do not raise errors. They corrupt the dataset and the decisions made from it, and are
discovered weeks later.

Where this document and any other disagree, this document wins. Where it is silent, defer to
Final Specification v3.2.

## Core Principles

### I. Provenance or Nothing (NON-NEGOTIABLE)

Every externally sourced field carries its source, confidence, verification status, and
last-verified timestamp (Spec §7.3). A value without provenance is not stored — not as a
temporary measure, not behind a TODO, not "until the provider integration settles".

Provenance cannot be retrofitted. A dataset that grows for three months without it has three
months of fields whose origin is permanently unknowable, and every retention and compliance rule
becomes unenforceable at once. This is the one principle whose violation is unrecoverable rather
than merely expensive.

Raw signal values are stored alongside derived scores, so any record can be rescored under a new
model version without re-purchasing data.

### II. Deterministic Core

Identity resolution, deduplication, merge, scoring, and routing are pure functions in
`packages/core` with no network calls and no AI. The same inputs produce the same outputs on
every run, forever.

This is not a style preference. Spec §15 requires model versions to be compared against each
other, which is impossible if the model's output varies between identical runs. Non-determinism
anywhere in this path silently destroys the feedback loop that the entire product depends on.

AI may phrase what was measured. It may never determine a fact, resolve an identity, produce a
score, or generate a finding.

### III. Honest Absence

Missing data is displayed as `unknown`, `not_found`, `not_yet_validated`, or `not_applicable` —
never as blank, never as zero, never omitted (Spec §1.2, §11.1).

A check that could not run is `unavailable`, never `passed`. A blocked crawl recorded as a clean
site is the most damaging single event available to this system: it corrupts the score, the
route, the spend decision, and the operator's confidence, and it does so without any error.

Unknown contributes zero evidence. It never counts as negative evidence, and it never counts as
positive.

An unverified match is never displayed the same way as a verified one. Confidence that is stored
but not shown is confidence that does not exist.

### IV. Spend Is Gated Before It Happens

Exclusion matching, suppression matching, and the free-signal gate run before any paid provider
call (Spec §6). Every paid call checks the idempotency ledger first and writes to it in the same
transaction as its results.

Money spent twice is not recoverable, and without the ledger it is not even detectable. A run
that hits its ceiling halts gracefully with completed work preserved; it does not overspend and
apologise.

### V. Validate at the Boundary

Every external response is parsed with Zod before it reaches any other code. Invalid responses
are dead-lettered and alerted, never coerced, patched, or partially accepted.

Provider response shapes change without notice and without a version bump. Validation at the
boundary is the only thing standing between that and silently corrupted records. Every adapter
ships recorded fixtures so a shape change appears as a git diff rather than as bad data.

### VI. Evidence Before Assertion

No finding is published without a stored evidence record: the measured value, its source URL or
endpoint, the timestamp, and the catalogue version (Spec §9). A finding that cannot produce its
evidence is downgraded, not shown.

Every threshold is written down in the audit catalogue before the check that uses it is built.
A measurement without a documented threshold is an opinion with a number attached.

Every generated opener names the finding it came from. An opener that cannot is an unverified
statement presented to a prospect as research.

## Additional Constraints

**Stack.** TypeScript throughout. Next.js on Vercel for requests, Trigger.dev for runs,
Supabase Postgres for data, Drizzle for schema, Playwright on Railway for rendered checks. API
routes enqueue and return; they never perform pipeline work inline.

**No agent frameworks and no AI agents in the pipeline.** The pipeline shape is fixed and
deterministic by design; agent indirection adds nondeterminism, cost, and debugging difficulty
to a process with none of those problems.

**Security.** RLS enabled on every user-facing table, with the web app using the signed-in
user's JWT. The service role key is confined to background jobs. Secrets live in the secrets
manager, never in the repository or the database. MFA and per-user accounts are required in
production.

**Data handling.** Collection is limited to public or self-published professional information.
Retention is encoded in `terms_classification` and `next_refresh_at` and executed by a scheduled
job — never left to a document. Suppression retains one-way identifier hashes only. Provider
caching windows are read from current provider terms and recorded in the adapter, not copied
from any specification document.

**Cost.** Every run declares a record cap and a spend ceiling. Cost per enriched record is
measured against the ceilings in Spec §8.2.3 and reconciled from the provider call ledger, not
estimated.

## Development Workflow and Quality Gates

**Tests.** Unit tests in `packages/core` are non-negotiable — identity, merge, scoring, and
routing. Merge logic carries the same coverage as normalisation, because it is where silent
data loss occurs. Every provider adapter ships fixture tests. The adversarial acceptance set
(Spec §17) runs before every release.

**Changes.** Smallest viable diff. No unrelated refactors. Code references cite
`start:end:path`. New code is proposed in fenced blocks before being applied.

**Model and prompt versioning.** Scoring model, audit catalogue, and AI prompts each carry a
version string stored on every record they touched. One class of change per version, so a
regression can be attributed. A new model version ships only after comparison against the
previous version on a held-out set.

**Definition of done.** Acceptance criteria are testable and inlined. Error paths and
constraints are stated explicitly. Every acceptance criterion in Spec §17 traces to a section
that defines how it is satisfied.

**Traceability.** Every user prompt produces a Prompt History Record under `history/prompts/`.
Architecturally significant decisions are proposed as ADRs and created only with consent.

## Governance

This constitution supersedes other practices. Amendments require a documented rationale, a
version bump, and a migration note where existing data or behaviour is affected.

Principles I through VI are gates, not aspirations. A change that violates one is not merged on
the argument that it is temporary, that the volume is small, or that it will be corrected in a
later phase — those are precisely the conditions under which each of these failures has
historically entered a system of this shape.

Complexity must be justified against the smallest viable change. Reductions in scope are
declared explicitly (Build Guide §6), never applied silently.

**Version**: 1.0.0 | **Ratified**: 2026-08-13 | **Last Amended**: 2026-08-13
