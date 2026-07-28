# Execution envelope and event schema

`ExecutionEnvelope.schemaVersion` is `1`. It contains stable query fields (execution, tenant, status,
provider, model, trace, request hash, timestamps), the resolved policy and budget, attempts, events,
normalized output/error, replay linkage, and replay capability.

Worker mode initially uses `queued`, then moves to `running` when a worker claims the command.
Terminal statuses remain `succeeded`, `degraded`, `failed`, or the reserved `cancelled`.

Lease owner, claim version, and lease expiry belong to the private durable job boundary, not the
public execution envelope. `claimCount` is used there as a fencing token. A stale worker does not
append a terminal lease-loss claim because it is no longer authorized to write execution evidence;
the newer owner projects persisted `attempt.started` activity into recovery and
`provider_call_outcome_unknown` evidence.

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
discriminating `type`. Version 1 represents acceptance, durable queueing and worker claims, recovery
detection, provider-call ambiguity, idempotency hits, attempt starts, successful
provider observations, normalized attempt failures, retries, fallback, successful or rejected
structured-output validation, budget/circuit decisions, terminal state, and replay
start/completion. A failed-attempt payload records category, code, retryability, and observed
latency. Provider-response evidence identifies the provider/model route; budget rejection records
both observed and configured values. Events are inserted; they are not updated to rewrite history.

A provider result becomes evidence only after the worker guard observes that the exact claim remains
current. Lease cancellation is therefore distinct from the execution events produced by a latency
budget abort. Aborting a request is best effort and cannot establish that a remote provider did not
already process it, which is why the new owner preserves ambiguity rather than automatically calling
the provider again.

`GET /v1/executions/:executionId/events` is a read projection over this same record, not a second
event model. SSE `id` is the decimal event sequence, `event` is `execution`, and `data` is the typed
event JSON. `after` and `Last-Event-ID` are cursors; the greater value wins. History is backfilled in
ascending order, heartbeat comments keep an active stream open, and a terminal event closes it. A
client already caught up to a terminal execution receives a safe `complete` control frame and the
connection closes. Tenant-not-found is resolved before stream headers are opened.

Schema evolution should add optional fields compatibly or introduce event schema version 2 with an
upcaster at read boundaries. Consumers must switch on `type` and tolerate versions they explicitly
support.

## Replay linkage

A replay has a new execution ID and `replayOfExecutionId` pointing to the original. Its event stream
records `replay.started` and, after continuation, `replay.completed`; completion identifies both
executions and whether terminal status, output text, and normalized error category matched. A
durable replay acceptance response reports the match as pending until the worker finishes. The
original record is not mutated to impersonate the replay.

## Comparison projection

A comparison experiment references an original execution and, when vault evidence is available, a
linked variant execution. Its versioned definition stores the exact requested configuration
variation and the fully resolved provider, model, policy, budget, structured-output requirement,
and other safe execution conditions. It does not store retained input.

The comparison is computed from the two envelopes. Each dimension reports original value, variant
value, one of `improved`, `worsened`, `unchanged`, `mixed`, or `unavailable`, and a focused
explanation. Missing usage or cost stays unavailable rather than becoming zero. Provider-route and
fallback changes are tradeoffs; token differences are factual/mixed unless an evaluated token
budget exists; lower estimated cost remains better for that dimension. Exact output match is
factual and does not imply semantic quality.
The projection deliberately has no aggregate score or universal winner.

## Investigation projections

Investigation summaries are deliberately not `ExecutionEnvelope` variants. A compact execution row
contains identity, trace, status, route, timestamps, duration, attempt/retry counts, normalized
terminal error identity, replay lineage, inexpensive comparison count, and boolean/typed
investigation signals. It never contains prompt/messages, output bodies, full attempts/events,
capsules, commands, keys, or raw provider data.

Signal definitions are shared pure domain projections:

- retry recovery means a scheduled retry (or multiple attempts with prior non-success evidence)
  later reached `succeeded` or `degraded`;
- fallback dependence means `fallback.selected` was recorded and the execution later reached
  `succeeded` or `degraded`;
- structured-output rejection and latency-budget failure come from their explicit events, with
  narrow normalized terminal-code fallbacks;
- provider ambiguity comes from `attempt.outcome_ambiguous` or
  `provider_call_outcome_unknown`;
- replay-derived means `replayOfExecutionId` is present.

PostgreSQL implements equivalent predicates without reconstructing envelopes. Provider/model rows
aggregate attempt evidence, not the envelope's initial route. Missing latency and cost remain
missing evidence; rates are null when their terminal denominator is zero.
