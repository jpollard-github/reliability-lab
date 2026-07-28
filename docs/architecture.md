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

## Durable job boundary

The durable job row is a scheduling record, not replay retention. It stores safe lease metadata and
AES-256-GCM ciphertext under AAD containing purpose `execution_command`, tenant, execution, schema
version, and command-key version. A fresh 12-byte nonce is used per write. The command keyring is
independent from Replay Vault configuration.

Pending and expired jobs are claimed transactionally. A valid lease is exclusive, heartbeats extend
it, and claim count records delivery. An expired lease with no attempt can be reclaimed. A terminal
execution is reconciled without rerun. Any reclaimed nonterminal execution with prior attempt
activity is conservatively failed as `provider_call_outcome_unknown`, with recovery and ambiguity
events, instead of risking a duplicate provider call.

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
idempotency. It does not make provider calls exactly once: PostgreSQL and the remote provider share
no transaction. The first recovery slice stops conservatively after ambiguous attempt activity and
cannot resume midway through policy evaluation. Event inserts and mutable projection updates during
continuation remain separate operations rather than a general transactional outbox.

In-process mode intentionally retains its simpler consistency boundary. Variant execution creation
and experiment persistence are separate there, and accepted work can be lost with the API process.
Distributed rate/circuit state, cancellation, dead-letter tools, and authenticated operator
recovery remain on the [roadmap](roadmap.md).

Execution-list replay-capability hydration is currently an N+1 query pattern. That is acceptable for
the unpaginated prototype; a larger system should paginate and batch capability metadata without
exposing encrypted bodies.
