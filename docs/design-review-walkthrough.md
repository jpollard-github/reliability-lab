# Reliability Lab Design-Review Walkthrough

This is an evidence-based owner walkthrough of the implemented repository. Use the shorter sections
for an introduction and the longer sections to trace code. Product direction belongs in the
[roadmap](roadmap.md); practical modifications belong in [change recipes](change-recipes.md).

## The 60-second explanation

Reliability Lab is an explainable reliability workbench for OpenAI-compatible LLM calls. It accepts
a tenant-routed execution, applies bounded retry, fallback, latency, and structured-output policy,
and records versioned append-only evidence for each decision. Work can continue in the API process
or through a PostgreSQL worker with atomic acceptance, leases, heartbeats, and fenced writes.
Eligible retained input becomes a current encrypted replay capability; it can drive an ordinary
replay or a controlled original-versus-variant comparison. Operators investigate bounded evidence
through the Workbench and preserve a question, interpretation, notes, and typed evidence references
as a saved case. A case can derive bounded current summaries for every link, expose five fixed
conclusion-readiness checks, enforce meaningful resolved state, and export the same safe projection
as a deterministic Markdown review packet.

A bounded post-Horizon-5 proof also exposes safe configured-provider capability evidence and,
only when an eligible live provider is configured, a separate cost-warned live submit path. That
path uses the same ordinary execution engine, events, detail, Timeline playback, replay,
comparison, Workbench, case, experiment, review, and packet surfaces as deterministic scenarios.

The important boundaries are equally explicit: this prototype does not establish factual answer
correctness, exactly-once provider effects, authenticated tenancy, RBAC, row-level security,
production KMS, universal provider health, empirical usability, or production readiness. The
bounded Horizon 5 workflow signal is established; those limits are visible in
[architecture](architecture.md#trust-boundaries) and [the roadmap](roadmap.md#roadmap-horizons).

## The five-minute architectural explanation

The main product loop is:

```text
Execute → Explain → Watch → Replay → Compare → Investigate → Preserve
```

1. **Execute.** `executionRoutes` in
   `apps/api/src/routes/executions.ts` validates `POST /v1/executions` and calls
   `ExecutionService.submit` in `packages/core/src/execution/execution-service.ts`.
2. **Explain.** `ExecutionRunner.#runPolicy` records attempts, normalized failures, retry,
   fallback, validation, and terminal decisions through `ExecutionEventRecorder`.
3. **Watch.** `executionEventRoutes` exposes persisted events through SSE. The browser's
   `useExecutionStream` merges them, while `projectExecutionEvents` produces the Live Machine.
4. **Replay.** `ReplayCapsuleStore.getForReplay` proves current capability. The PostgreSQL adapter
   decrypts only at the replay boundary; `ExecutionService.replay` submits another ordinary linked
   execution.
5. **Compare.** `resolveReplayVariation` fixes retained input and resolves bounded overrides.
   `projectComparison` reports evidence dimensions without a winner score.
6. **Investigate.** `InvestigationReadRepository` exposes bounded search, summary/trend, and
   provider/model observations. PostgreSQL uses three purpose-named query modules.
7. **Preserve.** `InvestigationCaseService` canonicalizes exact Workbench scope and stores bounded
   interpretation, append-only notes, and typed evidence links rather than copied envelopes.
   `InvestigationCaseReviewService` resolves current safe summaries and readiness; a resolved case
   requires both finding and resolution, and the packet renderer exports that projection with
   limitations and trace links.

Portable shapes live in `packages/contracts`; domain behavior and ports live in `packages/core`;
provider implementations live in `packages/providers`; PostgreSQL adapters live in `packages/db`;
Fastify and worker processes compose those parts in `apps/api` and `apps/worker`; `apps/web`
presents only API evidence. The [codebase tour](codebase-tour.md) is the complete source map.

## Package and process map

| Boundary           | Current owner                                                                                       | What crosses it                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Portable contracts | `packages/contracts/src/index.ts` and named contract folders                                        | Validated requests, envelopes, events, replay/comparison/investigation/case shapes |
| Domain policy      | `packages/core/src/execution/`, `durable/`, `comparison/`, `investigation/`, `investigation-cases/` | Commands, ports, normalized evidence, domain errors                                |
| Provider edge      | `packages/providers/src/provider-runtime.ts` and named adapters                                     | Safe capabilities; `ProviderRequest` in; normalized `ProviderResult` out           |
| PostgreSQL edge    | `packages/db/src/`                                                                                  | Port operations translated to rows, SQL, transactions, and ciphertext              |
| API process        | `apps/api/src/server.ts` and `apps/api/src/app.ts`                                                  | HTTP validation, tenant routing, status/error mapping, SSE                         |
| Worker process     | `apps/worker/src/server.ts`                                                                         | Claimed encrypted commands and guarded continuation                                |
| Operator console   | `apps/web/app`, `features`, and `lib`                                                               | Server reads, browser-safe mutations, persisted event presentation                 |

There are two execution processes, not two execution engines. In-process continuation and the
PostgreSQL worker both delegate to `ExecutionRunner` through `ExecutionService`; see
`packages/core/test/execution-service.test.ts` and
`packages/db/test/durable-execution.integration.test.ts`.

### Provider configuration is evidence, not health

`buildProviderRuntime` constructs the same providers for API and worker and emits a bounded safe
projection. `GET /v1/providers` returns it under tenant routing without a provider call. The
projection excludes endpoint, credential, headers, query strings, raw configuration, and request or
response bodies.

The home page always exposes deterministic fake-provider lab instruments. It exposes live execution
only for an eligible capability. The browser cannot choose an arbitrary live model or inject
failure. Core bounds live input, messages, schema, policy, and budget; the adapter rechecks the
server model, sends `store: false`, normalizes failures, and caps response bytes.

Timeline playback is presentation of recorded evidence only. Replay is a new linked execution using
retained input and therefore another provider call. Live retention stays default-deny. The generic
adapter keeps Chat Completions compatibility; ADR 0013 reserves an OpenAI-specific Responses adapter
as a separate future decision.

## The 15-to-30-minute repository walkthrough

### 1. Begin with contracts

Open `packages/contracts/src/execution/events.ts`. It distinguishes caller-provided named payloads
such as `AttemptFailedEventPayload` from stored `ExecutionEvent` values that also contain schema
version, event ID, execution ID, sequence, and time. `ExecutionEventRecorder.add` is the sole
generated-metadata boundary. `packages/core/test/execution-events.test.ts` proves construction,
persistence choice, and discriminator narrowing.

Then inspect:

- `execution/create-execution.ts` for runtime request validation;
- `execution/envelope.ts` for execution versus attempt evidence;
- `replay/capability.ts` for current replay states;
- `comparison/experiment.ts` for variation and projection contracts;
- `investigation/workbench.ts`, `investigation/cases.ts`, and `investigation/case-review.ts` for
  bounded reads, preservation, and derived review.

The root is an export map, not an implementation owner. The rationale is in
[TypeScript patterns](typescript-patterns.md#explicit-event-payloads-and-stored-events).

### 2. Trace one in-process execution

1. `executionRoutes` validates headers/body and calls `ExecutionService.submit`.
2. `ExecutionService.submit` hashes the request, handles idempotency/rate limits, and calls
   `prepareExecution` in `execution-builder.ts`.
3. `prepareExecution` creates the initial envelope and accepted evidence with
   `ExecutionEventRecorder.add`.
4. `ExecutionRepository.create` persists acceptance. In-process mode then starts
   `ExecutionRunner.continueNewExecution` and returns a submission containing the running envelope
   and completion promise.
5. `ExecutionRunner.#runPolicy` checks the continuation guard and budgets, records
   `attempt.started`, and invokes `LlmProvider.execute`.
6. Provider-specific outcomes are normalized in `packages/providers/src/index.ts`. The runner
   records `attempt.failed`, uses `calculateRetryDelay`, or records `fallback.selected`.
7. Successful output is optionally checked by `StructuredOutputValidator`. Success becomes
   `succeeded` or `degraded`; `ExecutionFailureRecorder.fail` owns terminal normalized failure.
8. `ExecutionEventRecorder.append` sends an append-only event to `ExecutionRepository.appendEvent`;
   projection changes go through `ExecutionRepository.update`.

Terminal evidence is `execution.succeeded` or `execution.failed` plus the current envelope status.
Focused proof is in the retry, fallback, validation, latency, circuit, and acceptance tests in
`packages/core/test/execution-service.test.ts`; HTTP mapping is exercised in
`apps/api/test/executions.test.ts`.

### 3. Trace one PostgreSQL-worker execution

1. `ExecutionService.submit` detects its `DurableAcceptancePort` and delegates to
   `PostgresDurableExecutionStore.acceptExecution`.
2. `acceptExecution` writes the initial execution, accepted/queued events, AES-256-GCM command job,
   and optional idempotency record in one PostgreSQL transaction.
3. `apps/worker/src/server.ts` calls `DurableExecutionWorker.runOnce` from its bounded polling loop.
4. `runOnce` calls `DurableJobStore.claimNext`. PostgreSQL selects a pending/expired job with
   `FOR UPDATE SKIP LOCKED`, increments `claimCount`, and returns it as `JobClaim.claimVersion`.
5. `LeaseHeartbeatController` serializes renewal observations, tracks the confirmed deadline, and
   implements `ExecutionContinuationGuard`.
6. The worker calls `ExecutionService.continueAcceptedExecution`; the same `ExecutionRunner`
   performs provider policy while checking the guard before and after externally meaningful work.
7. `PostgresDurableExecutionStore.finish` matches tenant, execution, worker, unexpired lease, and
   exact claim version before terminal cleanup. A stale claim gets `ownership_lost`.
8. Reclaimed nonterminal work with attempt activity becomes explicit ambiguity rather than an
   automatic second provider call.

The guarantee is restart-durable acceptance and stale-claim fencing. It is not exactly-once provider
effects: PostgreSQL cannot transact with a remote provider, and abort cannot prove that the provider
did nothing. Tests:

- `packages/core/test/lease-safety.test.ts`;
- `packages/core/test/execution-service.test.ts` under “durable execution continuation”;
- `packages/db/test/durable-execution.integration.test.ts`;
- `apps/web/tests/execution-lifecycle.spec.ts`.

### 4. Follow persisted evidence into Live Machine

`ExecutionEventRecorder.append` and the execution repository are the write side.
`executionEventRoutes` and `followExecutionEvents` in `apps/api/src/event-stream.ts` are the read
side. The SSE route backfills after the greatest query/header cursor, follows persisted events,
sends heartbeat comments, and closes at terminal evidence.

The browser cannot use native `EventSource` because the prototype tenant is a request header.
`useExecutionStream` therefore uses fetch streaming, `extractSseFrames`, and
`mergeExecutionEvents`. `projectExecutionEvents` maps only persisted events into operator steps.
`useEventPlayback` selects a recorded prefix and never changes domain time or invents events.

Proof lives in `apps/api/test/event-stream.test.ts`,
`apps/api/test/execution-events.test.ts`,
`apps/web/features/live-machine/execution-machine.test.ts`,
`apps/web/features/live-machine/use-event-playback.test.ts`, and
`apps/web/tests/live-machine.spec.ts`.

### 5. Review replay capability and encryption

`ReplayCapsuleStore` in `packages/core/src/replay/replay-store.ts` defines `store`, `inspect`,
`getForReplay`, and `delete`. Capability is current store evidence, not a historical boolean.
`PostgresReplayCapsuleStore`:

- calls `encryptReplayCapsule` before insert;
- uses AES-256-GCM with a fresh nonce;
- binds purpose, tenant, execution, payload schema, and key version as authenticated context;
- supports read-old/write-current key versions;
- reports expiry, deletion, missing keys, and unreadable ciphertext as explicit capability states;
- writes metadata-only lifecycle audits.

`ExecutionService.replay` calls `getForReplay`, rejects unavailable capability honestly, and submits
an ordinary linked execution when available. Proof is in
`packages/db/test/replay-crypto.test.ts`,
`packages/db/test/replay-vault.integration.test.ts`, and the replay section of
`packages/core/test/execution-service.test.ts`.

Environment keyrings are prototype key management, not KMS or envelope encryption. Deletion revokes
capability but does not prove physical backup erasure; see
[ADR 0004](adr/0004-postgres-encrypted-replay-vault.md).

### 6. Review Comparative Replay

`ExecutionService.createComparison` reads original evidence and replay capability.
`resolveReplayVariation` combines bounded requested overrides with safe original configuration and
rejects an accidental no-op. PostgreSQL worker mode atomically accepts the experiment, linked
variant, replay evidence, and durable job; in-process mode keeps a deliberate two-operation
boundary. `PostgresComparisonExperimentRepository` persists safe experiment definitions, never
retained input.

`ExecutionService.getComparison` loads both ordinary envelopes and calls `projectComparison`.
Dimensions report original, variant, change classification, and explanation. Missing usage remains
unavailable, route/token changes remain tradeoffs, and no semantic judge or universal winner is
invented.

The App Router page `apps/web/app/comparisons/[experimentId]/page.tsx` composes
`ComparisonConfigurations`, `ComparisonMachines`, and `ComparisonSummary`. Proof is in
`packages/core/test/comparison.test.ts`,
`packages/db/test/comparison-repository.integration.test.ts`,
`apps/api/test/comparisons.test.ts`, and
`apps/web/tests/comparative-replay.spec.ts`.

### 7. Review the Investigation Workbench

`apps/web/features/investigations/search-state.ts` resolves exact URL-backed range and filters.
`loadInvestigationWorkbench` builds bounded API parameters and starts summary, provider, and
execution reads with `Promise.all`.

The API route family calls `InvestigationReadRepository`. PostgreSQL delegates to:

- `execution-search-query.ts` for a bounded page plus fixed count;
- `reliability-summary-query.ts` for aggregate plus trend;
- `provider-observations-query.ts` for attempt-level provider/model evidence.

`investigation-conditions.ts` owns tenant/time/filter predicates; core `signals.ts` and the memory
adapter define storage-independent semantics. Outcome denominators use terminal executions.
Provider observations use completed attempts and small-sample labels; neither is a universal health
claim. The compatibility `PostgresExecutionRepository.list` remains deliberately unbounded and is
not an analytics path.

Proof is in `packages/core/test/investigation.test.ts`,
`packages/db/test/investigation-read.integration.test.ts`,
`apps/api/test/investigations.test.ts`,
`apps/api/test/query-values.test.ts`,
`apps/web/features/investigations/search-state.test.ts`, and
`apps/web/tests/investigation-workbench.spec.ts`.

### 8. Review Saved Investigation Cases

`InvestigationCaseService.create` canonicalizes exact scope with `canonicalizeSavedScope`.
`evidence.ts` validates typed execution, comparison, or provider-observation references and builds
internal URLs. Cases store bounded current interpretation and references; they do not copy
envelopes, prompts, outputs, attempts, events, commands, or capsules.

`case-command-transactions.ts` owns atomic case creation/update, append-only note insertion,
idempotent evidence linking/removal, and metadata-only timeline events. `case-detail-query.ts`
hydrates current case state, notes, evidence, timeline, and the saved Workbench URL.
`CaseTimeline` renders that metadata, and “Open saved workbench scope” follows
`detail.links.savedWorkbench`.

`InvestigationCaseReviewService` resolves those references against their current authoritative
ports and returns bounded execution, comparison, and provider-observation summaries. Every link is
represented as available or explicitly unavailable. `projectConclusionReadiness` checks exact
scope, linked evidence, reviewed references, finding, and resolution without scoring correctness.
`InvestigationCaseService.update` refuses a resolved state unless finding and resolution are both
non-empty. `CaseEvidenceReview` and `ConclusionReadiness` render in the server response;
`renderInvestigationCaseReviewPacket` produces escaped deterministic Markdown from the same
projection.

`InvestigationCaseExperimentService` turns the case into a bounded experiment workspace without
making it an experiment store. It proves a persisted execution evidence reference belongs to the
case and tenant, delegates one ordinary comparison to `ExecutionService`, and then links the
experiment through `InvestigationCaseService`. Replay availability and variation semantics are not
reimplemented. A separate link failure preserves the comparison, returns
`comparison_created_link_failed`, and offers evidence-link recovery with the existing experiment
ID. The derived review rebuilds pending recovery after reload from timeline events, current case
evidence, and tenant-scoped comparison reads. Linking records
`case.comparison_link_recovered`, so later intentional evidence removal does not resurrect the old
failure. All three lifecycle events carry metadata only.

Proof is in `packages/core/test/investigation-cases.test.ts`,
`packages/core/test/investigation-case-review.test.ts`,
`packages/core/test/investigation-case-experiments.test.ts`,
`packages/db/test/investigation-cases.integration.test.ts`,
`apps/api/test/investigation-cases.test.ts`, and
the saved-case and case-driven experiment browser workflows.

No author is recorded because `X-Tenant-Id` is routing context, not a person. Notes are append-only;
evidence removal removes only the association; archive is the current retention action.

### 9. Review API and persistence composition

`apps/api/src/server.ts` selects memory or PostgreSQL adapters and constructs services.
`apps/api/src/app.ts` creates Fastify, installs platform plugins and `installErrorHandler`, and
registers typed route plugins. Routes own HTTP paths, schemas, status codes, and safe logs. Core owns
policy; DB owns SQL, row mapping, transactions, and crypto. `apps/api/test/support/build-test-app.ts`
is the focused injection-test composition.

`packages/db/src/database/database.ts` is the connection boundary. Schema lives under `schema/`;
execution and comparison row translation lives beside those repositories; investigation reads and
case commands have purpose-named query/transaction modules. See
[Persistence and API patterns](persistence-and-api-patterns.md).

### 10. Review operator-console server/client boundaries

Route `page.tsx` files are Server Component composition roots. Initial reads use
`apps/web/lib/server-api.ts`, which imports the Next `server-only` marker, uses server tenant
configuration, and disables caching. Browser interaction uses `apps/web/lib/client-api.ts`, public
configuration, and feature-owned mutation helpers.

Client islands are limited to forms, replay/comparison controls, live stream/playback, and
saved-case mutations. Server-rendered evidence stays outside those islands. The structural audit in
`scripts/check-source-structure.mjs` rejects obvious client imports of server-only modules and
detectable same-feature runtime cycles. See [Operator Console patterns](operator-console-patterns.md).

## Test and verification strategy

| Layer                  | Claim it supports                                                  | Representative evidence                          |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| Unit                   | Local policy, projections, parsers, crypto, lease behavior         | `packages/core/test/`, focused package/app tests |
| PostgreSQL integration | Transactions, SQL semantics, ciphertext, restart reads, fencing    | `packages/db/test/*.integration.test.ts`         |
| API injection          | Validation, routes, status/error/OpenAPI behavior                  | `apps/api/test/`                                 |
| Playwright             | Established operator workflows across API, worker, DB, and browser | `apps/web/tests/*.spec.ts`                       |
| Structure audit        | Package/API/web composition and navigability                       | `scripts/check-source-structure.mjs`             |
| Documentation audit    | Portable links and required ownership teaching surface             | `scripts/check-documentation.mjs`                |
| Full verification      | The repository agrees across all established layers                | `pnpm verify:full`                               |
| Handoff export         | Reviewed non-ignored source plus per-file hashes                   | `scripts/export-repo.mjs`                        |

Use focused checks while changing one owner. Use integration tests when SQL, transactions,
encryption persistence, or durable ownership changes. Use E2E when routes, process boundaries, URL
semantics, accessibility, or an operator workflow changes. [Change recipes](change-recipes.md)
names the expected layers for representative work.

## Key choices and tradeoffs

| Choice                                     | Why it fits now                                                   | Cost or boundary                                       |
| ------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------ |
| Explicit event payloads                    | Central evidence is readable without conditional-type archaeology | Some type repetition                                   |
| Append-only events plus mutable projection | History remains explainable while current reads stay practical    | No universal transactional outbox                      |
| Bounded retry and fallback                 | Recovery decisions are finite and observable                      | Policy cannot guarantee a good answer                  |
| PostgreSQL durable acceptance              | Execution, idempotency, job, and evidence can commit together     | PostgreSQL is not claimed as a universal queue         |
| Lease fencing                              | Stale claims cannot mutate or finish the current job              | External provider effect can remain ambiguous          |
| Encrypted replay capability                | Sensitive input is retained only under explicit current policy    | Key, expiry, deletion, and unreadable-state complexity |
| Dimension-level comparison                 | Evidence tradeoffs stay visible                                   | Operator interpretation is required                    |
| Bounded investigation read models          | Query cost and semantics are explicit                             | Compatibility list remains unbounded                   |
| URL-backed Workbench state                 | Scope is bookmarkable, returnable, and preservable                | Parameter compatibility must be maintained             |
| Evidence-linked cases                      | Source evidence stays authoritative and is not duplicated         | A case can outlive replay capability                   |
| Derived case review and Markdown packet    | UI and handoff share one bounded current projection               | Internal trace artifact, not a public or truth report  |
| Fixed readiness checks                     | Workflow completeness is legible without a fake score             | Readiness cannot establish correctness or causation    |
| Server/browser API split                   | Private configuration cannot drift into client code               | Two intentionally small access modules                 |

## Guarantees and non-guarantees

| Guarantee                                                       | Evidence                                                                           | Non-guarantee and reason                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Worker-mode `202` follows atomic durable acceptance             | `PostgresDurableExecutionStore.acceptExecution`; durable integration rollback test | No promise for in-process continuation after API loss                            |
| Stale claims are fenced from heartbeat, finish, and cleanup     | Exact `claimVersion` predicates; lease safety and durable integration tests        | No exactly-once provider call because the provider is outside the DB transaction |
| Execution decisions are append-only evidence                    | `ExecutionEventRecorder`; event and repository tests                               | No general outbox makes every projection/event/process boundary atomic           |
| PostgreSQL replay payload is encrypted at rest                  | `encryptReplayCapsule`; replay crypto/vault tests                                  | Environment keys are not production KMS or envelope encryption                   |
| Reads and references carry tenant predicates                    | repository ports/adapters and cross-tenant tests                                   | Tenant header is not authenticated identity or DB-enforced RLS                   |
| Investigation queries are bounded by tenant and `[from,to)`     | named PostgreSQL query modules and fixed-query integration test                    | Results are selected evidence, not an SLA or universal provider health           |
| Saved notes are append-only and evidence is referenced          | case service/transactions/tests                                                    | Case prose is plaintext and has no authenticated author                          |
| Resolved cases have a finding and resolution                    | case service invariant and unit/API/browser tests                                  | The content is operator interpretation, not verified truth                       |
| Review items never silently lose linked evidence                | review contracts/service and unit/API/integration tests                            | A source can be explicitly unavailable at review time                            |
| Case experiment results return to evidence or explicit recovery | case experiment coordinator and unit/API/browser tests                             | Comparison creation and case linking are not atomic or exactly once              |
| Replay deletion revokes current capability                      | vault adapter and replay tests                                                     | Tombstoning does not guarantee physical backup erasure                           |

## Current limitations

- The tenant header is transparent routing context; there is no authentication, authorization,
  RBAC, or PostgreSQL row-level security.
- Remote provider calls are not exactly once, and ambiguous claimed work is not resumable.
- In-process accepted work can be lost with the API process.
- There is no cancellation, dead-letter/operator recovery workflow, or general transactional
  outbox.
- Rate limiting and circuit state are process-local; Redis implementations are unwired skeletons.
- Environment keyrings are not managed KMS; replay deletion is not physical backup erasure.
- Cost is normalized but not enforced.
- Provider observations are bounded evidence summaries, not universal health or confidence claims.
- Conclusion readiness is deterministic workflow completeness, not factual correctness, causation,
  or a confidence score. Review packets contain internal links and are not public-safe reports.
- Case-driven comparison creation and the later evidence link are not atomic. Browser busy state
  does not provide exactly-once creation across clients or retried requests.
- The compatibility execution list is unbounded.
- There is no broad scenario catalog or configured external trace/log investigation integration.
- The bounded Horizon 5 workflow signal is established by an internal heuristic drill; it is not
  empirical usability evidence or a production-readiness claim.

## What comes next

The on-demand Guide, contextual help, route-specific tours, supported-conclusion workflow, and
single case-driven policy experiment are established bounded movements. The operator drill from
recorded failure through investigation, comparison, linked evidence, and supported human conclusion
establishes the bounded Horizon 5 signal. Broader scenario catalogs, statistical campaigns,
external trace/log investigation integration, universal provider health, and generic recovery
remain future candidates. See [the roadmap](roadmap.md#near-term-direction).

## Suggested interview questions and honest answers

**What problem does Reliability Lab solve?** It explains how an application handled an LLM call
under expected failures and lets retained cases be replayed, compared, investigated, and preserved.
It does not judge factual answer quality. Evidence: `ExecutionEnvelope`, `ExecutionRunner`, and the
product loop above.

**What does reliability mean here?** Predictable, bounded, and explainable handling of normal
operation and expected provider failure. It is evidenced by policy decisions, normalized outcomes,
budgets, and terminal execution state; it is not factual correctness. Evidence:
`docs/reliability-lab-basics.md` and `ExecutionRunner`.

**What is an execution versus an attempt?** An execution is the whole accepted lifecycle; an
attempt is one provider/model call inside it. Evidence:
`packages/contracts/src/execution/envelope.ts`.

**Why append-only events?** They preserve the decision order that a mutable status alone would
destroy. A separate current projection keeps reads practical. Evidence:
[ADR 0002](adr/0002-append-only-execution-events.md).

**Why is replay a capability?** Retention can be disabled, expired, deleted, missing a key, or
unreadable. Only the vault can report current availability. Evidence: `ReplayCapsuleStore` and
[ADR 0003](adr/0003-replay-data-retention.md).

**Why is comparison multi-dimensional?** Outcome, route, attempts, failure, latency, validation,
usage, and exact output can disagree; one score would hide the tradeoff. Evidence:
`projectComparison` and `packages/core/test/comparison.test.ts`.

**Why PostgreSQL worker execution?** It lets acceptance, evidence, idempotency, and the encrypted
job commit together without adding another queue before the workflow requires one. Evidence:
[ADR 0007](adr/0007-durable-postgres-execution-foundation.md).

**What does fencing guarantee?** Only the exact current claim may renew, finish, or clear its job.
It does not prove whether a remote provider acted. Evidence: `claimVersion` predicates and lease
tests.

**What remains ambiguous?** A worker can lose observable ownership after a provider received a
request but before the outcome was safely persisted. The recovery path records
`attempt.outcome_ambiguous` and `provider_call_outcome_unknown` rather than calling again.
Evidence: `DurableExecutionWorker`, `ExecutionRunner` guard checks, and the durable integration
ambiguity tests.

**Why bounded investigation read models?** They answer explicit operator questions without
hydrating every envelope, attempt/event array, or replay capability. Evidence:
[ADR 0008](adr/0008-investigation-read-model-and-metric-semantics.md).

**Why save references rather than copied evidence?** References keep authoritative source evidence
current and avoid a second sensitive retention store. Evidence:
[ADR 0009](adr/0009-saved-investigation-cases-and-evidence-references.md).

**Why split server and client API modules?** Server reads can use private configuration and
server-only behavior; browser mutations can use only public configuration. Evidence:
`apps/web/lib/server-api.ts`, `client-api.ts`, and the structural audit.

**What is the largest deliberate limitation?** The tenant value is not authenticated identity.
That limits production trust, authorship, and isolation claims even though reads are routed by
tenant.

**What comes next?** The bounded Horizon 5 workflow is established. Broader scenario catalogs,
external telemetry correlation, statistical campaigns, universal provider-health views, and
generic recovery remain candidates; Horizon 6 identity guarantees have not begun.
