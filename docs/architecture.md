# Architecture

## Components and data flow

`apps/api` is the composition root. It validates transport contracts, extracts the tenant boundary,
constructs provider and persistence adapters, and maps domain errors to HTTP. `packages/core` owns
execution and replay-capability policy through ports. `packages/providers` implements the
deterministic fake and focused OpenAI-compatible HTTP adapters. `packages/db` stores execution
evidence and implements the encrypted PostgreSQL replay vault. `apps/web` talks only to the API and
never receives capsule bodies.

A submission flows API → idempotency lookup → persisted running envelope and acceptance event →
`202` response. The execution service then continues in the API process through capsule retention
decision → provider attempt(s) → structured validation → append-only events/current-state
projection. Replay first asks the tenant-scoped capsule port for a current capability, decrypts only
inside the PostgreSQL adapter when replay is actually requested, invokes the normal execution path,
links the new envelope to the original, and compares normalized outcomes.

The live machine view uses a tenant-scoped SSE endpoint at the API boundary. It reads ordered events
after a sequence cursor from the execution repository, backfills persisted history, polls for new
persisted evidence, sends heartbeat comments, and closes after terminal evidence. The browser uses
fetch streaming rather than native `EventSource` because the prototype tenant boundary is a request
header. Core exposes only an event-cursor repository operation and has no SSE or browser concepts.

## Replay vault boundary

The replay port requires tenant ID and execution ID for store, inspect, read-for-replay, and delete.
Its capability states are `available`, `retention_disabled`, `expired`, `deleted`, `missing`,
`key_unavailable`, and `unreadable`. Execution detail and list reads hydrate this value from the
current store state, so the persisted compatibility boolean cannot keep an expired or deleted
capsule replayable.

The PostgreSQL adapter stores AES-256-GCM ciphertext, a fresh 12-byte nonce, authentication tag,
payload schema version, key version, expiry, and deletion time. Authenticated additional data binds
tenant, execution, payload schema, and key version. Audit rows contain only identity and lifecycle
metadata. Capsule mutation plus its audit record is transactional; the execution projection update
is a separate repository operation, so this slice does not claim cross-port atomicity.

Memory replay storage follows tenant, expiry, and deletion semantics for deterministic development,
but remains process-local. PostgreSQL is selected only with `REPLAY_CAPSULE_STORE=postgres` and valid
database/keyring prerequisites. Live retention cannot start in memory mode and a live request is not
sent to a provider if required capsule persistence fails.

## Trust boundaries

- **Caller to API:** bodies, headers, tenant IDs, idempotency keys, and JSON Schemas are untrusted.
  TypeBox/Ajv validates shape and bounds. The tenant header is routing context, not identity.
- **API to provider:** prompt data crosses an external boundary only inside a provider adapter.
  Keys and bodies do not appear in logs or spans.
- **Service to persistence:** every replay-vault query includes tenant and execution identity;
  execution repositories also scope caller-facing reads by tenant.
- **Replay storage:** plaintext exists transiently in the API process for execution and
  encryption/decryption. It is not a database column, API response, audit field, log, or span.
- **Dashboard:** browser requests use a fixed development tenant. Production requires authenticated
  tenant selection and authorization. Its live route receives only the typed, operator-safe event
  record; prompts, capsule material, keys, provider credentials, cookies, and authorization are not
  event payloads.

## Read behavior and scaling tradeoff

Execution list hydration currently performs one bounded parallel capsule inspection per returned
execution. That is acceptable for this unpaginated prototype and prevents stale capability state,
but it is an N+1 query pattern. A larger system should paginate and join or batch capability
metadata without exposing encrypted bodies.

## Failure and consistency boundaries

Normalized execution evidence remains available after capsule expiry or deletion. Fake-provider
execution may proceed when optional replay persistence fails, and the envelope truthfully reports
`missing`. Live retention is a stronger promise: startup rejects invalid durable configuration and a
runtime capsule-write failure prevents the provider call.

Accepted execution continues asynchronously but remains owned by the API process. The initial
running projection and acceptance event are persisted before `202`, but there is no durable queue,
worker, lease, or recovery claim: a process failure can lose in-flight work. The append-only event
log explains decisions while the execution row is a mutable query projection. Replay
audit/lifecycle operations are transactional inside the vault, but execution-event/projection
writes are not a transactional outbox. Durable execution remains in the
[roadmap](roadmap.md).
