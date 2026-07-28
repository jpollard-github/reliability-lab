# ADR 0008: Bounded investigation read model and explicit metric semantics

- Status: accepted
- Date: 2026-07-28

## Context

Execution detail, replay, and comparison are envelope-oriented. The legacy execution list also
hydrates every envelope and current replay capability, then the original home page aggregates those
objects in Next.js. That path is useful for compatibility but is unbounded, includes evidence a
table does not need, and creates per-row hydration work. Investigation metrics also require stable
definitions: execution and attempt evidence are not interchangeable, incomplete executions must
not distort outcome rates, and small provider samples must not become health theater.

## Decision

Add a framework-independent `InvestigationReadRepository` with memory and PostgreSQL adapters. Expose
three tenant-scoped, read-only Fastify endpoints for compact execution search, reliability summary,
and provider/model observations. Require an explicit half-open `[from, to)` range, default it to the
last 24 hours, cap it at 90 days, and return the resolved instants.

Order execution pages by `createdAt DESC, executionId DESC` and encode both values in a validated
opaque cursor. PostgreSQL uses selected execution columns, event `EXISTS` predicates, grouped
attempt evidence, percentile functions, and fixed query counts. Full envelopes and current replay
capability remain detail concerns.

Define outcome-rate terminal evidence as `succeeded`, `degraded`, `failed`, and `cancelled`. Report
queued and running as in flight and cancelled separately. Rates are null when this denominator is
zero.
Retry recovery requires retry/prior-failure evidence followed by succeeded/degraded. Fallback
dependence requires fallback selection followed by succeeded/degraded. Ambiguity and budget signals
come from explicit events or their narrow normalized terminal codes.

Provider/model observations aggregate attempts. Running attempts do not enter the observed attempt
success denominator. Every row exposes counts, latency sample size, p50/p95, normalized failures,
and a small-sample assessment. There is no composite reliability score, provider ranking, or
statistical-confidence claim.

## Consequences

- Aggregate-to-execution drill-down no longer loads all envelopes, event arrays, attempt arrays, or
  replay capability.
- Memory development and PostgreSQL production-shaped paths share typed contracts and tested
  semantics while using storage-appropriate implementations.
- JSONB attempt extraction remains acceptable for the bounded prototype; indexes cover tenant/time,
  tenant/status/time, and execution/event-type lookups.
- The compatibility list remains unbounded and should not be used for analytics.
- Counts describe the selected evidence window, not an SLA or universal provider state.
- External trace/log integration, saved cases, anomaly detection, and complete Horizon 5 workflows
  remain future work.
