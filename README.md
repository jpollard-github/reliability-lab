# Discontinued due to poor design and complexity

## Previous

Reliability Lab is a serious prototype for putting policy, observability, and deterministic
execution replay between an application and OpenAI-compatible LLM providers. Its working slice accepts a
tenant-scoped execution, applies bounded retry and fallback policy, validates structured output,
records versioned append-only events, and exposes the outcome through an API and operator dashboard.

Replayable investigation cases matter because a provider failure is rarely explained by the final
HTTP status alone. A safe execution envelope captures the route, attempts, normalized failures, policy
decisions, timing, trace correlation, and—only when retention permits—a canonical replay capsule.
That lets engineers reproduce a production-shaped failure without pretending that every live prompt
is safe to retain.

## Start here

Choose the path that matches the question you are trying to answer.

**Understand the product**

1. [Reliability Lab basics](docs/reliability-lab-basics.md) defines the product vocabulary.
2. [Roadmap](docs/roadmap.md) separates established outcomes from future movements.
3. [Ownership and Design Review basics](docs/reliability-lab-ownership-and-design-review-basics.md)
   explains how to present, defend, modify, and verify the system.

**Understand the implementation**

1. [Design-review walkthrough](docs/design-review-walkthrough.md) presents the complete
   evidence-based architecture and its limits.
2. [Codebase tour](docs/codebase-tour.md) maps responsibilities to current files and symbols.
3. [System flows](docs/system-flows.md) traces execution, worker, replay, comparison, Workbench, and
   saved-case paths.
4. [Architecture](docs/architecture.md) defines process, trust, consistency, and security
   boundaries.
5. [Built runtime](docs/built-runtime.md) explains source-aware development and emitted-JavaScript
   production entrypoints.
6. [Case-Driven Policy Experiments basics](docs/reliability-lab-case-driven-policy-experiments-basics.md)
   explains how a case launches and recovers one bounded comparison.
7. [Horizon 5 Closure basics](docs/reliability-lab-horizon-5-closure-basics.md) records the bounded
   completion signal, durable partial-result recovery, and explicit non-claims.
8. [Live Provider Proof basics](docs/reliability-lab-live-provider-proof-basics.md) explains the
   bounded post-Horizon-5 capability route, operator path, transport choice, and proof commands.
9. [Encrypted Live Replay basics](docs/reliability-lab-encrypted-live-replay-basics.md) explains
   two-gate consent, fail-closed storage ordering, child retention, and local setup.

**Modify the system**

1. [Change recipes](docs/change-recipes.md) maps representative changes across owners and tests.
2. [TypeScript patterns](docs/typescript-patterns.md) explains central type techniques.
3. [Persistence and API patterns](docs/persistence-and-api-patterns.md) documents PostgreSQL,
   Fastify, TypeBox, error, and SSE conventions.
4. [Operator Console patterns](docs/operator-console-patterns.md) documents pages, controllers,
   browser/server APIs, styles, and Playwright workflows.
5. [AGENTS guide](AGENTS.md) defines repository working and verification rules.

The [Owned Software basics](docs/reliability-lab-owned-software-basics.md),
[Persistence and API Composition basics](docs/reliability-lab-persistence-api-basics.md),
[Operator Console Composition basics](docs/reliability-lab-operator-console-basics.md), and
[Human-Comprehension Refactor plan](docs/reliability-lab-human-comprehension-refactor-plan.md)
preserve the rationale and staged history behind these paths.

## Current status

Implemented now:

- strict shared TypeScript contracts and a discriminated, versioned event union
- injectable policy engine with bounded exponential backoff and jitter, retry, fallback, latency
  budgets, JSON Schema output validation, in-memory rate limiter, and in-memory circuit breaker
- deterministic fake provider and a narrow OpenAI-compatible HTTP adapter
- public-safe provider capability projection, shared API/worker provider construction, and a
  bounded live execution path that appears only for eligible server configuration
- tenant-scoped Fastify API with immediate `202` acceptance, persisted-event SSE with cursor resume,
  TypeBox validation, idempotency, OpenAPI, Swagger UI, replay, and redacted Pino logging
- Drizzle PostgreSQL schema, migration, and repository for executions, attempts, events, and
  idempotency records
- tenant-scoped PostgreSQL Replay Vault with AES-256-GCM encryption, expiry, deletion,
  metadata-only lifecycle audit, and read-old/write-current key versions
- explicit per-execution encrypted live retention, safe deployment capability, fail-before-provider
  persistence, and fresh independent retention for live Replay and bounded variants
- OpenTelemetry spans with console export by default and optional OTLP export
- Next.js operator console with a live evidence-driven machine view, incremental event timeline,
  Timeline playback, replay control, guided comparative replay variants, side-by-side
  machines, and dimension-level evidence comparisons
- Investigation Workbench with explicit bounded time windows, aggregate outcome and recovery
  signals, attempt-level provider/model observations, URL-backed drill-down filters, stable cursor
  pagination, trace correlation, and compact execution summaries
- Saved Investigation Cases with exact canonical workbench scopes, current findings and resolution,
  typed execution/comparison/provider-observation references, append-only notes, metadata-only
  lifecycle timelines, archive status, and stable tenant-scoped case pagination
- derived case evidence review with explicit unavailable states, deterministic conclusion
  readiness, a resolved-state finding/resolution invariant, and tenant-aware Markdown review packets
- case-driven policy experiments that select linked replay-capable execution evidence, reuse
  ordinary Comparative Replay, automatically link the result, and expose link-only recovery when
  the non-atomic case association fails; pending recovery survives reload and records durable
  completion without recreating the comparison
- server-rendered product Guide, native contextual concept help, and stateless on-demand tours for
  all six established operator route families
- tenant-scoped, versioned comparison experiments persisted in memory or PostgreSQL, with requested
  overrides, resolved non-sensitive conditions, linked variant executions, and read-time projections
- explicit `in_process` and `postgres_worker` execution modes; durable mode atomically accepts
  executions, idempotency records, encrypted transient commands, and comparison variants
- separate PostgreSQL worker with versioned exclusive leases, serialized observed heartbeats,
  lease-aware continuation, fenced terminal cleanup, bounded concurrency, safe reclaim, terminal
  reconciliation, and conservative provider-call ambiguity
- guarded repository and working-file export tools
- a verified ownership teaching surface with design-review, change-recipe, structure, and
  documentation audits

Not implemented as production infrastructure: managed KMS/envelope encryption, authenticated replay
actors, authentication/authorization beyond the prototype tenant header, distributed circuit state,
global rate limiting, cancellation, resumable ambiguous provider calls, cost enforcement, physical
backup erasure, or a multi-replica consistency model. Redis adapters remain explicit unwired
skeletons.

## Architecture

```mermaid
flowchart LR
  Client[Application or dashboard] -->|validated HTTP + tenant| API[Fastify API]
  API -->|in-process mode| Service[Execution service / policy engine]
  API -->|atomic durable acceptance| Jobs[(PostgreSQL jobs)]
  Worker[Durable worker] -->|lease / heartbeat| Jobs
  Worker --> Service
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
  API --> Case[Investigation case service]
  Case --> CaseExperiment[Case experiment coordinator]
  CaseExperiment --> Service
  CaseExperiment --> Experiment
  Case --> CaseStore[Case repository port]
  CaseStore --> PG
  API --> CaseReview[Derived case review service]
  CaseReview --> Repo
  CaseReview --> Experiment
  CaseReview --> CaseStore
  Service --> OTel[OpenTelemetry]
  API --> Pino[Redacted structured logs]
  Web[Next.js operator console] --> API
  Redis[(Redis)] -. future distributed limiter / breaker .-> Service
```

Domain code has no Fastify, Next.js, Drizzle, Redis, or provider-SDK dependency. See
[`docs/architecture.md`](docs/architecture.md) for trust boundaries and scaling direction and the
outcome-based [`docs/roadmap.md`](docs/roadmap.md) for what comes next.

Plain-language guides:

- [Reliability Lab basics](docs/reliability-lab-basics.md)
- [Comparative Replay basics](docs/reliability-lab-comparative-replay-basics.md)
- [Durable Execution basics](docs/reliability-lab-durable-execution-basics.md)
- [Lease Safety and Fencing basics](docs/reliability-lab-lease-safety-basics.md)
- [Investigation Workbench basics](docs/reliability-lab-investigation-workbench-basics.md)
- [Saved Investigation Cases basics](docs/reliability-lab-saved-investigation-cases-basics.md)
- [Evidence-Backed Case Conclusions basics](docs/reliability-lab-evidence-backed-case-conclusions-basics.md)
- [Case-Driven Policy Experiments basics](docs/reliability-lab-case-driven-policy-experiments-basics.md)
- [Live Provider Proof basics](docs/reliability-lab-live-provider-proof-basics.md)
- [Owned Software basics](docs/reliability-lab-owned-software-basics.md)
- [Persistence and API Composition basics](docs/reliability-lab-persistence-api-basics.md)
- [Persistence and API patterns](docs/persistence-and-api-patterns.md)
- [Operator Console Composition basics](docs/reliability-lab-operator-console-basics.md)
- [Operator Console patterns](docs/operator-console-patterns.md)
- [Ownership and Design Review basics](docs/reliability-lab-ownership-and-design-review-basics.md)
- [Design-review walkthrough](docs/design-review-walkthrough.md)
- [Change recipes](docs/change-recipes.md)
- [Human-Comprehension Refactor plan](docs/reliability-lab-human-comprehension-refactor-plan.md)
- [Product Tour and Operator Guidance basics](docs/reliability-lab-product-tour-and-operator-guidance-basics.md)
- [Product Tour and Operator Guidance implementation](docs/product-tour-and-operator-guidance.md)

## Execution lifecycle

1. The API validates the body and `X-Tenant-Id`, hashes the canonical request, and selects the
   explicit execution mode.
2. In default `in_process` mode, it persists acceptance and continues asynchronously in the API
   process.
3. In `postgres_worker` mode, one transaction persists the queued envelope, accepted/queued events,
   encrypted transient command, and optional concurrency-safe idempotency record before `202`.
4. A separate worker claims the job under an exclusive lease and monotonically increasing claim
   version, decrypts the command, and invokes the same core continuation engine. Serialized,
   observed heartbeats maintain a confirmed lease deadline.
5. The engine retains replay material independently when policy permits, resolves the provider, and
   records `attempt.started` before provider work. Live retention requires deployment permission
   plus the request's explicit `encrypted` intent; the default `disabled` intent calls the provider
   without a capsule. Required encrypted persistence completes before any provider attempt. Live
   requests must match the server-configured model and bounded operator constraints and cannot use
   failure injection. Failed attempts record
   normalized evidence before retry, fallback, or stop. In worker mode a generic lease guard checks
   ownership at meaningful continuation boundaries, including immediately after a provider returns.
6. A configured fallback runs once after primary policy exhaustion and makes a successful outcome
   `degraded`.
7. Structured output is validated with Ajv. Requested validation records either success or
   rejection; invalid output fails the execution.
8. Terminal state, attempts, and normalized metadata are persisted; events remain append-only. Only
   the exact current claim version may mark terminal job metadata and clear command ciphertext,
   nonce, and tag. A stale worker stops locally without writing a competing terminal failure.
9. Eligible requests retain a tenant-scoped capsule with explicit expiry. Memory mode is
   process-local; PostgreSQL mode encrypts before persistence and appends lifecycle audit metadata.
10. Tenant-scoped SSE reads events after a sequence cursor from persisted evidence, backfills
    history, sends heartbeats while following, and closes after terminal evidence.
11. Reads hydrate current replay capability, so expiry, deletion, missing keys, or unreadable data
    disable replay. Replay creates a linked execution and records replay start/completion events. A
    replay derived from retained input receives a fresh independently encrypted capsule and expiry.
12. Comparative replay resolves a bounded variation against retained input. Live variants inherit
    the configured provider/model target and accept only live-safe policy/budget changes. A variant
    receives independent retention. Durable mode atomically commits the variant, linkage events,
    job, and experiment, then compares the terminal envelopes.
13. Investigation reads use separate memory/PostgreSQL adapters. Focused tenant-scoped endpoints
    return compact rows, bounded aggregates, and provider/model attempt observations without
    hydrating full envelopes or replay capability.
14. An operator may persist the exact resolved workbench range and canonical filters as a case.
    Cases reference current execution/comparison/provider evidence without copying envelopes,
    prompts, outputs, attempts, events, replay material, or command payloads.
15. A separate derived case-review service resolves each linked source into a bounded current
    summary or explicit unavailable state, projects five fixed readiness checks, and renders the
    same safe projection as a tenant-scoped Markdown packet. A case can remain `resolved` only with
    a non-empty finding and resolution.

## Repository layout

```text
apps/api          Fastify composition root, typed route plugins, schemas, injection tests
apps/worker       PostgreSQL lease/heartbeat polling and durable continuation
apps/web          App Router composition, operator feature folders, styles, workflow Playwright specs
packages/contracts  TypeBox schemas and shared domain contracts
packages/core       Policy engine, ports, in-memory adapters
packages/providers  Fake and OpenAI-compatible providers
packages/db         Domain schema modules, PostgreSQL adapters, queries, crypto, migrations
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
# Edit .env; keep real keys only in this ignored local file or injected deployment secrets.
pnpm dev:infra
pnpm db:migrate
ENABLE_FAILURE_INJECTION=true pnpm dev
```

Root development commands load only repository-root `.env.local` and `.env` before starting web,
API, or worker processes. Already-exported variables win; `.env.local` fills remaining values before
`.env`; `.env.example` is never loaded. Restart the services after changing local environment
configuration. Package-level production entrypoints continue to use injected variables and do not
load repository files through the root development bootstrap.

The development tenant is the transparent header value `demo-tenant`; no tenant row is seeded.
Without `DATABASE_URL` and `REDIS_URL`, the API runs with process-local execution and replay storage
and reports those modes at `/readyz`. To exercise restart-durable replay, set
`REPLAY_CAPSULE_STORE=postgres`, a valid active key version/keyring, and `DATABASE_URL`, then migrate
before starting the API. The public keys in `.env.example` are intentionally unsafe examples; do not
reuse them. The `.env` file is ignored and must never contain production credentials.

For the shortest encrypted live replay setup, keep `EXECUTION_MODE=in_process` and run:

```bash
pnpm dev:infra
pnpm db:migrate
pnpm replay:keygen
# Copy the printed secret into ignored .env.local or .env and add provider settings.
pnpm dev
```

For restart-durable execution, set `EXECUTION_MODE=postgres_worker`,
`REPLAY_CAPSULE_STORE=postgres`, and valid independent command/replay keyrings, then run:

```bash
pnpm db:migrate
pnpm dev:durable
```

The API is on port 4000, the worker exposes process health on port 4001, and the web console is on
port 3000. Durable mode fails closed rather than falling back to in-process continuation.

- Dashboard: <http://localhost:3000>
- API: <http://localhost:4000>
- Swagger UI: <http://localhost:4000/docs>
- OpenAPI JSON: <http://localhost:4000/openapi.json>

`GET /v1/providers` returns configuration evidence only; it does not call or health-check a
provider. With a valid `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_API_KEY`, and `OPENAI_MODEL`, the home
page adds a separate **Live provider execution** section. The browser receives the provider ID and
safe model label, never the endpoint or key. The route should report the live provider as
`configured` and `operatorEligible`; its response must not contain the API key or base URL. Live
input retention remains off per execution by default. When the PostgreSQL vault and
`ALLOW_LIVE_PROMPT_RETENTION=true` are configured, the response adds only the safe encrypted
retention label, hours, per-execution opt-in requirement, and bounded availability reason.

For ephemeral configuration, export the three provider variables in the shell before a root
development command. Exported values take precedence over ignored local files:

```bash
export OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=gpt-4.1-mini
export OPENAI_API_KEY=your-local-key
pnpm dev
```

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

Create a saved case from an exact range:

```bash
curl -sS http://localhost:4000/v1/investigation-cases \
  -H 'content-type: application/json' -H 'x-tenant-id: demo-tenant' \
  -d '{"title":"Retry recovery","question":"Did bounded retry recover?","savedScope":{"range":{"from":"2026-07-28T12:00:00.000Z","to":"2026-07-28T13:00:00.000Z"},"signal":"retry_recovered"}}'
```

Case requests accept bounded plain text and typed internal evidence references only. They have no
author or owner field because the prototype does not authenticate people.

Read the derived case review or download its Markdown packet:

```bash
curl -sS http://localhost:4000/v1/investigation-cases/CASE_ID/review \
  -H 'x-tenant-id: demo-tenant'

curl -sS -OJ http://localhost:4000/v1/investigation-cases/CASE_ID/review-packet \
  -H 'x-tenant-id: demo-tenant'
```

Every linked reference remains visible as available or unavailable. Readiness is a fixed
record-completeness checklist, not a score or correctness claim. An update that would leave the case
`resolved` requires both a non-empty current finding and resolution.

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

| Variable                            | Behavior                                                      |
| ----------------------------------- | ------------------------------------------------------------- |
| `REPLAY_CAPSULE_STORE`              | `memory` (default) or explicit `postgres` durable vault       |
| `REPLAY_CAPSULE_RETENTION_HOURS`    | Positive retention duration; defaults to 24                   |
| `REPLAY_CAPSULE_ACTIVE_KEY_VERSION` | Key version used for new PostgreSQL capsule writes            |
| `REPLAY_CAPSULE_KEYS_JSON`          | Prototype JSON map of versions to base64-encoded 32-byte keys |
| `ALLOW_LIVE_PROMPT_RETENTION`       | Deployment permission; true requires a valid PostgreSQL vault |

The deployment flag is not per-request consent. The live form remains unchecked and sends only
`replayRetention: "disabled" | "encrypted"`; no key, version, store, endpoint, or expiry is
browser-controlled.

Old rows use their stored key version while new rows use the active version. Keep historical keys
configured until their rows expire or are deleted. Environment-variable keys are not production KMS
or full envelope encryption.

## Durable execution configuration

| Variable                               | Behavior                                                 |
| -------------------------------------- | -------------------------------------------------------- |
| `EXECUTION_MODE`                       | `in_process` (default) or explicit `postgres_worker`     |
| `EXECUTION_COMMAND_ACTIVE_KEY_VERSION` | Key version used for new transient command writes        |
| `EXECUTION_COMMAND_KEYS_JSON`          | Independent map of base64-encoded 32-byte command keys   |
| `WORKER_ID`                            | Optional identity; a unique local value is generated     |
| `WORKER_CONCURRENCY`                   | Bounded parallel claims, 1–16; defaults to 1             |
| `WORKER_POLL_INTERVAL_MS`              | Bounded idle polling interval; defaults to 250 ms        |
| `WORKER_LEASE_DURATION_MS`             | Lease duration; defaults to 30 seconds                   |
| `WORKER_HEARTBEAT_INTERVAL_MS`         | Heartbeat interval, which must be shorter than the lease |
| `WORKER_SHUTDOWN_GRACE_MS`             | Bounded active-work drain; defaults to 15 seconds        |
| `WORKER_HEALTH_PORT`                   | Local worker process-health port; defaults to 4001       |

Worker mode also requires `DATABASE_URL`, a migrated schema, and PostgreSQL Replay Vault
configuration so replay capabilities are shared across API and worker processes. Command and replay
keyrings are intentionally separate. Both environment keyrings are prototype key management, not
KMS.

## Commands

| Command                                          | Purpose                                                 |
| ------------------------------------------------ | ------------------------------------------------------- |
| `pnpm dev`, `dev:api`, `dev:web`                 | Run local mode with shared root environment loading     |
| `pnpm dev:durable`, `dev:worker`, `start:worker` | Run durable local mode with the same environment        |
| `pnpm dev:infra`                                 | Start healthy Postgres and Redis services               |
| `pnpm build`                                     | Build every workspace package                           |
| `pnpm lint`, `format:check`, `typecheck`         | Static checks                                           |
| `pnpm audit:docs`, `audit:structure`             | Documentation and source-ownership checks               |
| `pnpm test:unit`                                 | Docker-independent focused tests                        |
| `pnpm test:integration`                          | PostgreSQL repository/job tests; requires migrated DB   |
| `pnpm test:e2e`                                  | Separate API/worker durable browser and comparison flow |
| `pnpm verify`, `verify:full`                     | Static/unit build checks, then DB and browser checks    |
| `pnpm audit:deps`, `audit:unused`, `audit`       | Read-only dependency/dead-code observation              |
| `pnpm audit:runtime`                             | Built workspace export and process import smoke         |
| `pnpm replay:keygen`                             | Print one 32-byte local Replay Vault key; write no file |
| `pnpm verify:local-provider-wire`                | PostgreSQL live original/replay/variant loopback proof  |
| `pnpm verify:live-provider`                      | Explicitly guarded one-request external provider proof  |
| `pnpm verify:live-replay`                        | Guarded two-request external retained Replay proof      |
| `pnpm db:generate`, `db:migrate`, `db:studio`    | Drizzle workflows                                       |
| `pnpm export:repo`, `export:working`             | Guarded compressed exports                              |

## Testing strategy

Unit tests inject clocks, IDs, randomness, provider responses, and repositories; they do not require
real delays. They cover encryption, nonces, authenticated context, expiry, deletion, tenant scope,
key configuration, and live-retention failure. API and unit tests cover asynchronous acceptance,
typed event ordering, SSE backfill/cursors/terminal close, machine projection, variation resolution,
and conservative dimension-level comparison. PostgreSQL integration proves atomic rollback,
ciphertext-only command persistence, concurrent idempotency, lease exclusivity/reclaim, ambiguity
without a duplicate call, command cleanup, key rotation, tenant isolation, replay lifecycle
independence, and atomic comparison variants. Playwright starts separate API and worker processes
plus a loopback provider. Eight focused workflow/guidance specs cover durable execution, Live
Machine, live provider execution, Comparative Replay,
Investigation Workbench, Saved Investigation Cases, case-driven experiments, and operator guidance.
Unique idempotency keys and explicit terminal drains keep the workflows independent. There are
deliberately no broad snapshots.
Saved-case tests cover canonical exact scopes, status/resolved-time behavior, append-only notes,
idempotent tenant-owned evidence links, empty terminal cursor totals, PostgreSQL restart reads,
metadata-only timelines, and the browser save/reopen/update workflow.

## Observability

The service creates spans for policy evaluation, provider attempts, structured-output validation,
persistence creation, and replay-driven execution. Local development exports spans to the console;
setting `OTEL_EXPORTER_OTLP_ENDPOINT` switches to OTLP/HTTP. Each envelope and API submission
contains a 32-character trace correlation ID, and logs include it with the execution ID and tenant.
Prompt bodies and messages are excluded from span attributes and redacted from Pino records.
Live adapter tests additionally prove that authorization, raw provider bodies, endpoints, input,
timeouts, and oversized responses do not cross the normalized result boundary.

## Security and retention

Tenant filtering is enforced in execution and vault adapters, but the prototype header is not
authentication. Authorization, cookies, API keys, messages, and input use log-redaction paths.
PostgreSQL capsules use AES-256-GCM with tenant/execution/schema/key authenticated context; audit
rows contain metadata only. Expiry and deletion revoke replay immediately while normalized evidence
remains. Live retention defaults off, requires deployment permission plus per-execution selection,
and fails before the provider call when required durable encryption cannot be established. Replay
and variant children use new rows and fresh expiry rather than copied ciphertext.
The environment keyring is a prototype, not managed production key infrastructure. See
[`docs/security-and-retention.md`](docs/security-and-retention.md).
Investigation cases can contain bounded operational prose in plaintext. They never copy prompt,
output, replay, command, credential, or provider-body content, and lifecycle events omit note,
finding, and resolution text. Tenant routing still cannot establish authorship.
Provider capability responses exclude keys, endpoints, query strings, headers, and raw
configuration. Live model selection is server-owned, failure injection is rejected before fetch,
responses are size bounded, and provider error bodies are never returned.

## Design tradeoffs

- `in_process` remains intentionally non-durable. In `postgres_worker`, `202` follows committed
  execution/event/job state and work can survive API loss before a provider call.
- Leases provide at-least-once job delivery, not exactly-once provider effects. Reclaimed
  nonterminal executions with prior attempt activity fail conservatively as ambiguous.
- Events are append-only, while the execution row is a query projection updated to its latest state.
- The memory repository keeps unit tests and an infrastructure-free demo honest, but is not shared
  or durable.
- The narrow generic live adapter avoids SDK/domain coupling and preserves cross-provider Chat
  Completions compatibility. OpenAI-specific Responses support is a separately elected future
  adapter; see ADR 0013.
- Execution list capability hydration uses bounded parallel per-row vault inspection. This keeps
  state current for the small prototype but needs batching or a join before large pagination.
- Capsule lifecycle/audit mutations are transactional inside the vault, but execution projection
  updates are a separate consistency boundary.
- Variant acceptance and experiment persistence are atomic only in PostgreSQL worker mode.
  In-process mode deliberately keeps the simpler two-operation boundary.
- Case-driven comparison creation and its following case evidence link are not atomic. A link
  failure preserves the comparison and returns an explicit link-only recovery action. The case
  review derives that action after reload and records explicit completion when linking succeeds.

## Production-hardening direction

- **Identity and tenancy:** authenticated principals, tenant membership, database row-level security,
  service-to-service authorization.
- **Execution consistency:** resumable recovery, transactional outbox, cancellation, reconciliation
  tooling, and provider-supported idempotency where available.
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

In-process execution cannot survive API loss. Worker mode survives accepted work before provider
activity, but cannot prove exactly-once calls or resume an ambiguous attempt; it intentionally stops
instead of automatically duplicating the call. Readiness checks database tables and selected modes,
not a full migration version or global worker liveness. Memory capsules disappear on restart.
PostgreSQL replay deletion is a tombstone, not physical backup erasure. Audits lack authenticated
actors, environment keyrings are not KMS, Redis implementations are skeletons, cost is normalized
but not enforced, and circuit/rate state is process-local. Case experiment creation is not
idempotent across clients or HTTP retries, and comparison creation is not atomic with case linking.
The provider capability route reports configuration rather than health. A live proof is one bounded
execution, not an SLA, price, quota, answer-quality, or universal provider-health claim.
