# Execution envelope and event schema

`ExecutionEnvelope.schemaVersion` is `1`. It contains stable query fields (execution, tenant, status,
provider, model, trace, request hash, timestamps), the resolved policy and budget, attempts, events,
normalized output/error, replay linkage, and replay capability.

`replayCapability` is current store metadata, not historical evidence. Its state can be `available`,
`retention_disabled`, `expired`, `deleted`, `missing`, `key_unavailable`, or `unreadable`, with safe
reason text and expiry/deletion timestamps when relevant. `replayable` remains a compatibility
projection of `replayCapability.available`. API reads hydrate capability from the tenant-scoped
store; capsule bodies and cryptographic fields are not envelope fields.

## Request hashing

The service recursively sorts object keys, serializes the canonical request, and computes SHA-256.
The hash supports idempotency comparison without persisting the prompt in execution metadata. It is
not anonymization: low-entropy input can be guessed, so hashes remain protected metadata.

## Attempts

Attempts record provider/model, ordinal, state, timestamps, duration, normalized usage, validation
outcome, and redacted normalized error. Prompt bodies, authorization, and provider raw responses are
not attempt metadata.

## Events

Every event has `schemaVersion`, `eventId`, `executionId`, sequence, occurrence time, and a
discriminating `type`. Version 1 represents acceptance, idempotency hits, attempts, responses,
retries, validation rejection, fallback, budget/circuit decisions, terminal state, and replay
start/completion. Events are inserted; they are not updated to rewrite history.

Schema evolution should add optional fields compatibly or introduce event schema version 2 with an
upcaster at read boundaries. Consumers must switch on `type` and tolerate versions they explicitly
support.

## Replay linkage

A replay has a new execution ID and `replayOfExecutionId` pointing to the original. Its event stream
records `replay.started` and `replay.completed`; completion identifies both executions and whether
terminal status, output text, and normalized error category matched. The original record is not
mutated to impersonate the replay.
