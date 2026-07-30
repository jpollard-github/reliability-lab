# ADR 0011: Case-driven policy experiments

- Status: accepted
- Date: 2026-07-30

## Context

Saved cases could preserve questions, scope, interpretation, and typed evidence, but an operator had
to leave the case and manually carry identifiers to create a comparison elsewhere. Adding an
experiment-suite table would duplicate the case's grouping role. Reimplementing comparison policy
inside the case feature would create a second interpretation of replay capability and variation
semantics.

Comparison creation and case evidence linking are separate mutations. A valid comparison can
therefore exist even when the later case-link operation fails. Hiding that partial commit behind a
generic server error would lose the safe recovery identifier and encourage duplicate comparisons.

## Decision

Use the saved case as the durable experiment grouping surface and keep
`ComparisonExperiment` as the authoritative experiment record.

Add `InvestigationCaseExperimentService` as a framework-independent coordinator. It accepts a
persisted execution evidence identifier, proves that the reference belongs to the case and tenant,
delegates comparison creation to `ExecutionService`, and delegates evidence linking to
`InvestigationCaseService`. It performs no HTTP calls and copies no execution, replay, or comparison
content into the case.

Model the orchestration result as `comparison_linked` or
`comparison_created_link_failed`. Do not delete or roll back a valid comparison after a link
failure. Return its safe identifier and recover by linking that existing comparison through the
ordinary evidence endpoint. Record metadata-only `case.comparison_started` and
`case.comparison_link_failed` events.

Reuse the established `ReplayVariation` schema, presets, draft conversion, and ordinary comparison
service. One submission creates one comparison. Do not add batch campaigns, broad idempotency,
statistical analysis, recommendations, winners, or automatic conclusions.

## Consequences

- The case is an active investigation workspace without becoming an experiment-suite store.
- Replay availability, safe variation resolution, provider availability, and comparison lifecycle
  keep one authoritative owner.
- Successful evidence linking feeds the existing case review, readiness, and packet paths.
- Comparison creation and case linking are intentionally non-atomic. A partial result is a normal,
  recoverable transport state rather than an erased error.
- Browser busy state limits accidental duplicate submission, but exactly-once comparison creation
  is not guaranteed across retries or clients.
- Timeline and maintainer diagnostics contain bounded identifiers and operation metadata only.
- Tenant routing remains a prototype header convention rather than authenticated isolation.
