# System Flows

These walkthroughs name the files and functions that execute each established workflow. Phase 2
gives transport routes, persistence adapters, queries, mapping, and transactions distinct homes.

## 0. Provider capability and configured live execution

1. Root development commands register `register-local-environment.mjs` through Node's supported
   `--import` option so exported values, `.env.local`, and `.env` reach web, API, and worker with one
   documented precedence. Production package entrypoints remain injection-only.
2. `buildProviderRuntime` constructs deterministic adapters and, only from complete valid server
   configuration, one OpenAI-compatible live adapter. API and worker call the same owner.
3. `providerRoutes` exposes `GET /v1/providers` under the tenant-routing header. It returns safe
   capabilities and performs no provider call; configuration is not health.
4. The home-page Server Component reads those capabilities through `getProviderCapabilities`.
   Deterministic lab scenarios always render. `LiveExecutionForm` renders only for an eligible live
   capability. API composition adds only safe encrypted-retention availability, label, hours,
   per-execution opt-in, and a constrained unavailable reason.
5. The focused form sends the safe provider ID/model label, one bounded non-sensitive input, one
   attempt, no fallback, a bounded latency budget, and explicit `disabled` or `encrypted` retention
   intent through ordinary `POST /v1/executions`. The checkbox defaults unchecked.
6. The route and `validateLiveProviderRequest` reject browser-selected models, failure injection,
   oversized input/schema, and out-of-bounds policy/budget values.
7. `OpenAICompatibleHttpProvider` rechecks model/failure controls, sends one Chat Completions
   request with `store: false`, bounds the response, and emits only normalized result evidence.
8. The same envelope, attempts, events, detail, Timeline playback, Workbench, case, experiment,
   review, and packet surfaces consume the resulting ordinary execution.

**Boundary/evidence review:** capabilities exclude key, endpoint, raw configuration, headers, query
strings, request bodies, and provider bodies. The API rejects unavailable encrypted intent before
submission; there is no silent downgrade. Live retention remains default-deny. Timeline playback is
recorded presentation only; replay is a separate new provider execution requiring current retained
input. Adapter proof lives in `packages/providers/test/`, route proof in
`apps/api/test/providers.test.ts`, built loopback proof in `scripts/verify-local-provider-wire.mjs`,
and browser proof in `apps/web/tests/live-provider-execution.spec.ts`.

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
   `#runPolicy`. Fake work keeps established retention. Live work requires both gates; a required
   encrypted write completes before `attempt.started` and any provider call.
6. The runner checks circuit and latency budgets, records `attempt.started`, calls the provider,
   validates structured output, and chooses retry, fallback, success, or failure.
7. `calculateRetryDelay` preserves capped exponential backoff and jitter.
8. `ExecutionEventRecorder.append` assigns metadata, appends to the envelope, and persists the
   event. `ExecutionFailureRecorder` owns budget and terminal failure projection.

**Boundary/evidence review:** the entrypoint is `executionRoutes`; transport crosses into core,
then the execution/replay/provider ports, then a memory or PostgreSQL adapter. Acceptance writes the
initial envelope; continuation writes attempts, append-only events, and current projection.
`execution.succeeded` or `execution.failed` plus terminal envelope state is the final evidence.
Relevant tests are `packages/core/test/execution-service.test.ts`,
`packages/core/test/execution-events.test.ts`, and `apps/api/test/executions.test.ts`.

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

**Boundary/evidence review:** the API enters through the same route but crosses the durable
acceptance port into one PostgreSQL transaction before the worker process claims the job. Durable
rows include the queued envelope/events and encrypted command; continuation writes ordinary
attempt/event/projection evidence. Terminal job state and cleared command fields must match the
current claim version. Relevant tests are `packages/core/test/lease-safety.test.ts`,
`packages/db/test/durable-execution.integration.test.ts`, and
`apps/web/tests/execution-lifecycle.spec.ts`.

## 3. Replay

1. `ExecutionService.replay` reads the original execution and asks `ReplayCapsuleStore.getForReplay`
   for current capability and retained input.
2. `packages/core/src/replay/replay-store.ts` defines that tenant-scoped port. Memory behavior is in
   `memory-replay-store.ts`; PostgreSQL lifecycle and encryption live in
   `packages/db/src/replay/postgres-replay-capsule-store.ts`.
3. If unavailable, replay returns the current explicit capability reason.
4. If available, the facade submits an ordinary linked execution through the normal acceptance and
   runner path.
5. The child command inherits encrypted retention, creating a fresh row/expiry before its provider
   effect rather than copying source ciphertext.
6. Completion records `replay.completed`; replay evidence is not a second execution engine.

Durable execution commands and replay capsules are separate concepts: commands are transient worker
inputs, while replay capsules are governed retention capabilities.

**Boundary/evidence review:** the entrypoint is `ExecutionService.replay`, reached through
`replayRoutes`. Core crosses the tenant-scoped replay port; PostgreSQL decrypts only inside
`PostgresReplayCapsuleStore.getForReplay`; available input returns to the normal execution path.
Vault writes are encrypted capsule plus metadata-only audit. Terminal evidence is the linked
execution's normal terminal event plus `replay.completed`; unavailable capability is an explicit
result rather than a fabricated run. Relevant tests are the replay section of
`packages/core/test/execution-service.test.ts`, `packages/db/test/replay-crypto.test.ts`,
`packages/db/test/replay-vault.integration.test.ts`, and `apps/api/test/executions.test.ts`.

## 4. Comparative Replay

1. `ExecutionService.createComparison` reads the original and current replay capability.
2. `resolveReplayVariation` in `comparison/variation-resolution.ts` combines bounded overrides with
   safe original configuration and rejects no-op variation unless reproducibility was explicit.
3. The facade submits the variant through the normal execution path and stores the experiment
   definition through `ComparisonExperimentRepository`.
4. A live original inherits its server-configured provider/model/fallback target and accepts only
   live-safe policy/budget changes or an explicit reproducibility check. The child gets independent
   encrypted retention before its provider call.
5. `ExecutionService.getComparison` reads both ordinary envelopes.
6. `projectComparison` in `comparison/comparison-projection.ts` produces conservative dimensions.
   Token changes and route changes remain tradeoffs; unavailable evidence stays unavailable.

**Boundary/evidence review:** `comparisonRoutes` calls `ExecutionService.createComparison`; core
crosses replay capability, execution, comparison repository, and optional durable-acceptance
boundaries. PostgreSQL worker mode atomically stores the experiment, linked variant, replay
linkage, and job; in-process mode stores variant and experiment separately. Completion is two
ordinary terminal envelopes plus a completed experiment; `projectComparison` is the read-time
evidence. Relevant tests are `packages/core/test/comparison.test.ts`,
`packages/db/test/comparison-repository.integration.test.ts`,
`packages/db/test/durable-execution.integration.test.ts`,
`apps/api/test/comparisons.test.ts`, and `apps/web/tests/comparative-replay.spec.ts`.

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

`execution-search-query.ts` owns the bounded execution page and fixed count.
`reliability-summary-query.ts` owns both aggregate and trend statements.
`provider-observations-query.ts` owns attempt-level provider/model evidence.

**Boundary/evidence review:** entrypoints are the three routes in `investigationRoutes`. Transport
crosses the read port into memory projection or purpose-built PostgreSQL SQL under tenant and exact
`[from,to)` bounds. These are reads only; no replay capability or full envelope is hydrated.
Terminal evidence is the returned resolved range, compact rows, aggregate/trend buckets, and sample
metadata—not a provider-health verdict. Relevant tests are
`packages/core/test/investigation.test.ts`,
`packages/db/test/investigation-read.integration.test.ts`,
`apps/api/test/investigations.test.ts`, and `apps/api/test/query-values.test.ts`.

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

**Boundary/evidence review:** `investigationCaseRoutes` enters
`InvestigationCaseService`, which crosses case, execution, and comparison repository ports.
PostgreSQL transactions write current case state together with lifecycle metadata; notes append,
and evidence rows store typed identities only. The detail read returns current interpretation,
ordered notes/evidence/timeline, and `savedWorkbench`. Relevant tests are
`packages/core/test/investigation-cases.test.ts`,
`packages/db/test/investigation-cases.integration.test.ts`,
`apps/api/test/investigation-cases.test.ts`, and
`apps/web/tests/saved-investigation-cases.spec.ts`.

### 6a. Derived case evidence review and packet

1. `InvestigationCaseReviewService.get` loads the tenant-scoped case detail, then resolves every
   linked reference through the existing execution, replay, comparison, or investigation-read
   port. It does not use HTTP or SQL directly.
2. Each resolver emits a bounded safe projection or an explicit unavailable state. It never copies
   prompt messages, outputs, replay commands/capsules, note bodies, headers, or provider payloads.
3. `projectConclusionReadiness` evaluates five fixed checks: exact scope, linked evidence, every
   reference explicitly reviewed, finding, and resolution. Readiness is deterministic workflow
   completeness, not a score or correctness claim.
4. A transition to `resolved` is accepted only when both a non-empty finding and resolution are
   present. Historical inconsistent rows remain readable; a subsequent update must restore the
   invariant or move the case away from `resolved`.
5. `GET /v1/investigation-cases/:caseId/review` returns the typed projection.
   `GET /v1/investigation-cases/:caseId/review-packet` passes that same projection to
   `renderInvestigationCaseReviewPacket` and returns deterministic escaped Markdown.
6. The case page obtains the review through the server-only API client. Only the packet download is
   a browser mutation, and it carries the configured tenant header.

**Boundary/evidence review:** source repositories remain authoritative; the review service derives
current safe summaries at read time. The packet contains internal trace links and explicit
limitations, so it is an operator handoff artifact, not a public report. Relevant tests are
`packages/core/test/investigation-case-review.test.ts`,
`packages/db/test/investigation-cases.integration.test.ts`,
`apps/api/test/investigation-cases.test.ts`, and
`apps/web/tests/saved-investigation-cases.spec.ts`.

### 6b. Case-driven policy experiment

1. Case detail derives linked execution eligibility from `InvestigationCaseReview`; it does not
   fetch or serialize a full execution envelope into the client selector.
2. The focused client form reuses `ComparisonDraft`, presets, and
   `ComparisonVariationFields`. It submits one persisted execution evidence ID and one bounded
   `ReplayVariation`.
3. `POST /v1/investigation-cases/:caseId/comparisons` calls
   `InvestigationCaseExperimentService`. The coordinator proves the evidence belongs to the case,
   is an execution reference, and resolves through the same tenant.
4. The coordinator delegates to `ExecutionService.createComparison`, so replay capability,
   variation resolution, provider selection, unavailable comparison persistence, and ordinary
   execution continuation keep their established owners.
5. It then calls `InvestigationCaseService.addEvidence` with the experiment ID. A successful
   transaction stores the typed comparison link and metadata-only `case.comparison_started` event.
6. If that separate link fails, the comparison remains authoritative. The service records
   `case.comparison_link_failed` when possible and returns
   `comparison_created_link_failed` with a safe link-only recovery identifier.
7. `InvestigationCaseReviewService` reconstructs pending recovery from timeline failures and
   completions, current comparison evidence, and current tenant-scoped comparison reads. The
   bounded result survives API re-instantiation and server-rendered page reload.
8. Recovery uses the existing evidence-link endpoint. It does not call comparison creation again.
   The evidence transaction records `case.comparison_link_recovered`; once linked, the ordinary
   review and packet projection resolve the comparison and the pending section disappears.

**Boundary/evidence review:** comparison creation and case linking are intentionally non-atomic.
The case stores identifiers and timeline metadata only—never retained input, variation prose,
provider bodies, execution envelopes, or comparison copies. Client busy state prevents ordinary
double clicks, but exactly-once comparison creation is not claimed. Relevant tests are
`packages/core/test/investigation-case-experiments.test.ts`,
`packages/db/test/investigation-cases.integration.test.ts`,
`apps/api/test/investigation-cases.test.ts`, and
`apps/web/tests/case-driven-policy-experiments.spec.ts`.

## 7. API composition and errors

1. `apps/api/src/server.ts` constructs memory or PostgreSQL services and calls the stable
   `buildApp(options)` entrypoint.
2. `apps/api/src/app.ts` creates Fastify, installs redacted logging, and delegates CORS/Swagger to
   `plugins/platform.ts`.
3. `http/error-mapper.ts` installs the shared safe error handler before feature plugins.
4. Typed route plugins receive only their composed service dependencies.
5. `routes/execution-events.ts` owns SSE headers/cursor/client cleanup while `event-stream.ts` owns
   persisted-event polling and formatting.

**Boundary/evidence review:** process entry is `apps/api/src/server.ts`; `buildApp` is the stable
composition entrypoint. Fastify validation/error/status boundaries cross only through typed service
options. Persistence is reached through composed core ports, never from route SQL. Terminal
transport evidence is a typed HTTP response or safely mapped error; OpenAPI comes from the same
registered schemas. Relevant tests are `apps/api/test/*.test.ts`, especially
`config.test.ts`, `operations.test.ts`, and the feature route suites.

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

**Boundary/evidence review:** an App Router page is the entrypoint. It crosses the Next server/API
boundary through `server-api.ts`; the Workbench loader then calls the three bounded HTTP reads
concurrently. It writes nothing. Rendered terminal evidence is the resolved window, aggregate cards,
trend, provider observations, compact executions, and exact URL/saved scope. Relevant tests are
`apps/web/features/investigations/search-state.test.ts` and
`apps/web/tests/investigation-workbench.spec.ts`.

## 9. Live Machine and browser mutations

1. `useExecutionStream` opens the established header-bearing fetch stream after the latest persisted
   sequence, parses SSE frames, merges events without duplicates, reconnects, and refreshes the
   terminal snapshot.
2. `projectExecutionEvents` remains the pure authority for machine steps and actual event span.
3. `useEventPlayback` owns Timeline playback and changes only presentation state; readout, controls,
   machine route, and raw timeline render the selected persisted prefix. It makes no provider call,
   creates no execution, mutates no evidence, and uses no replay retention.
4. Browser mutations use `lib/client-api.ts` public configuration plus feature-specific requests.
5. Replay deletion remains in `features/executions/replay-controls.tsx`; comparison drafts become
   variations in `features/comparisons/comparison-draft.ts`.
6. Saved-case mutation names live in `features/investigation-cases/case-mutations.ts`; notes append,
   evidence remains linked, and route refreshes re-read authoritative state.

**Boundary/evidence review:** Live Machine enters through `useExecutionStream`; mutations enter
through focused Client Components. Browser requests cross only `client-api.ts` public
configuration, while route refreshes return to server reads. The event stream is read-only;
replay/comparison/case operations write through their existing API/core/persistence paths.
Terminal UI evidence remains authoritative persisted events or refreshed API state. Relevant tests
are live-machine unit tests plus `apps/web/tests/live-machine.spec.ts`,
`comparative-replay.spec.ts`, and `saved-investigation-cases.spec.ts`.

## 10. Operator guidance render and tour state

1. `/guide` renders `GuidePage` from plain workflow, scenario, glossary, and limitation data in
   `features/guidance/guide-content.ts`.
2. Existing route pages compose `ConceptHelp` and expose semantic `data-guide-anchor` values on
   product-owned sections.
3. `PageTour` reads only the current pathname and resolves one of six static tours through
   `resolveTourForPath`.
4. On explicit launch, `TourLauncher` inventories current anchors and calls the pure `prepareTour`.
5. Missing optional steps are skipped and reported. A missing required step stops with a named
   message.
6. Browser-only presentation state moves the step index, scrolls and annotates the current target,
   honors reduced motion, and restores focus on close.

**Boundary/evidence review:** the Guide and contextual content are server-rendered and require no API
read. The focused tour client imports only reviewable guidance data and pure state; it stores no
identity or evidence and performs no product mutation. Relevant tests are
`apps/web/features/guidance/guide-content.test.ts`, `tour-state.test.ts`, and
`apps/web/tests/operator-guidance.spec.ts`.
