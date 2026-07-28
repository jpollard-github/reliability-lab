# Security and retention

## Tenant boundary

Execution, idempotency, replay capsule, and replay audit records carry tenant ID. Replay adapter
queries always filter by tenant and execution, including inspect, decrypt-for-replay, and delete;
another tenant therefore sees an absent capability and cannot act on the row. This is defense
against accidental cross-tenant access, not authentication. The prototype still needs verified
identity, authorization, tenant membership, and database row-level security.

## Encryption and key versions

The PostgreSQL replay vault uses AES-256-GCM with a random 12-byte nonce for every write and a
32-byte base64-decoded key. Authenticated additional data binds tenant ID, execution ID, payload
schema version, and key version. Ciphertext, nonce, tag, and key version are separate columns; no
plaintext capsule JSON is persisted.

`REPLAY_CAPSULE_ACTIVE_KEY_VERSION` selects the key used for new writes. Reads use the key version
stored with each row, so changing the active version provides read-old/write-current behavior while
historical keys remain configured. Missing historical keys and authentication or shape failures
return normalized `key_unavailable` or `unreadable` capability states without cryptographic details.

The environment JSON keyring is a serious prototype mechanism, not production key management. It
does not provide KMS-backed envelope keys, automatic re-encryption, hardware isolation, independent
key access policy, or cryptographic deletion. Production should use managed key infrastructure and
document rotation, revocation, backup, and recovery procedures.

## Transient execution commands

PostgreSQL worker mode has a separate AES-256-GCM command store. Its AAD binds purpose
`execution_command`, tenant ID, execution ID, payload schema version, and command key version.
`EXECUTION_COMMAND_ACTIVE_KEY_VERSION` chooses new-write keys and
`EXECUTION_COMMAND_KEYS_JSON` supplies read-old/write-current versions. Startup fails closed for an
invalid keyring.

Command ciphertext exists only so a worker can honor accepted work. Terminal handling clears
ciphertext, nonce, and authentication tag and records `payloadDeletedAt`, retaining only safe lease
and reconciliation metadata. Missing keys, malformed payloads, and authentication failures produce
normalized safe failures without crypto detail or plaintext. This lifecycle is independent of
Replay Vault expiry/deletion: deleting either payload never deletes the other.

## Retention, expiry, and deletion

Capsules have explicit expiry timestamps. Expired and deleted rows become unavailable on the next
capability read and cannot be decrypted for replay. Explicit deletion is idempotent and records a
deletion timestamp; normalized execution evidence remains available. The slice retains tombstoned
encrypted rows for auditability rather than claiming physical erasure. A production erasure policy
must define ciphertext purge, backups, replicas, and legal holds.

Fake-provider capsules may use process-local memory when no durable store is selected and therefore
disappear on restart. Live-provider retention defaults off. Setting
`ALLOW_LIVE_PROMPT_RETENTION=true` fails startup unless the PostgreSQL replay store, database URL,
active key, and valid keyring are configured. A live provider is not called if its required durable
capsule write fails. Optional fake execution can continue after a capsule-write failure but is
reported as non-replayable.

## Audit and redaction

Store, inspect, read-for-replay, unavailable access, key/decryption failure, and delete outcomes
append metadata-only audit rows. Capsule and audit writes are transactionally paired where they
belong. The audit has no actor because authentication does not exist; inventing an actor would be
misleading. The current tenant header should not be interpreted as proof of who performed an action.

Pino redacts authorization, cookies, API keys, messages, and input. Spans contain identifiers and
policy metadata, not prompt content. Capsule and execution-command bodies, ciphertext, nonces,
tags, and keys are absent from API contracts. `.env*` except `.env.example`, logs, exports, and
local volumes are ignored or refused by export tooling.

## Comparative replay

The comparison API cannot accept messages, input, or a replacement prompt. It can only request
bounded provider/model, retry/fallback, and budget changes. Omitted values inherit; explicit `null`
removes supported fallback or cost settings. Provider identifiers are checked against the
configured registry, numeric bounds are validated, and unchanged conditions require an explicit
reproducibility check.

Experiments persist tenant identity, linked execution IDs, requested variation, resolved
non-sensitive conditions, status, and timestamps. The replay vault remains the only source of
retained request material. API and UI responses expose the experiment definition and normalized
envelopes, never the capsule, prompt, messages, structured schema content, or cryptographic fields.
Deleting or expiring a capsule prevents creation of a new variant and produces an explicit
unavailable experiment; existing normalized execution evidence remains.

## Saved investigation cases

Cases store bounded operational prose—title, question, finding, resolution, and append-only
notes—in plaintext. They are not a prompt-retention mechanism. Evidence rows store only typed
tenant-scoped references to execution IDs, comparison experiment IDs, or canonical
provider/model/exact-range observations. The API accepts no arbitrary external URL, HTML, prompt,
message, output, replay material, command payload, ciphertext, provider credential, raw provider
body, or arbitrary pasted attachment.

Every case, note, evidence, list, and timeline operation scopes by tenant. Cross-tenant evidence is
reported as not found. Removing a link leaves the execution/comparison intact and appends a
metadata-only lifecycle event. Notes have no edit/delete endpoint; archive replaces hard case
deletion in this slice.

Timeline metadata contains safe identifiers, types, changed-field names, status transitions, and
presence flags. Note bodies, finding text, and resolution text remain only in their normal current
records and are not duplicated into timeline metadata, logs, or trace attributes. Logs identify case
ID and operation type. Repository exports contain source and safe fixtures, never runtime case rows.

The `X-Tenant-Id` header is routing context, not a person. Cases deliberately have no author, owner,
assignee, or resolver field. Authenticated authorship, role-based access, and PostgreSQL row-level
security remain absent and are required before production use.

## Remaining risks

Plaintext must exist transiently to encrypt a command and to call a provider or replay a capsule, so
host and process compromise remain in scope. Database roles are not yet separated between execution
jobs, evidence, and replay data. There is no authenticated actor, RBAC, RLS, residency policy,
legal-hold workflow, backup erasure guarantee, cloud KMS, bulk re-encryption, or isolated replay
worker. Those controls must precede production use.
