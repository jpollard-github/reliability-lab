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
policy metadata, not prompt content. Capsule bodies, ciphertext, nonces, tags, and keys are absent
from API contracts. `.env*` except `.env.example`, logs, exports, and local volumes are ignored or
refused by export tooling.

## Remaining risks

Plaintext must exist transiently to call a provider and to encrypt or replay a capsule, so host and
process compromise remain in scope. Database roles are not yet separated between execution evidence
and replay data. There is no authenticated actor, RBAC, RLS, residency policy, legal-hold workflow,
backup erasure guarantee, cloud KMS, bulk re-encryption, or isolated replay worker. Those controls
must precede production use.
