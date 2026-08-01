# Reliability Lab: Encrypted Live Replay Basics

Encrypted Live Replay is a bounded post–Horizon 5 capability for future live executions. It lets an
operator retain one live request in the existing PostgreSQL Replay Vault, then use that request for
Replay or a controlled comparison. It does not begin Horizon 6 or add authentication, replay roles,
managed KMS, or production tenant isolation.

## The two gates

Live retention requires both independent decisions:

1. The deployment permits it with a migrated PostgreSQL Replay Vault, valid replay keyring, and
   `ALLOW_LIVE_PROMPT_RETENTION=true`.
2. The operator explicitly selects encrypted retention for one execution. The typed browser intent
   is only `disabled` or `encrypted`, and defaults to `disabled`.

Deployment permission never retains every live request. An omitted or disabled intent makes the
provider call normally and records `retention_disabled`. If encrypted retention is requested while
the deployment gate is unavailable, the API rejects the submission before creating a provider
effect. It never silently downgrades the request.

`GET /v1/providers` projects only a safe capability: availability, the label **Encrypted replay
retention**, configured hours, the required per-execution opt-in, and one constrained unavailable
reason. It never projects the database URL, storage configuration object, key version, keyring,
provider credential, endpoint, or cryptographic parameters. Configuration presence is not called
storage health; `/readyz` performs its existing database/table checks separately.

## What is retained

The capsule contains only the established minimum provider request material: tenant, provider,
model, input or messages, optional structured-output schema, and deterministic failure mode when
applicable. Policy and budget remain normalized execution evidence and are restored from that
evidence during Replay. AES-256-GCM authenticates tenant, execution, payload schema, and key version
with a fresh random nonce for every row.

The input remains outside ordinary execution events, traces, logs, Workbench projections, saved
cases, review packets, capability responses, and proof output. Plaintext exists transiently only at
validation/encryption and decryption/provider-call boundaries.

For opted-in live work, the runner completes the encrypted vault write before it records and invokes
the provider attempt. A failed write produces the normalized `replay_retention_failed` execution
failure and zero provider calls. This ordering avoids claiming a replayable external effect when its
required request material was never durably retained.

## Timeline, Replay, and Compare

- **Timeline playback** re-presents recorded events. It creates no execution and no provider call.
- **Replay** decrypts the original capsule, creates a linked immutable execution, and makes one new
  provider request that may incur cost.
- **Compare with variant** decrypts the same original request, creates a distinct linked execution,
  and makes one new provider request that may incur cost.

An accepted Replay or variant inherits encrypted retention. It receives a new vault row, fresh
expiry, nonce, authentication tag, and ciphertext under the active write key. It does not reuse the
source ciphertext and no longer depends on the source capsule after its own retention succeeds.
Deleting the original therefore prevents future original-based effects without invalidating the
already-created child executions or normalized comparison evidence.

The current live runtime exposes one eligible provider/model target. Live comparisons consequently
render that target as fixed and accept only bounded policy and budget changes (or an explicit
same-conditions check). Browser-supplied arbitrary provider, model, or fallback target changes are
rejected. Reliability Lab does not call a model-list endpoint or imply a broader catalog.

## Expiry, deletion, and key states

Capability is computed at read time:

- `expired`, `deleted`, `key_unavailable`, `unreadable`, and `missing` all prevent Replay and Compare
  before a provider call;
- delete is tenant-scoped, idempotent, and a tombstone rather than a physical-backup erasure claim;
- restoring a missing historical key can restore an otherwise current row;
- authentication, schema, or shape failure produces only `unreadable` plus metadata-only audit;
- normalized execution, attempt, event, comparison, Workbench, and saved-case evidence remains.

An older unretained live execution has no capsule to recover. Retention cannot be enabled
retroactively.

## Short local setup

Use the in-process API for the smallest proof; a durable worker is not required:

```bash
pnpm dev:infra
pnpm db:migrate
pnpm replay:keygen
# Copy the printed values into ignored .env.local or .env, then add provider settings.
pnpm dev
```

The generated example is equivalent to:

```text
REPLAY_CAPSULE_STORE=postgres
ALLOW_LIVE_PROMPT_RETENTION=true
REPLAY_CAPSULE_RETENTION_HOURS=24
REPLAY_CAPSULE_ACTIVE_KEY_VERSION=local-v1
REPLAY_CAPSULE_KEYS_JSON={"local-v1":"<generated-base64-key>"}
```

`pnpm replay:keygen` uses `node:crypto`, prints a random 32-byte base64 secret, and writes no file.
Prefer pasting directly into an ignored file without placing the value in a shell command. Exported
process variables still win over `.env.local`, which wins over `.env`; production entrypoints remain
injection-only. Never commit or archive a real key.

After a build, `pnpm verify:local-provider-wire` runs a public-network-free PostgreSQL proof against
a loopback provider. It makes exactly three mock requests—original, Replay, and one policy/budget
variant—checks that each independent capsule is visible before its provider call, deletes the
original capsule, confirms new effects are blocked, and confirms normalized evidence remains.

`pnpm verify:live-replay` is the optional external proof. Without
`RUN_LIVE_REPLAY_VERIFY=true`, it exits successfully as **not run** and makes no request. With the
flag and complete deployment/provider settings, it makes exactly two external requests: retained
original and Replay. Output is bounded safe metadata only. It deliberately makes no paid comparison
call. One success proves connectivity and replay wiring, not reliability or model quality.

## Prototype limits

Environment keyrings are not managed KMS or envelope encryption. The tenant header is routing
context, not identity. There is no replay authorization role, RLS, per-tenant credential isolation,
access review, legal hold, residency control, or physical backup erasure guarantee. Those remain
Horizon 6 and later concerns.

See [ADR 0014](adr/0014-explicit-encrypted-live-replay-consent-and-inheritance.md),
[Security and retention](security-and-retention.md), and
[Live Provider Proof basics](reliability-lab-live-provider-proof-basics.md).
