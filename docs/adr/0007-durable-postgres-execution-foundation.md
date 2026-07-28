# ADR 0007: Durable PostgreSQL execution foundation

- Status: accepted
- Date: 2026-07-28

## Context

The API persisted an execution and accepted event before returning `202`, but continuation stayed in
the API process. Process loss could strand accepted work. A worker also needs sensitive command
input, while Replay Vault retention remains optional and policy-controlled. Concurrent
check-then-record idempotency and separate comparison variant/experiment writes left acceptance
races.

## Decision

Keep `in_process` as the default and add explicit `postgres_worker` mode. In worker mode, one
PostgreSQL transaction writes the initial execution, accepted/queued events, AES-256-GCM encrypted
job, optional idempotency record, and—for comparisons—the experiment definition. Tenant/key
advisory locking plus the existing unique key enforces concurrent idempotency.

Add a separate worker application. It claims pending or expired jobs with `FOR UPDATE SKIP LOCKED`,
records a lease and claim count, heartbeats the lease, decrypts and validates the command, and calls
the existing core continuation operation. Terminal handling marks safe job metadata and clears the
ciphertext, nonce, and authentication tag.

Execution commands use a separate keyring and AAD purpose `execution_command`. They are never replay
capsules. Replay retention continues through its own rows, keyring, expiry, and deletion policy.

Recovery is conservative. A pending or untouched expired job can run; a terminal execution is
reconciled without rerun. Any reclaimed nonterminal execution with prior attempt activity records
`execution.recovery_detected`, `attempt.outcome_ambiguous`, and terminal
`provider_call_outcome_unknown` evidence. The provider is not called automatically again.

## Consequences

- In PostgreSQL worker mode, `202` is a restart-durable acceptance promise.
- API and worker can restart independently before a provider attempt begins.
- Plain replay and comparative variants use the same durable acceptance path.
- Command payload deletion and replay retention remain independently testable.
- The system provides at-least-once job delivery, not exactly-once provider effects.
- The conservative slice cannot resume midway through policy evaluation and may classify more
  reclaimed work as ambiguous than a future resumable state machine.
- Environment keyrings, process-local rate/circuit state, and the absence of authenticated operators
  remain prototype limitations.
