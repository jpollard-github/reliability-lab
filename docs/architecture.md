# Architecture

## Code organization

The architecture is reflected in named source modules rather than implemented inside package
barrels. The contracts, core, and DB package roots are public export maps. Internal modules import
the file that directly owns each symbol.

Contracts are grouped into execution, replay, comparison, Investigation Workbench, and saved-case
families. Core separates the public `ExecutionService` facade from execution preparation, event
construction, guarded provider policy, structured-output validation, backoff, durable lease
control, replay retention, comparison projection, investigation reads, and saved-case behavior.
DB separates connection creation, domain schema definitions, repositories, mapping, fixed read
queries, transactions, runtime configuration, and cryptographic lifecycles. API separates a small
Fastify composition root, platform plugins, safe error mapping, TypeBox schemas, query parsing, and
feature route plugins.

See the [codebase tour](codebase-tour.md) for the current tree and the
[system-flow guide](system-flows.md) for concrete call paths. Phase 2 establishes the persistence
and API structure; web component and Playwright-suite reorganization remains Phase 3.

## Components and data flow

`apps/api/src/app.ts` composes platform and feature route plugins. Those plugins validate transport
contracts, extract the tenant boundary, and map domain errors to HTTP. `apps/worker` is the separate
durable continuation process. `packages/core` owns acceptance
preparation, continuation, provider policy, events, replay capability, and comparison behavior
through ports. `packages/providers` implements deterministic fake and focused OpenAI-compatible
HTTP adapters. `packages/db` stores execution evidence, durable jobs, comparison experiments, saved
investigation cases, and the separately encrypted PostgreSQL Replay Vault. `apps/web` talks only to
the API and never
receives command or capsule bodies.

`EXECUTION_MODE=in_process` is the infrastructure-free default: the API persists acceptance,
returns `202`, and continues in that process. In `postgres_worker`, one PostgreSQL transaction
persists a queued execution, accepted/queued events, encrypted command job, and optional
idempotency record before `202`. A worker later claims the row with `FOR UPDATE SKIP LOCKED`,
decrypts the command, and invokes the same core continuation operation used by in-process mode.

Replay asks the tenant-scoped capsule port for a current capability, decrypts only inside the
PostgreSQL adapter when replay is requested, and invokes the normal acceptance path. Comparative
replay accepts only provider, model, policy, and budget variation—not replacement input. It resolves
omitted values against original conditions. In worker mode the variant, linkage events, encrypted
job, and experiment definition commit in one transaction. The original and variant remain ordinary
execution envelopes; comparison is a pure read projection, not a second event system or a winner
score.

The Live Machine View uses tenant-scoped SSE. `routes/execution-events.ts` owns HTTP cursor,
headers, abort, and close behavior; `event-stream.ts` reads ordered events after a sequence cursor,
backfills persisted history, polls for new evidence, sends heartbeat comments, and closes after
terminal evidence. The browser uses fetch streaming rather than native `EventSource` because the
prototype tenant boundary is a request header. Worker-produced queue, claim, attempt, terminal, and
recovery events use this same path.

## Investigation read boundary

`InvestigationReadRepository` is a framework-independent read port beside, not inside, execution
mutation policy. The memory adapter projects small local data sets from envelopes. The PostgreSQL
adapter selects compact execution fields, uses event `EXISTS` projections for derived signals,
aggregates attempt JSONB by provider/model, and calculates p50/p95 with PostgreSQL percentile
functions. Search uses an opaque cursor ordered by `created_at DESC, id DESC`; every query includes
tenant and half-open time predicates.

The PostgreSQL shell delegates to `execution-search-query.ts`,
`reliability-summary-query.ts`, and `provider-observations-query.ts`. Search conditions and signal
predicates live in `investigation-conditions.ts`; row mapping and raw SQL value conversion remain
separate named boundaries.

The focused `/v1/investigations/executions`, `/summary`, and `/providers` endpoints return the exact
resolved range. Execution search uses one bounded page statement plus one fixed count statement,
summary uses two fixed statements
(aggregate plus trend), and provider observations use one statement. None inspects replay
capability or selects prompts, outputs, event arrays, attempt arrays, command ciphertext, or replay
capsules. Full envelopes remain the detail-page contract.

Outcome rates divide succeeded, degraded, and failed counts by all terminal outcomes, including the
reserved cancelled status when present. Queued and running are reported as in flight. Provider/model
observations use attempts, exclude running attempts from their observed success denominator, expose
sample size, and deliberately assign no health score.

The summary name `providerUnavailableFailures` describes executions with any attempt normalized as
`provider_unavailable`. That category includes generic upstream outages and explicit unavailable
responses; it is not presented as provider capacity. A future capacity count requires a distinct,
stable normalized code with explicit capacity evidence.

## Saved investigation case boundary

`InvestigationCaseService` is a framework-independent orchestrator beside execution policy and the
investigation read model. It canonicalizes an exact saved range and filters, validates execution and
comparison ownership through their existing tenant-scoped repositories, and coordinates case state,
append-only notes, evidence associations, and metadata timeline events. Memory and PostgreSQL case
repositories implement the same contract.

PostgreSQL persists `investigation_cases`, `investigation_case_notes`,
`investigation_case_evidence`, and `investigation_case_events`. Case updates and their timeline
events are transactional; note/evidence mutations and their lifecycle events are transactional.
Evidence rows contain typed identifiers or a canonical provider/model/range reference, never copied
execution envelopes. Case pages use `updated_at DESC, id DESC`, an opaque two-field cursor, and a
separate fixed total query so an empty terminal page still reports all matching cases.

`case-list-query.ts` owns paging/count SQL, `case-detail-query.ts` owns hydration, and
`case-command-transactions.ts` owns current-state, note, evidence, and timeline transactions.

The current case record holds title, question, status, optional importance, finding, resolution, and
resolved time. Notes have no update/delete path. Timeline metadata records IDs, evidence types,
changed field names, presence booleans, and status transitions; it does not duplicate note, finding,
or resolution prose. Archive is the retention action; there is no hard-delete endpoint.

## Durable job boundary

The durable job row is a scheduling record, not replay retention. It stores safe lease metadata and
AES-256-GCM ciphertext under AAD containing purpose `execution_command`, tenant, execution, schema
version, and command-key version. A fresh 12-byte nonce is used per write. The command keyring is
independent from Replay Vault configuration.

Pending and expired jobs are claimed transactionally. `claimCount` is the monotonically increasing
claim version and fencing token, not just a delivery statistic. The worker ID says who owns a claim;
the version says which claim is current. Heartbeat, ownership assertion, terminal finish, and command
cleanup match tenant, execution, leased status, owner, and exact version. They also require an
unexpired lease. A zero-row mutation is explicit ownership loss, never success.

The worker observes serialized heartbeat outcomes and tracks the most recently confirmed lease
deadline. Heartbeats never overlap. A transient database failure may be retried only while that
deadline remains valid; explicit ownership loss or inability to confirm by the deadline aborts the
generic continuation guard. The policy engine checks that guard before attempts, provider calls,
outcome persistence, retry/backoff, fallback, validation, terminal transitions, and replay
completion. Retry sleep and provider requests receive the cancellation signal. A latency-budget
abort remains execution evidence; lease cancellation is runtime ownership evidence and is not
normalized as a provider timeout.

An expired lease with no attempt can be reclaimed. A terminal execution is reconciled without rerun.
Any reclaimed nonterminal execution with prior attempt activity is conservatively failed as
`provider_call_outcome_unknown`, with recovery and ambiguity events, instead of risking a duplicate
provider call. The stale worker is not authorized to append lease-loss evidence; it stops locally,
and the current owner records recovery evidence.

Terminal handling clears command ciphertext, nonce, and tag and records a deletion time. Replay
capsule expiry and deletion are independent.

## Replay vault boundary

The replay port requires tenant ID and execution ID for store, inspect, read-for-replay, and delete.
Its capability states are `available`, `retention_disabled`, `expired`, `deleted`, `missing`,
`key_unavailable`, and `unreadable`. Reads hydrate current store state, so a persisted compatibility
boolean cannot keep an expired or deleted capsule replayable.

The PostgreSQL adapter stores AES-256-GCM ciphertext, a fresh nonce, authentication tag, payload
schema version, key version, expiry, and deletion time. AAD binds tenant, execution, payload schema,
and key version. Audit rows contain identity and lifecycle metadata only. Memory replay storage
remains process-local. PostgreSQL worker mode requires the PostgreSQL replay store so API and worker
share replay capabilities.

## Trust boundaries

- **Caller to API:** bodies, headers, tenant IDs, idempotency keys, and JSON Schemas are untrusted.
  TypeBox/Ajv validates shape and bounds. The tenant header is routing context, not identity.
- **Worker to provider:** prompt data crosses the external boundary only inside a provider adapter.
  Keys and bodies do not appear in logs or spans.
- **Service to persistence:** caller-facing execution and comparison reads are tenant scoped. Replay
  access includes tenant/execution identity; command AAD binds the same identity.
- **Comparison persistence:** definitions include requested variation and resolved non-sensitive
  conditions, never retained input or cryptographic material.
- **Case persistence:** bounded operational prose is plaintext, while evidence is typed references.
  No prompt, output, capsule, command, ciphertext, credential, raw provider body, or arbitrary URL is
  accepted. The tenant header is not an authenticated author.
- **Command and replay storage:** plaintext exists transiently only while encrypting/decrypting or
  calling a provider. It is not a metadata column, API response, audit field, log, or span.
- **Dashboard:** the fixed development tenant is not authentication. The browser receives typed,
  operator-safe event records only.

## Failure and consistency boundaries

Worker mode makes acceptance durable, including comparison variants and concurrency-safe
idempotency. Claim fencing prevents an older claim from extending, finishing, or deleting the
current claim, and the post-provider ownership assertion prevents a known-stale worker from
persisting the returned outcome. It does not make provider calls exactly once: PostgreSQL and the
remote provider share no transaction, and aborting an HTTP request cannot prove the provider did
nothing. The recovery slice stops conservatively after ambiguous attempt activity and cannot resume
midway through policy evaluation. Event inserts and mutable projection updates during continuation
remain separate operations rather than a general transactional outbox.

In-process mode intentionally retains its simpler consistency boundary. Variant execution creation
and experiment persistence are separate there, and accepted work can be lost with the API process.
Distributed rate/circuit state, cancellation, dead-letter tools, and authenticated operator
recovery remain on the [roadmap](roadmap.md).

The compatibility `/v1/executions` route still hydrates full envelopes and replay capability and is
not an analytics path. The root page and Investigation Workbench use the bounded investigation read
model, avoiding that route's unpaginated replay-capability hydration pattern.
