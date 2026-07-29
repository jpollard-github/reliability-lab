# Codebase Tour

This guide is the shortest route from repository root to the code that owns a behavior. Package
root `index.ts` files are public maps; production modules import the file that directly owns a
symbol.

## Package map

| Package or app           | Responsibility                                                        |
| ------------------------ | --------------------------------------------------------------------- |
| `packages/contracts`     | Portable TypeBox schemas and TypeScript data contracts                |
| `packages/core`          | Framework-independent domain behavior, ports, and memory adapters     |
| `packages/providers`     | Deterministic fake and OpenAI-compatible provider adapters            |
| `packages/db`            | PostgreSQL/Drizzle adapters, encryption, migrations, and durable jobs |
| `packages/observability` | OpenTelemetry bridge and structured-log redaction                     |
| `packages/testkit`       | Deterministic clocks, IDs, and randomness                             |
| `apps/api`               | Fastify transport and the API composition root                        |
| `apps/worker`            | Durable worker composition and polling loop                           |
| `apps/web`               | Next.js operator console                                              |

## Contracts source map

```text
packages/contracts/src/
  common/
    identifiers.ts             execution and tenant aliases
  execution/
    status.ts                  lifecycle and normalized error vocabulary
    provider.ts                provider request/response evidence
    policy.ts                  retry/fallback policy and budgets
    events.ts                  explicit payloads, metadata, and stored-event union
    envelope.ts                attempts and execution envelope
    create-execution.ts        TypeBox creation schema
  replay/
    capability.ts              current replay capability states
    replay.ts                  replay result and controlled variation
  comparison/
    experiment.ts              experiment and projection contracts
  investigation/
    workbench.ts               bounded search and aggregate read contracts
    cases.ts                   saved cases, evidence, notes, and timeline
  index.ts                     public package barrel
```

Schemas and their `Static<>` types stay together. Dependencies point from common identifiers toward
execution, then replay/comparison/investigation. The public entrypoint remains
`@reliability-lab/contracts`.

## Core source map

```text
packages/core/src/
  execution/
    execution-service.ts       public orchestration facade
    execution-builder.ts       accepted envelope preparation
    execution-runner.ts        guarded provider attempt and policy loop
    execution-events.ts        generated event metadata and append boundary
    execution-failure.ts       budget and terminal failure projection
    structured-output-validator.ts
    retry-backoff.ts
    execution-state.ts
    commands.ts
    ports.ts
    errors.ts
    memory-execution-repository.ts
  durable/
    durable-execution-worker.ts
    lease-heartbeat-controller.ts
    continuation-guard.ts
    job-store.ts
  replay/
    replay-store.ts
    memory-replay-store.ts
  comparison/
    variation-resolution.ts
    comparison-projection.ts
    repository.ts
    errors.ts
  investigation/
    range.ts
    signals.ts
    reliability-summary.ts
    provider-observations.ts
    read-repository.ts
    memory-read-repository.ts
    statistics.ts
  investigation-cases/
    investigation-case-service.ts
    saved-scope.ts
    evidence.ts
    cursor.ts
    repository.ts
    memory-repository.ts
    validation.ts
    errors.ts
  infrastructure/
    clock.ts
    hashing.ts
    provider-registry.ts
    resilience.ts
    tracing.ts
  index.ts                     public package barrel
```

`comparison.ts`, `investigation.ts`, and `investigation-cases.ts` are small compatibility barrels.
Internal production modules do not import them.

## Public entrypoints and composition roots

- `packages/contracts/src/index.ts` preserves `@reliability-lab/contracts`.
- `packages/core/src/index.ts` preserves `@reliability-lab/core`.
- `apps/api/src/server.ts` selects memory or PostgreSQL adapters and constructs `ExecutionService`,
  investigation reads, and `InvestigationCaseService`.
- `apps/worker/src/server.ts` constructs `ExecutionService`, `DurableExecutionWorker`, and the
  PostgreSQL job adapter.
- `apps/api/src/app.ts` maps the composed domain services to HTTP. Its later structural split is
  deliberately outside Phase 1.

## Where do I find…?

| Question                           | File and symbol                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `attempt.failed` payload           | `packages/contracts/src/execution/events.ts` — `AttemptFailedEventPayload`                                                                   |
| Generated execution event metadata | `packages/core/src/execution/execution-events.ts` — `ExecutionEventRecorder`                                                                 |
| Execution preparation              | `packages/core/src/execution/execution-builder.ts` — `prepareExecution`                                                                      |
| Provider attempt loop              | `packages/core/src/execution/execution-runner.ts` — `ExecutionRunner.#runPolicy`                                                             |
| Retry delay                        | `packages/core/src/execution/retry-backoff.ts` — `calculateRetryDelay`                                                                       |
| Structured-output validation       | `packages/core/src/execution/structured-output-validator.ts` — `StructuredOutputValidator`                                                   |
| Replay capability inspection       | `packages/core/src/replay/replay-store.ts` — `ReplayCapsuleStore.inspect`                                                                    |
| Comparison projection              | `packages/core/src/comparison/comparison-projection.ts` — `projectComparison`                                                                |
| Durable claim fencing              | `packages/core/src/durable/job-store.ts` — `JobClaim.claimVersion`; PostgreSQL enforcement remains in `packages/db/src/durable-execution.ts` |
| Heartbeat lease cancellation       | `packages/core/src/durable/lease-heartbeat-controller.ts` — `LeaseHeartbeatController`                                                       |
| Fallback dependence signal         | `packages/core/src/investigation/signals.ts` — `deriveInvestigationSignals`                                                                  |
| Saved-scope canonicalization       | `packages/core/src/investigation-cases/saved-scope.ts` — `canonicalizeSavedScope`                                                            |

## Tests

- Core behavior: `packages/core/test/`
- Contract consumers and HTTP shapes: `apps/api/test/`
- PostgreSQL adapters and restart behavior: `packages/db/test/*.integration.test.ts`
- Operator workflows: `apps/web/tests/`
- Structural rules: `scripts/check-source-structure.mjs`

## Recommended reading order

1. `docs/reliability-lab-basics.md`
2. `packages/contracts/src/execution/events.ts` and `execution/envelope.ts`
3. `packages/core/src/execution/execution-service.ts`
4. `packages/core/src/execution/execution-builder.ts` and `execution-runner.ts`
5. `packages/core/src/execution/execution-events.ts`
6. `packages/core/src/durable/`
7. `packages/core/src/replay/` and `comparison/`
8. `packages/core/src/investigation/` and `investigation-cases/`
9. `apps/api/src/server.ts`, then the database adapters

The companion [system flows](system-flows.md) follows concrete calls across those boundaries.
