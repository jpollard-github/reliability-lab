# System Flows

These walkthroughs name the files and functions that execute each established workflow. Phase 2
gives transport routes, persistence adapters, queries, mapping, and transactions distinct homes.

## 1. In-process execution

1. `apps/api/src/routes/executions.ts` validates `POST /v1/executions` and calls
   `ExecutionService.submit`.
2. `packages/core/src/execution/execution-service.ts` hashes the request, checks idempotency and
   rate limits, and calls `prepareExecution`.
3. `packages/core/src/execution/execution-builder.ts` creates the envelope and asks
   `ExecutionEventRecorder.add` for accepted/replay/queued events.
4. The facade persists the accepted envelope, then delegates to
   `ExecutionRunner.continueNewExecution`.
5. `packages/core/src/execution/execution-runner.ts` retains replay material when allowed and runs
   `#runPolicy`.
6. The runner checks circuit and latency budgets, records `attempt.started`, calls the provider,
   validates structured output, and chooses retry, fallback, success, or failure.
7. `calculateRetryDelay` preserves capped exponential backoff and jitter.
8. `ExecutionEventRecorder.append` assigns metadata, appends to the envelope, and persists the
   event. `ExecutionFailureRecorder` owns budget and terminal failure projection.

## 2. PostgreSQL worker execution

1. `ExecutionService.submit` prepares the same envelope but delegates acceptance to the
   `DurableAcceptancePort`.
2. `packages/db/src/durable/postgres-durable-execution-store.ts` atomically stores queued evidence,
   encrypted transient command data, and optional idempotency state.
3. `apps/worker/src/server.ts` polls through `DurableExecutionWorker.runOnce`.
4. `DurableExecutionWorker` calls `DurableJobStore.claimNext`; the returned `JobClaim.claimVersion`
   is the fencing token.
5. `LeaseHeartbeatController` serializes heartbeats and exposes an
   `ExecutionContinuationGuard`.
6. The worker calls `ExecutionService.continueAcceptedExecution`, which delegates to the same
   `ExecutionRunner`.
7. Guard checks remain before provider work, after provider return, before retry/fallback, and
   before persistence. Lease loss aborts continuation without becoming a provider timeout.
8. Only the current claim version can finish the job and delete transient command ciphertext.

## 3. Replay

1. `ExecutionService.replay` reads the original execution and asks `ReplayCapsuleStore.getForReplay`
   for current capability and retained input.
2. `packages/core/src/replay/replay-store.ts` defines that tenant-scoped port. Memory behavior is in
   `memory-replay-store.ts`; PostgreSQL lifecycle and encryption live in
   `packages/db/src/replay/postgres-replay-capsule-store.ts`.
3. If unavailable, replay returns the current explicit capability reason.
4. If available, the facade submits an ordinary linked execution through the normal acceptance and
   runner path.
5. Completion records `replay.completed`; replay evidence is not a second execution engine.

Durable execution commands and replay capsules are separate concepts: commands are transient worker
inputs, while replay capsules are governed retention capabilities.

## 4. Comparative Replay

1. `ExecutionService.createComparison` reads the original and current replay capability.
2. `resolveReplayVariation` in `comparison/variation-resolution.ts` combines bounded overrides with
   safe original configuration and rejects no-op variation unless reproducibility was explicit.
3. The facade submits the variant through the normal execution path and stores the experiment
   definition through `ComparisonExperimentRepository`.
4. `ExecutionService.getComparison` reads both ordinary envelopes.
5. `projectComparison` in `comparison/comparison-projection.ts` produces conservative dimensions.
   Token changes and route changes remain tradeoffs; unavailable evidence stays unavailable.

## 5. Investigation Workbench read path

1. `apps/api/src/routes/investigations.ts` resolves a bounded exact range and calls
   `InvestigationReadRepository`.
2. The memory adapter is `investigation/memory-read-repository.ts`; the PostgreSQL shell is
   `packages/db/src/investigation/postgres-investigation-read-repository.ts`.
3. `range.ts` resolves exact ranges and stable cursors.
4. `signals.ts` derives retry recovery, fallback dependence, latency-budget failure, structured
   rejection, ambiguity, and replay-derived signals.
5. `reliability-summary.ts` and `provider-observations.ts` aggregate bounded evidence without
   replay hydration or provider-health scoring.
6. PostgreSQL search, aggregate/trend, and provider observations use the separately named fixed
   query modules under `packages/db/src/investigation/`.
7. The API returns compact contracts from `packages/contracts/src/investigation/workbench.ts`.

## 6. Saved Investigation Cases

1. `apps/api/src/routes/investigation-cases.ts` calls `InvestigationCaseService` in
   `investigation-cases/investigation-case-service.ts`.
2. `canonicalizeSavedScope` stores exact `from`/`to` instants and canonical filters, excluding
   moving presets, cursors, limits, and anchors.
3. The service validates execution and comparison references through their tenant-scoped
   repositories.
4. `evidence.ts` creates typed identities and internal URLs; no envelope, prompt, output, command,
   or replay payload is copied.
5. Notes append through the case repository. Updates replace current interpretation while
   metadata-only timeline events record changed fields, IDs, and presence flags.
6. Memory behavior lives in `memory-repository.ts`; PostgreSQL pagination/hydration lives in
   `case-list-query.ts` and `case-detail-query.ts`, while command transactions live in
   `packages/db/src/investigation-cases/case-command-transactions.ts`.

## 7. API composition and errors

1. `apps/api/src/server.ts` constructs memory or PostgreSQL services and calls the stable
   `buildApp(options)` entrypoint.
2. `apps/api/src/app.ts` creates Fastify, installs redacted logging, and delegates CORS/Swagger to
   `plugins/platform.ts`.
3. `http/error-mapper.ts` installs the shared safe error handler before feature plugins.
4. Typed route plugins receive only their composed service dependencies.
5. `routes/execution-events.ts` owns SSE headers/cursor/client cleanup while `event-stream.ts` owns
   persisted-event polling and formatting.

## 8. Operator console reads and URL state

1. An App Router `page.tsx` awaits route/search parameters and calls a server read or named loader.
2. `apps/web/lib/server-api.ts` owns server-only tenant configuration, `cache: "no-store"`, typed
   reads, and established not-found behavior.
3. The Workbench route calls `loadInvestigationWorkbench` in
   `features/investigations/workbench-loader.ts`.
4. `search-state.ts` resolves the range and filter/query state, then the loader starts summary,
   provider, and execution reads concurrently.
5. The loader prepares a presentation model, exact return URL, and saved-scope input.
6. Named Server Components render summary cards, save controls, trend, provider observations, and
   the execution explorer in page order.

## 9. Live Machine and browser mutations

1. `useExecutionStream` opens the established header-bearing fetch stream after the latest persisted
   sequence, parses SSE frames, merges events without duplicates, reconnects, and refreshes the
   terminal snapshot.
2. `projectExecutionEvents` remains the pure authority for machine steps and actual event span.
3. `useEventPlayback` changes only presentation state; readout, controls, machine route, and raw
   timeline render the selected persisted prefix.
4. Browser mutations use `lib/client-api.ts` public configuration plus feature-specific requests.
5. Replay deletion remains in `features/executions/replay-controls.tsx`; comparison drafts become
   variations in `features/comparisons/comparison-draft.ts`.
6. Saved-case mutation names live in `features/investigation-cases/case-mutations.ts`; notes append,
   evidence remains linked, and route refreshes re-read authoritative state.
