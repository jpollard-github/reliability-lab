# ADR 0014: Explicit encrypted live replay consent and inheritance

- Status: Accepted
- Date: 2026-07-31

## Context

ADR 0003 made replay retention explicit and revocable. ADR 0004 established the encrypted
PostgreSQL Replay Vault. The live execution path then used `ALLOW_LIVE_PROMPT_RETENTION` as both a
deployment permission and an automatic retention switch. Enabling durable live Replay safely
requires a separate operator decision for each request and an explicit rule for replay-derived
children.

## Decision

An original live execution is retained only when both gates are true:

1. the deployment has the configured encrypted PostgreSQL vault and permits live retention; and
2. the request carries the typed per-execution intent `encrypted` rather than the default
   `disabled`.

The server derives a bounded public capability and remains authoritative. Requested retention that
is unavailable or cannot be persisted fails before any provider call and never downgrades silently.

Replay and comparison variants created from an available retained capsule inherit encrypted
retention. Each child is written before its provider effect with a fresh expiry and independent
encryption under the current write key. Ciphertext is never copied. With the current single live
target, live variants inherit provider/model/fallback targets and may change only validated policy
or budget values.

## Consequences

- Deployment permission alone never expands retention.
- Old unretained executions remain permanently unavailable.
- Replay and Compare each create a new potentially billable provider effect.
- A retained child survives deletion or expiry of the source capsule.
- Revocation or key failure blocks future effects while normalized evidence remains.
- Capability transport can explain operator choices without exposing infrastructure or secrets.
- The prototype still lacks authenticated replay authority and managed key infrastructure; Horizon
  6 remains unstarted.

## Rejected alternatives

- Automatically retain all live requests when the environment flag is true.
- Let the browser submit vault mode, expiry, key/version, endpoint, or credentials.
- Persist after the provider call or silently continue without retention after a failed write.
- Reuse source ciphertext for replay-derived executions.
- Present arbitrary live provider/model text fields when only one target is configured.
