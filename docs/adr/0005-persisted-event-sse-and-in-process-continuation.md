# ADR 0005: persisted-event SSE and in-process continuation

Status: accepted, 2026-07-27.

Return `202` after the execution service has assigned stable identifiers and persisted a running
envelope with `execution.accepted`. Continue accepted work asynchronously inside the API process.
Expose the append-only event record through tenant-scoped Server-Sent Events, using sequence cursors
and persisted backfill as the authority.

This makes acceptance semantics and the live operator view coherent without coupling domain policy
to Fastify or browser state. SSE fits the one-way read stream, existing HTTP boundary, ordered event
IDs, reconnect cursor, and terminal close. Polling the repository after backfill is intentionally
simple and does not lose history when an in-memory notification is missed. Browser fetch streaming
allows the prototype `X-Tenant-Id` header, which native `EventSource` cannot set.

The stream is not a transport for request or replay data. Its payload is limited to typed execution
evidence. Playback is a client projection of recorded events and never changes execution timing or
creates synthetic domain events.

This decision does not provide durable acceptance. The continuation promise, rate/circuit state,
and provider call live in one API process; process failure can leave a persisted running execution
without terminal evidence. Repository polling also creates per-stream read load and has no
multi-replica wake-up optimization. A durable queue, workers, leases, transactional outbox,
recovery, and distributed controls remain a later horizon.

Current status: the persisted-event SSE and default in-process boundary remain implemented.
[ADR 0007](0007-durable-postgres-execution-foundation.md) adds an explicit PostgreSQL-worker mode
that refines the durable-acceptance limitation without rewriting this decision's in-process
semantics.
