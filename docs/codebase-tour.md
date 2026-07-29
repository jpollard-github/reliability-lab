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

## Ownership documentation map

| Question                                   | Primary document                                                 |
| ------------------------------------------ | ---------------------------------------------------------------- |
| What is the product and its vocabulary?    | `README.md`, `docs/reliability-lab-basics.md`                    |
| How would the owner explain and defend it? | `docs/design-review-walkthrough.md`                              |
| How does one operation cross boundaries?   | `docs/system-flows.md`                                           |
| Where does one responsibility live?        | This codebase tour                                               |
| Where would a representative change begin? | `docs/change-recipes.md`                                         |
| Which conventions apply locally?           | TypeScript, persistence/API, and operator-console pattern guides |
| What is established versus future?         | `docs/roadmap.md`                                                |

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

## Database source map

```text
packages/db/src/
  database/database.ts
      ReliabilityDatabase and createDatabase pool/Drizzle construction
  schema/
      executions.ts, durable-execution.ts, comparisons.ts
      investigation-cases.ts, replay.ts, index.ts
  execution/
      postgres-execution-repository.ts
      execution-row-mappers.ts
  comparison/
      postgres-comparison-repository.ts
      comparison-row-mappers.ts
  durable/
      postgres-durable-execution-store.ts
      execution-command-crypto.ts
  replay/
      postgres-replay-capsule-store.ts
      replay-runtime-config.ts
  investigation/
      postgres-investigation-read-repository.ts
      execution-search-query.ts
      reliability-summary-query.ts
      provider-observations-query.ts
      investigation-conditions.ts
      investigation-row-mappers.ts
      sql-values.ts
  investigation-cases/
      postgres-investigation-case-repository.ts
      case-list-query.ts
      case-detail-query.ts
      case-command-transactions.ts
      case-row-mappers.ts
  schema.ts                    Drizzle compatibility export map
  index.ts                     public package export map
```

`PostgresExecutionRepository.list` remains an unbounded compatibility read. Use
`PostgresInvestigationReadRepository.searchExecutions` for bounded operator search.

## API source map

```text
apps/api/src/
  app.ts                       Fastify composition root
  app-options.ts               typed composed dependencies
  plugins/platform.ts          CORS, Swagger, and Swagger UI
  http/
    error-mapper.ts            safe shared error translation
    query-values.ts            exact ranges and array query normalization
    response-builders.ts       transport-only execution links
  schemas/
    common.ts
    executions.ts
    replay.ts
    comparisons.ts
    investigations.ts
    investigation-cases.ts
  routes/
    operations.ts
    executions.ts
    execution-events.ts
    replay.ts
    comparisons.ts
    investigations.ts
    investigation-cases.ts
  event-stream.ts              transport-independent SSE iterator/formatter
  server.ts                    memory/PostgreSQL service composition
```

## Web source map

```text
apps/web/
  app/
    page.tsx
    investigations/page.tsx
    executions/[executionId]/page.tsx
    comparisons/[experimentId]/page.tsx
    investigation-cases/page.tsx
    investigation-cases/[caseId]/page.tsx
    globals.css                         ordered style import map
  features/
    executions/
      execution-form.tsx
      execution-table.tsx
      replay-controls.tsx
    live-machine/
      live-execution-view.tsx
      use-execution-stream.ts
      event-stream-state.ts
      use-event-playback.ts
      playback-controls.tsx
      machine-readout.tsx
      machine-route.tsx
      event-timeline.tsx
      execution-machine.ts
    comparisons/
      comparison-builder.tsx
      comparison-draft.ts
      comparison-presets.ts
      comparison-configurations.tsx
      comparison-machines.tsx
      comparison-summary.tsx
    investigations/
      search-state.ts
      workbench-loader.ts
      workbench-header.tsx
      time-window-toolbar.tsx
      reliability-summary-cards.tsx
      save-investigation-panel.tsx
      outcome-trend.tsx
      provider-observations.tsx
      execution-filters.tsx
      execution-explorer.tsx
    investigation-cases/
      case-list-state.ts
      case-list.tsx
      create-case-form.tsx
      add-to-case.tsx
      case-controls.tsx
      case-mutations.ts
      case-evidence.tsx
      case-overview.tsx
      case-notes.tsx
      case-timeline.tsx
  lib/
    server-api.ts
    client-api.ts
  styles/
    tokens.css, base.css, shell.css, forms.css, tables.css
    executions.css, comparisons.css, live-machine.css
    investigations.css, investigation-cases.css, responsive.css
  tests/
    execution-lifecycle.spec.ts
    live-machine.spec.ts
    comparative-replay.spec.ts
    investigation-workbench.spec.ts
    saved-investigation-cases.spec.ts
    support/
```

Route pages compose server-rendered evidence and focused client islands. `server-api.ts` imports
`server-only`; browser mutations use the public-only `client-api.ts` boundary.

## Public entrypoints and composition roots

- `packages/contracts/src/index.ts` preserves `@reliability-lab/contracts`.
- `packages/core/src/index.ts` preserves `@reliability-lab/core`.
- `packages/db/src/index.ts` preserves `@reliability-lab/db`.
- `packages/providers/src/index.ts`, `packages/observability/src/index.ts`, and
  `packages/testkit/src/index.ts` are their package entrypoints.
- `apps/api/src/server.ts` selects memory or PostgreSQL adapters and constructs `ExecutionService`,
  investigation reads, and `InvestigationCaseService`.
- `apps/worker/src/server.ts` constructs `ExecutionService`, `DurableExecutionWorker`, and the
  PostgreSQL job adapter.
- `apps/api/src/app.ts` installs platform/error infrastructure and typed domain route plugins.

## Where do I find…?

| Question                           | File and symbol                                                                                                                                                |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attempt.failed` payload           | `packages/contracts/src/execution/events.ts` — `AttemptFailedEventPayload`                                                                                     |
| Generated execution event metadata | `packages/core/src/execution/execution-events.ts` — `ExecutionEventRecorder`                                                                                   |
| Execution preparation              | `packages/core/src/execution/execution-builder.ts` — `prepareExecution`                                                                                        |
| Provider attempt loop              | `packages/core/src/execution/execution-runner.ts` — `ExecutionRunner.#runPolicy`                                                                               |
| Retry delay                        | `packages/core/src/execution/retry-backoff.ts` — `calculateRetryDelay`                                                                                         |
| Structured-output validation       | `packages/core/src/execution/structured-output-validator.ts` — `StructuredOutputValidator`                                                                     |
| Replay capability inspection       | `packages/core/src/replay/replay-store.ts` — `ReplayCapsuleStore.inspect`                                                                                      |
| Comparison projection              | `packages/core/src/comparison/comparison-projection.ts` — `projectComparison`                                                                                  |
| Durable claim fencing              | `packages/core/src/durable/job-store.ts` — `JobClaim.claimVersion`; PostgreSQL enforcement is in `packages/db/src/durable/postgres-durable-execution-store.ts` |
| Heartbeat lease cancellation       | `packages/core/src/durable/lease-heartbeat-controller.ts` — `LeaseHeartbeatController`                                                                         |
| Fallback dependence signal         | `packages/core/src/investigation/signals.ts` — `deriveInvestigationSignals`                                                                                    |
| Saved-scope canonicalization       | `packages/core/src/investigation-cases/saved-scope.ts` — `canonicalizeSavedScope`                                                                              |

## Persistence and API “find it” drill

| #   | Responsibility                       | Final file and symbol                                                                              |
| --- | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| 1   | PostgreSQL pool and Drizzle creation | `packages/db/src/database/database.ts` — `createDatabase`                                          |
| 2   | Shared Drizzle database type         | `packages/db/src/database/database.ts` — `ReliabilityDatabase`                                     |
| 3   | Execution insert mapping             | `packages/db/src/execution/execution-row-mappers.ts` — `toExecutionInsert`                         |
| 4   | Execution envelope hydration         | `packages/db/src/execution/execution-row-mappers.ts` — `hydrateExecution`                          |
| 5   | Comparison experiment mapping        | `packages/db/src/comparison/comparison-row-mappers.ts` — `toComparisonInsert`, `fromComparisonRow` |
| 6   | Atomic durable acceptance            | `packages/db/src/durable/postgres-durable-execution-store.ts` — `acceptExecution`                  |
| 7   | Replay capsule encryption            | `packages/db/src/replay/postgres-replay-capsule-store.ts` — `encryptReplayCapsule`                 |
| 8   | Execution search SQL                 | `packages/db/src/investigation/execution-search-query.ts` — `searchExecutions`                     |
| 9   | Reliability summary SQL              | `packages/db/src/investigation/reliability-summary-query.ts` — `summarizeReliability`              |
| 10  | Provider observation SQL             | `packages/db/src/investigation/provider-observations-query.ts` — `observeProviders`                |
| 11  | Saved-case list query                | `packages/db/src/investigation-cases/case-list-query.ts` — `listInvestigationCases`                |
| 12  | Saved-case note transaction          | `packages/db/src/investigation-cases/case-command-transactions.ts` — `addInvestigationCaseNote`    |
| 13  | Common tenant header schema          | `apps/api/src/schemas/common.ts` — `TenantOnlyHeadersSchema`                                       |
| 14  | Execution submission route           | `apps/api/src/routes/executions.ts` — `executionRoutes`                                            |
| 15  | SSE route                            | `apps/api/src/routes/execution-events.ts` — `executionEventRoutes`                                 |
| 16  | Comparison creation route            | `apps/api/src/routes/comparisons.ts` — `comparisonRoutes`                                          |
| 17  | Investigation summary route          | `apps/api/src/routes/investigations.ts` — `investigationRoutes`                                    |
| 18  | Saved-case creation route            | `apps/api/src/routes/investigation-cases.ts` — `investigationCaseRoutes`                           |
| 19  | API error mapping                    | `apps/api/src/http/error-mapper.ts` — `mapError`, `installErrorHandler`                            |
| 20  | Swagger registration                 | `apps/api/src/plugins/platform.ts` — `registerPlatformPlugins`                                     |

## Tests

- Core behavior: `packages/core/test/`
- Contract consumers and HTTP shapes: `apps/api/test/`
- PostgreSQL adapters and restart behavior: focused `packages/db/test/*.integration.test.ts` files
- API behavior: focused `apps/api/test/*.test.ts` files with `test/support/build-test-app.ts`
- Operator workflows: `apps/web/tests/`
- Structural rules: `scripts/check-source-structure.mjs`

## Operator console “find it” drill

| #   | Responsibility                         | Final file and symbol                                                                                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Workbench range resolution             | `apps/web/features/investigations/search-state.ts` — `resolveRange`                                                             |
| 2   | Workbench URL/filter state             | `apps/web/features/investigations/search-state.ts` — `toUrlSearchParams`, `filterHref`, `withoutParam`                          |
| 3   | Workbench server data loader           | `apps/web/features/investigations/workbench-loader.ts` — `loadInvestigationWorkbench`                                           |
| 4   | Reliability summary cards              | `apps/web/features/investigations/reliability-summary-cards.tsx` — `ReliabilitySummaryCards`                                    |
| 5   | Outcome trend                          | `apps/web/features/investigations/outcome-trend.tsx` — `OutcomeTrend`                                                           |
| 6   | Provider observations                  | `apps/web/features/investigations/provider-observations.tsx` — `ProviderObservations`                                           |
| 7   | Execution explorer                     | `apps/web/features/investigations/execution-explorer.tsx` — `ExecutionExplorer`                                                 |
| 8   | Saved-scope preparation                | `apps/web/features/investigations/search-state.ts` — `toSavedScope`                                                             |
| 9   | SSE browser connection                 | `apps/web/features/live-machine/use-execution-stream.ts` — `useExecutionStream`                                                 |
| 10  | Live event merge                       | `apps/web/features/live-machine/event-stream-state.ts` — `mergeExecutionEvents`                                                 |
| 11  | Playback state                         | `apps/web/features/live-machine/use-event-playback.ts` — `playbackReducer`, `useEventPlayback`                                  |
| 12  | Machine route rendering                | `apps/web/features/live-machine/machine-route.tsx` — `MachineRoute`                                                             |
| 13  | Comparison presets                     | `apps/web/features/comparisons/comparison-presets.ts` — `comparisonPresets`, `applyComparisonPreset`                            |
| 14  | Comparison draft parsing               | `apps/web/features/comparisons/comparison-draft.ts` — `toReplayVariation`                                                       |
| 15  | Replay deletion mutation               | `apps/web/features/executions/replay-controls.tsx` — `ReplayControls`, inner `deleteCapsule` handler                            |
| 16  | Case note mutation                     | `apps/web/features/investigation-cases/case-mutations.ts` — `addInvestigationCaseNote`                                          |
| 17  | Case evidence rendering                | `apps/web/features/investigation-cases/case-evidence.tsx` — `CaseEvidence`                                                      |
| 18  | Case timeline rendering                | `apps/web/features/investigation-cases/case-timeline.tsx` — `CaseTimeline`                                                      |
| 19  | Retry Playwright fixture               | `apps/web/tests/support/executions.ts` — `createRetryExecution`                                                                 |
| 20  | Comparative Replay Playwright workflow | `apps/web/tests/comparative-replay.spec.ts` — `compares a retrying execution with an immediate-fallback variant`                |
| 21  | Saved Investigation Cases workflow     | `apps/web/tests/saved-investigation-cases.spec.ts` — `saves a complete investigation case and reopens its exact evidence scope` |
| 22  | Investigation styles                   | `apps/web/styles/investigations.css`                                                                                            |
| 23  | Responsive styles                      | `apps/web/styles/responsive.css`                                                                                                |

## Recommended reading order

1. `README.md`, then `docs/reliability-lab-basics.md`
2. `docs/design-review-walkthrough.md`
3. `packages/contracts/src/execution/events.ts` and `execution/envelope.ts`
4. `packages/core/src/execution/execution-service.ts`
5. `packages/core/src/execution/execution-builder.ts`, `execution-runner.ts`, and
   `execution-events.ts`
6. `packages/core/src/durable/`, then the PostgreSQL durable adapter
7. `packages/core/src/replay/` and `comparison/`, then their PostgreSQL adapters
8. `packages/core/src/investigation/` and `investigation-cases/`, then their query/transaction
   adapters
9. `apps/api/src/app.ts`, then the route family named for the endpoint
10. `apps/web/app/investigations/page.tsx`, then its named feature component or controller
11. `docs/change-recipes.md` before planning a representative modification

The companion [system flows](system-flows.md) follows concrete calls across those boundaries.

## Where would I change…?

| Proposed change             | First owner to open                                 | Complete recipe                                                                            |
| --------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Execution event             | `packages/contracts/src/execution/events.ts`        | [Add an execution event](change-recipes.md#1-add-an-execution-event)                       |
| Normalized failure category | `packages/contracts/src/execution/status.ts`        | [Add a normalized failure category](change-recipes.md#2-add-a-normalized-failure-category) |
| Provider adapter            | `packages/providers/src/`                           | [Add a provider adapter](change-recipes.md#3-add-a-provider-adapter)                       |
| Reliability-policy input    | `packages/contracts/src/execution/policy.ts`        | [Add a reliability-policy input](change-recipes.md#4-add-a-reliability-policy-input)       |
| Workbench filter            | `packages/contracts/src/investigation/workbench.ts` | [Add a Workbench filter](change-recipes.md#5-add-an-investigation-workbench-filter)        |
| Investigation signal        | `packages/core/src/investigation/signals.ts`        | [Add an investigation signal](change-recipes.md#6-add-an-investigation-signal)             |
| Saved-case evidence type    | `packages/contracts/src/investigation/cases.ts`     | [Add a saved-case evidence type](change-recipes.md#7-add-a-saved-case-evidence-type)       |
| API read endpoint           | `apps/api/src/routes/`                              | [Add an API read endpoint](change-recipes.md#8-add-an-api-read-endpoint)                   |
| Operator-console section    | `apps/web/features/`                                | [Add an operator-console section](change-recipes.md#9-add-an-operator-console-section)     |
| Playwright workflow         | `apps/web/tests/`                                   | [Add a Playwright workflow](change-recipes.md#10-add-a-playwright-workflow)                |
