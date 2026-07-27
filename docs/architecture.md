# Architecture

## Components and data flow

`apps/api` is the composition root. It validates transport contracts, extracts the tenant boundary,
constructs provider/persistence adapters, and maps domain errors to HTTP. `packages/core` owns the
execution lifecycle and depends only on ports and shared contracts. `packages/providers` implements
the deterministic fake and a focused OpenAI-compatible HTTP adapter. `packages/db` projects current
state into typed PostgreSQL columns while storing attempts and versioned events. `apps/web` talks only
to the API.

A submission flows API → idempotency lookup → execution service → provider attempt(s) → structured
validation → append-only events/current-state projection → API response. Replay loads a capability
from the capsule port, invokes the same execution path, links the new envelope to the original, and
compares normalized outcomes.

## Trust boundaries

- **Caller to API:** all bodies, headers, tenant IDs, idempotency keys, and JSON Schemas are untrusted.
  TypeBox/Ajv validates shape and bounds. The prototype tenant header is routing context, not proof
  of identity.
- **API to provider:** prompt data crosses an external trust boundary only inside a provider adapter.
  Keys and bodies must not appear in logs or spans.
- **Service to persistence:** tenant ID is carried on every lookup. Database credentials remain
  runtime configuration.
- **Replay storage:** retained request data is more sensitive than normalized execution metadata.
  The current memory store is suitable only for local fake-provider replay.
- **Dashboard:** browser requests use a fixed development tenant. Production requires authenticated
  tenant selection and authorization.

## Current implementation versus future design

Today, execution is synchronous; process-local limiter, breaker, and replay storage are injectable;
Postgres can durably store execution metadata; Redis is readiness-checked but not in the request
path. OpenTelemetry uses a console or OTLP exporter.

Scaling requires a durable queue, transactional state/outbox boundaries, concurrent idempotency
reservation, distributed circuit/rate state, policy versions, and encrypted replay storage. Multiple
API replicas must never rely on the current memory adapters. A worker should own provider execution,
while submission returns an accepted queued envelope.

## Failure and consistency boundaries

The append-only event log is the explanation surface. The mutable execution row is a query
projection, not history. The first implementation writes these through one repository interface but
does not yet guarantee event/projection atomicity across every call. Production should transact an
event plus projection change and publish via an outbox. Provider success followed by persistence
failure must be recoverable without repeating a non-idempotent provider call blindly.
