# Security and retention

## Tenant boundary

Every execution and idempotency record carries a tenant ID, and repository reads scope by tenant.
This prevents accidental cross-tenant lookup in the prototype but is not authentication. Production
requires verified identities, authorization, tenant membership, and preferably PostgreSQL row-level
security as defense in depth.

## Redaction and secrets

Pino redacts authorization, cookies, API keys, messages, and input. Spans contain IDs, provider,
attempt number, and policy metadata—not prompts. The OpenAI-compatible key is held only by its
adapter and is never included in normalized errors. `.env*` except `.env.example`, logs, exports, and
local volumes are Git-ignored or refused by export tooling.

## Retention defaults

Live-provider bodies are default-deny (`ALLOW_LIVE_PROMPT_RETENTION=false`). A live execution without
a capsule is explicitly non-replayable. Fake-provider fixtures may be retained in the process-local
capsule store for deterministic development replay. Hashes are metadata, not a substitute for
deletion or access control.

## Durable replay direction

No faux encryption is implemented. A production capsule store could use:

- a managed encrypted blob store with per-tenant paths, short-lived scoped access, lifecycle rules,
  and access logs; or
- field-level AES-256-GCM using a fresh data key/nonce per capsule, authenticated tenant/execution
  context, envelope encryption under a managed KMS key, key version metadata, rotation, and
  cryptographic deletion.

Either design needs retention policy versions, purpose limitation, residency controls, legal holds,
selective deletion, audit trails, and protection against replaying hostile or obsolete inputs. Replay
workers should use isolated credentials and re-apply current egress and safety policy.
