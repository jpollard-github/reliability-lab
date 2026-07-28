# Reliability Lab

Reliability Lab is a serious prototype for putting policy, observability, and deterministic
execution replay between an application and OpenAI-compatible LLM providers. Its working slice accepts a
tenant-scoped execution, applies bounded retry and fallback policy, validates structured output,
records versioned append-only events, and exposes the outcome through an API and operator dashboard.

Replayable investigation cases matter because a provider failure is rarely explained by the final
HTTP status alone. A safe execution envelope captures the route, attempts, normalized failures, policy
decisions, timing, trace correlation, and—only when retention permits—a canonical replay capsule.
That lets engineers reproduce a production-shaped failure without pretending that every live prompt
is safe to retain.

## Current status

Implemented now:

- strict shared TypeScript contracts and a discriminated, versioned event union
- injectable policy engine with bounded exponential backoff and jitter, retry, fallback, latency
  budgets, JSON Schema output validation, in-memory rate limiter, and in-memory circuit breaker
- deterministic fake provider and a narrow OpenAI-compatible HTTP adapter
- tenant-scoped Fastify API with immediate `202` acceptance, persisted-event SSE with cursor resume,
  TypeBox validation, idempotency, OpenAPI, Swagger UI, replay, and redacted Pino logging
- Drizzle PostgreSQL schema, migration, and repository for executions, attempts, events, and
  idempotency records
- tenant-scoped PostgreSQL Replay Vault with AES-256-GCM encryption, expiry, deletion,
  metadata-only lifecycle audit, and read-old/write-current key versions
- OpenTelemetry spans with console export by default and optional OTLP export
- Next.js operator console with a live evidence-driven machine view, incremental event timeline,
  recorded-history playback, replay control, guided comparative replay variants, side-by-side
  machines, and dimension-level evidence comparisons
- tenant-scoped, versioned comparison experiments persisted in memory or PostgreSQL, with requested
  overrides, resolved non-sensitive conditions, linked variant executions, and read-time projections
- guarded repository and working-file export tools

Not implemented as production infrastructure: managed KMS/envelope encryption, authenticated replay
actors, authentication/authorization beyond the prototype tenant header, distributed circuit state,
global rate limiting, queue workers, cost enforcement, physical backup erasure, or a multi-replica
consistency model. Redis adapters remain explicit unwired skeletons.

## Architecture

```mermaid
flowchart LR
  Client[Application or dashboard] -->|validated HTTP + tenant| API[Fastify API]
  API --> Service[Execution service / policy engine]
  Service --> Primary[Provider interface]
  Primary --> Fake[Deterministic fake]
  Primary --> Live[OpenAI-compatible HTTP]
  Service --> Repo[Execution repository port]
  Repo --> Memory[In-memory development store]
  Repo --> PG[(PostgreSQL)]
  Service --> Capsule[Replay capsule port]
  Capsule --> Vault[(Encrypted PostgreSQL vault)]
  Capsule --> CapsuleMemory[Process-local memory]
  Service --> Experiment[Comparison experiment port]
  Experiment --> PG
  Service --> OTel[OpenTelemetry]
  API --> Pino[Redacted structured logs]
  Web[Next.js operator console] --> API
  Redis[(Redis)] -. future distributed limiter / breaker .-> Service
```

Domain code has no Fastify, Next.js, Drizzle, Redis, or provider-SDK dependency. See
[`docs/architecture.md`](docs/architecture.md) for trust boundaries and scaling direction and the
outcome-based [`docs/roadmap.md`](docs/roadmap.md) for what comes next.

## Execution lifecycle

1. The API validates the body and `X-Tenant-Id`, hashes the canonical request, and checks the
   tenant/idempotency-key pair.
2. The execution service records `execution.accepted`, persists a running envelope, and returns a
   stable execution and trace ID to the API. The API responds `202` while continuation remains
   in-process.
3. The service retains replay material when policy permits, resolves the provider, and continues
   asynchronously. Each call records `attempt.started`; failed attempts record normalized failure
   evidence before retry, fallback, or stop.
4. A configured fallback runs once after primary policy exhaustion and makes a successful outcome
   `degraded`.
5. Structured output is validated with Ajv. Requested validation records either success or
   rejection; invalid output fails the execution.
6. Terminal state, attempts, and normalized metadata are persisted; events remain append-only.
7. Eligible requests retain a tenant-scoped capsule with explicit expiry. Memory mode is
   process-local; PostgreSQL mode encrypts before persistence and appends lifecycle audit metadata.
8. Tenant-scoped SSE reads events after a sequence cursor from persisted evidence, backfills
   history, sends heartbeats while following, and closes after terminal evidence.
9. Reads hydrate current replay capability, so expiry, deletion, missing keys, or unreadable data
   disable replay. Replay creates a linked execution and records replay start/completion events.
10. Comparative replay resolves a bounded provider/model/policy/budget variation against the
    retained request, submits it through the same execution path, and compares the two envelopes.

## Repository layout

```text
apps/api          Fastify composition root, routes, injection tests
apps/web          Next.js App Router console and Playwright smoke test
packages/contracts  TypeBox schemas and shared domain contracts
packages/core       Policy engine, ports, in-memory adapters
packages/providers  Fake and OpenAI-compatible providers
packages/db         Drizzle schema, migration, PostgreSQL repository
packages/observability  OpenTelemetry bridge and log redaction
packages/testkit    Deterministic clocks, IDs, and randomness
docs/               Architecture, envelope, failure, security, ADRs
scripts/            Guarded export commands and tests
.agents/skills/     Repository-local export skill instructions
```

## Quick start

Requirements: Node 24 LTS, pnpm 11.17.0 via Corepack, Docker with Compose for the persistent path.

```bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev:infra
pnpm db:migrate
ENABLE_FAILURE_INJECTION=true pnpm dev
```

The development tenant is the transparent header value `demo-tenant`; no tenant row is seeded.
Without `DATABASE_URL` and `REDIS_URL`, the API runs with process-local execution and replay storage
and reports those modes at `/readyz`. To exercise restart-durable replay, set
`REPLAY_CAPSULE_STORE=postgres`, a valid active key version/keyring, and `DATABASE_URL`, then migrate
before starting the API. The public keys in `.env.example` are intentionally unsafe examples; do not
reuse them. The `.env` file is ignored and must never contain production credentials.

- Dashboard: <http://localhost:3000>
- API: <http://localhost:4000>
- Swagger UI: <http://localhost:4000/docs>
- OpenAPI JSON: <http://localhost:4000/openapi.json>

## Demo requests

All examples require `ENABLE_FAILURE_INJECTION=true` except the first and replay.

Successful execution:

```bash
curl -sS http://localhost:4000/v1/executions \
  -H 'content-type: application/json' \
  -H 'x-tenant-id: demo-tenant' \
  -H 'idempotency-key: demo-success-1' \
  -d '{"provider":"fake-primary","model":"deterministic-v1","input":"Summarize execution 42"}'
```

Retry once after a rate limit:

```bash
curl -sS http://localhost:4000/v1/executions \
  -H 'content-type: application/json' -H 'x-tenant-id: demo-tenant' \
  -d '{"provider":"fake-primary","model":"deterministic-v1","input":"retry","failureMode":"rate_limit","policy":{"maxAttempts":2,"baseBackoffMs":10,"maxBackoffMs":10,"jitterRatio":0}}'
```

Fallback and a `degraded` terminal status:

```bash
curl -sS http://localhost:4000/v1/executions \
  -H 'content-type: application/json' -H 'x-tenant-id: demo-tenant' \
  -d '{"provider":"fake-primary","model":"deterministic-v1","input":"fallback","failureMode":"provider_error","policy":{"maxAttempts":1,"fallbackProvider":"fake-fallback","fallbackModel":"deterministic-v1"}}'
```

Malformed structured output:

```bash
curl -sS http://localhost:4000/v1/executions \
  -H 'content-type: application/json' -H 'x-tenant-id: demo-tenant' \
  -d '{"provider":"fake-primary","model":"deterministic-v1","input":"structured","failureMode":"malformed_json","structuredOutputSchema":{"type":"object","required":["result"],"properties":{"result":{"type":"string"}}}}'
```

Replay (replace the ID):

```bash
curl -sS -X POST http://localhost:4000/v1/executions/EXECUTION_ID/replay \
  -H 'x-tenant-id: demo-tenant'
```

Comparative replay with fewer primary attempts and immediate fallback:

```bash
curl -sS -X POST http://localhost:4000/v1/executions/EXECUTION_ID/comparisons \
  -H 'content-type: application/json' -H 'x-tenant-id: demo-tenant' \
  -d '{"variation":{"policy":{"maxAttempts":1,"fallbackProvider":"fake-fallback","fallbackModel":"deterministic-v1"}}}'

curl -sS http://localhost:4000/v1/comparisons/EXPERIMENT_ID \
  -H 'x-tenant-id: demo-tenant'
```

Comparison requests cannot replace input or messages. Omitted controls inherit original conditions;
supported `null` values explicitly remove fallback or cost limits, and a no-op requires
`reproducibilityCheck: true`.

Delete retained replay data idempotently:

```bash
curl -sS -X DELETE http://localhost:4000/v1/executions/EXECUTION_ID/replay-capsule \
  -H 'x-tenant-id: demo-tenant'
```

Inspect with `GET /v1/executions` or `GET /v1/executions/:executionId`, always with
`X-Tenant-Id`. Execution detail includes `replayCapability` with current state, safe reason, and
expiry/deletion timestamps when applicable; capsule content and cryptographic fields are never
returned.

Follow persisted events with a reconnectable cursor:

```bash
curl -N 'http://localhost:4000/v1/executions/EXECUTION_ID/events?after=0' \
  -H 'accept: text/event-stream' \
  -H 'x-tenant-id: demo-tenant'
```

The stream contains operator-safe typed events only: never prompt text, replay capsules,
cryptographic material, provider credentials, authorization, or cookies.

## Replay configuration

| Variable                            | Behavior                                                        |
| ----------------------------------- | --------------------------------------------------------------- |
| `REPLAY_CAPSULE_STORE`              | `memory` (default) or explicit `postgres` durable vault         |
| `REPLAY_CAPSULE_RETENTION_HOURS`    | Positive retention duration; defaults to 24                     |
| `REPLAY_CAPSULE_ACTIVE_KEY_VERSION` | Key version used for new PostgreSQL capsule writes              |
| `REPLAY_CAPSULE_KEYS_JSON`          | Prototype JSON map of versions to base64-encoded 32-byte keys   |
| `ALLOW_LIVE_PROMPT_RETENTION`       | Defaults false; true requires a valid PostgreSQL vault at start |

Old rows use their stored key version while new rows use the active version. Keep historical keys
configured until their rows expire or are deleted. Environment-variable keys are not production KMS
or full envelope encryption.

## Commands

| Command                                       | Purpose                                                      |
| --------------------------------------------- | ------------------------------------------------------------ |
| `pnpm dev`, `dev:api`, `dev:web`              | Run both apps or one app                                     |
| `pnpm dev:infra`                              | Start healthy Postgres and Redis services                    |
| `pnpm build`                                  | Build every workspace package                                |
| `pnpm lint`, `format:check`, `typecheck`      | Static checks                                                |
| `pnpm test:unit`                              | Docker-independent policy, provider, API, and export tests   |
| `pnpm test:integration`                       | PostgreSQL repository test; requires migrated `DATABASE_URL` |
| `pnpm test:e2e`                               | Dashboard list/detail smoke flow; requires the API           |
| `pnpm verify`                                 | Format, lint, typecheck, unit tests, build                   |
| `pnpm verify:full`                            | Verify plus integration and browser tests                    |
| `pnpm audit:deps`, `audit:unused`, `audit`    | Read-only dependency/dead-code observation                   |
| `pnpm db:generate`, `db:migrate`, `db:studio` | Drizzle workflows                                            |
| `pnpm export:repo`, `export:working`          | Guarded compressed exports                                   |

## Testing strategy

Unit tests inject clocks, IDs, randomness, provider responses, and repositories; they do not require
real delays. They cover encryption, nonces, authenticated context, expiry, deletion, tenant scope,
key configuration, and live-retention failure. API and unit tests cover asynchronous acceptance,
typed event ordering, SSE backfill/cursors/terminal close, machine projection, variation resolution,
and conservative dimension-level comparison. PostgreSQL integration proves ciphertext-only
persistence, audit metadata, key rotation, tenant isolation, replay after service reconstruction,
and durable comparison definitions. Playwright observes a real retry while it is running, preserves
replay deletion coverage, and exercises the original-to-variant comparison flow. There are
deliberately no broad snapshots.

## Observability

The service creates spans for policy evaluation, provider attempts, structured-output validation,
persistence creation, and replay-driven execution. Local development exports spans to the console;
setting `OTEL_EXPORTER_OTLP_ENDPOINT` switches to OTLP/HTTP. Each envelope and API submission
contains a 32-character trace correlation ID, and logs include it with the execution ID and tenant.
Prompt bodies and messages are excluded from span attributes and redacted from Pino records.

## Security and retention

Tenant filtering is enforced in execution and vault adapters, but the prototype header is not
authentication. Authorization, cookies, API keys, messages, and input use log-redaction paths.
PostgreSQL capsules use AES-256-GCM with tenant/execution/schema/key authenticated context; audit
rows contain metadata only. Expiry and deletion revoke replay immediately while normalized evidence
remains. Live retention defaults off and fails closed unless the durable encrypted path is valid.
The environment keyring is a prototype, not managed production key infrastructure. See
[`docs/security-and-retention.md`](docs/security-and-retention.md).

## Design tradeoffs

- Submission and execution are separated only inside one API process. The persisted running record
  makes `202` honest for this prototype, but it is not durable queue acceptance: process failure can
  lose in-flight work before terminal evidence is written.
- Events are append-only, while the execution row is a query projection updated to its latest state.
- The memory repository keeps unit tests and an infrastructure-free demo honest, but is not shared
  or durable.
- The narrow live adapter avoids SDK/domain coupling but supports only chat completions and focused
  JSON Schema response formatting.
- Execution list capability hydration uses bounded parallel per-row vault inspection. This keeps
  state current for the small prototype but needs batching or a join before large pagination.
- Capsule lifecycle/audit mutations are transactional inside the vault, but execution projection
  updates are a separate consistency boundary.
- Variant acceptance and experiment persistence cross two repository operations. A persistence
  failure after variant acceptance can leave a linked execution without an experiment row until
  durable orchestration introduces a stronger boundary.

## Production-hardening direction

- **Identity and tenancy:** authenticated principals, tenant membership, database row-level security,
  service-to-service authorization.
- **Execution consistency:** durable queue, transactional outbox, concurrency-safe idempotency,
  cancellation, leases, and recovery.
- **Policy controls:** Redis-backed distributed rate limits and circuit state, model/provider health,
  cost budgets, and explicit policy versions.
- **Replay experiments:** batch scenarios, saved policy versions, and aggregate analysis beyond the
  current single-case, dimension-level comparison.
- **Replay security:** managed envelope keys/KMS, authenticated actors, physical purge/backup
  semantics, residency controls, and isolated replay credentials.
- **Observability:** sampled OTLP pipelines, metrics, baggage policy, log/trace joining, and SLOs.
- **Operations:** multi-replica readiness, migration automation, backups, restore exercises, and
  incident runbooks.

## Export skills

Ask Codex to use `$export-repo` to package all tracked and non-ignored non-secret files. The skill
runs `pnpm export:repo -- --dry-run` before creating `artifacts/exports/*.tar.gz`.

Ask Codex to use `$export-working-files` only for intentionally ignored artifacts. Add sanitized
paths to `.working-files.export.json`, then the skill dry-runs and exports only that allowlist.
Environment files, keys, credentials, browser profiles, databases, raw prompts, and user data are
always refused.

## Known limitations

The API executes inline, so in-flight provider work cannot survive process loss. Readiness checks
database connectivity and selected replay mode but not migration/schema version. Memory capsules
disappear on restart. PostgreSQL deletion is a tombstone, not a claim of physical erasure from
backups. Replay audits lack actors because the dashboard uses a fixed demo tenant and has no login.
The environment keyring is not KMS. Redis implementations are skeletons only. Cost is normalized but
not enforced, and circuit/rate state is process-local.
