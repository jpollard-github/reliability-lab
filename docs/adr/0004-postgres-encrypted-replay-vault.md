# ADR 0004: PostgreSQL encrypted replay vault with versioned keys

Status: accepted, 2026-07-27.

Store retained replay capsules in PostgreSQL beside execution evidence, but encrypt capsule payloads
in the adapter before persistence with AES-256-GCM. Scope every operation by tenant and execution,
bind that identity plus payload schema and key version as authenticated additional data, and expose
capability metadata rather than capsule bodies.

PostgreSQL gives this prototype durable restart behavior and transactional lifecycle/audit writes
without adding another storage system. A fresh random nonce prevents deterministic ciphertext.
Separate key-version metadata permits new writes under the active key while old rows remain readable
with historical keys. Expiry and deletion are capability states rather than a stale execution flag.

The environment keyring is intentionally limited to local and serious prototype use. It is not KMS,
envelope encryption, or a bulk rotation facility. Missing keys and authentication failures fail
safely. Tombstoned ciphertext is retained in this slice, and audit rows have no actor until
authentication exists.

Execution projection updates are outside the vault transaction. This ADR does not claim a
transactional outbox, cross-repository atomicity, physical backup erasure, or production key
management.
