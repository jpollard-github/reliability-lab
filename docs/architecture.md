# Architecture

## Components and data flow

`apps/api` validates transport contracts, extracts the tenant boundary, and maps domain errors to
HTTP. `apps/worker` is the separate durable continuation process. `packages/core` owns acceptance
preparation, continuation, provider policy, events, replay capability, and comparison behavior
through ports. `packages/providers` implements deterministic fake and focused OpenAI-compatible
HTTP adapters. `packages/db` stores execution evidence, durable jobs, comparison experiments, and
the separately encrypted PostgreSQL Replay Vault. `apps/web` talks only to the API and never
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

The Live Machine View uses tenant-scoped SSE. The API reads ordered events after a sequence cursor,
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

The focused `/v1/investigations/executions`, `/summary`, and `/providers` endpoints return the exact
resolved range. The list query is one bounded SQL statement, summary uses two fixed statements
(aggregate plus trend), and provider observations use one statement. None inspects replay
capability or selects prompts, outputs, event arrays, attempt arrays, command ciphertext, or replay
capsules. Full envelopes remain the detail-page contract.

Outcome rates divide succeeded, degraded, and failed counts by all terminal outcomes, including the
reserved cancelled status when present. Queued and running are reported as in flight. Provider/model
observations use attempts, exclude running attempts from their observed success denominator, expose
sample size, and deliberately assign no health score.

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
