# ADR 0012: Derive case-comparison link recovery from lifecycle evidence

- **Status:** accepted
- **Date:** 2026-07-30

## Context

Case-Driven Policy Experiments create an ordinary comparison and then link it to a saved case.
Those mutations are intentionally separate. If comparison creation succeeds and evidence linking
fails, the comparison remains authoritative, but the original browser-only recovery result does not
survive a full reload.

Adding a pending-recovery table would duplicate facts already present in the saved case timeline,
current evidence associations, and comparison repository. Deriving only from a historical failure
event is also insufficient: a completed recovery must remain closed after an operator later removes
the evidence association intentionally.

## Decision

`InvestigationCaseReviewService` derives a bounded `comparisonLinkRecovery` projection from:

1. metadata-only `case.comparison_link_failed` events in persisted timeline order;
2. explicit `case.comparison_link_recovered` completion events;
3. current comparison evidence associations; and
4. current tenant-scoped reads from `ComparisonExperimentRepository`.

Repeated failures for one experiment collapse to one pending item. A later recovery event closes
earlier failures durably. Current linked evidence also suppresses a pending action. Review reads use
fixed-size batches and expose at most 50 actionable items plus `totalPending` and `hasMore`.

Linking an unresolved comparison through `InvestigationCaseService.addEvidence` appends
`case.comparison_link_recovered` in the same repository transaction as a new evidence association.
If the comparison is already linked, the repository appends only the completion event. Repeating the
action is safe and does not add another evidence link or completion event.

Available, missing, and current-read-unavailable comparison states remain distinct. Tenant-scoped
missing and wrong-tenant comparisons have the same external shape. The projection carries only
safe identifiers, timestamps, status, internal links, and constrained explanations.

Conclusion readiness remains the existing five-check record-completeness projection. Pending
recovery is shown separately and does not become a score or broaden the resolved-case invariant.

## Consequences

- Reloads, new browser pages, API reads, and review packets preserve the pending continuation.
- Recovery never recreates the comparison.
- A completed recovery does not resurrect merely because its evidence association is later removed.
- Memory and PostgreSQL adapters preserve the same transaction-level behavior without a new table
  or migration.
- At most 50 items are directly projected at once; `hasMore` makes additional pending work explicit.
- This is a narrow case-comparison continuation, not generic workflow recovery, reconciliation, or
  exactly-once infrastructure.

## Evidence

- `packages/core/src/investigation-cases/comparison-link-recovery.ts`
- `packages/core/src/investigation-cases/investigation-case-service.ts`
- `packages/core/src/investigation-cases/case-review-service.ts`
- `packages/db/src/investigation-cases/case-command-transactions.ts`
- `apps/web/features/investigation-cases/case-policy-experiments.tsx`
- core, API, PostgreSQL integration, packet, no-JavaScript, and Playwright recovery tests
