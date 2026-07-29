# Persistence and API Patterns

This guide explains the actual Phase 2 boundaries in `packages/db` and `apps/api`. The companion
[plain-language basics](reliability-lab-persistence-api-basics.md) introduces the vocabulary.

## Database connection and schema

`packages/db/src/database/database.ts` owns both `ReliabilityDatabase` and `createDatabase`.
`createDatabase` creates the `pg` pool and Drizzle client, imports the complete schema map, and
returns the established `{ db, pool }` shape. Repositories receive `ReliabilityDatabase`; they do
not create connections.

Schema definitions are grouped by stored domain:

```text
schema/
  executions.ts             executions, attempts, events, idempotency
  durable-execution.ts      encrypted execution jobs and lease state
  comparisons.ts            comparison experiment definitions
  investigation-cases.ts    case state, notes, evidence, timeline
  replay.ts                 encrypted capsules and audit metadata
  schema-types.ts           shared bytea declaration
  index.ts                  complete schema export map
```

`src/schema.ts` is an export-only Drizzle Kit compatibility map. Moving these definitions did not
change table names, columns, references, indexes, or migrations.

## Repository ports and PostgreSQL adapters

Core defines persistence ports; DB implements them:

| Core boundary                       | PostgreSQL adapter                                              |
| ----------------------------------- | --------------------------------------------------------------- |
| execution repository                | `execution/postgres-execution-repository.ts`                    |
| comparison experiment repository    | `comparison/postgres-comparison-repository.ts`                  |
| durable acceptance and job store    | `durable/postgres-durable-execution-store.ts`                   |
| replay capsule store                | `replay/postgres-replay-capsule-store.ts`                       |
| Investigation Workbench read model  | `investigation/postgres-investigation-read-repository.ts`       |
| saved investigation case repository | `investigation-cases/postgres-investigation-case-repository.ts` |

The package root is a public export map. Internal DB modules import direct owners such as
`database/database.ts` and `schema/executions.ts`.

## Row mapping and hydration

`execution/execution-row-mappers.ts` makes execution writes and reads explicit:

- `toExecutionInsert` maps the accepted projection;
- `toExecutionUpdate` maps mutable projection fields;
- `toExecutionEventInsert` maps append-only events;
- `hydrateExecution` combines one execution row with ordered attempt and event rows.

`comparison/comparison-row-mappers.ts` preserves nullable variant IDs, unavailable reasons,
resolved configuration, and timestamps. Saved-case mapping lives in
`investigation-cases/case-row-mappers.ts`; canonical evidence references are mapped without copying
execution envelopes, prompts, outputs, commands, or replay payloads.

Hydration is used for execution and case detail. The bounded investigation read path returns compact
read models instead of hydrating full envelopes.

## Commands, reads, and transactions

Command modules own invariants that must commit together:

- `PostgresDurableExecutionStore.acceptExecution` atomically stores accepted execution evidence,
  encrypted transient command data, and optional idempotency state.
- `case-command-transactions.ts` owns case creation/update, append-only note insertion, idempotent
  evidence links, evidence removal, and their metadata-only timeline records.
- execution creation/update and attempt replacement remain transaction-scoped in
  `PostgresExecutionRepository`.

Read modules are named by query purpose:

- `execution-search-query.ts`: one bounded page query plus one fixed count query;
- `reliability-summary-query.ts`: one aggregate query plus one trend query;
- `provider-observations-query.ts`: one attempt-level provider/model query;
- `case-list-query.ts`: stable page query plus fixed total count;
- `case-detail-query.ts`: current state plus ordered notes, evidence, and timeline.

Every query retains tenant and `[from, to)` time conditions where applicable. SQL was extracted by
responsibility, not stylistically rewritten.

## Encryption boundaries

Durable commands and replay capsules remain separate cryptographic concepts:

- `durable/execution-command-crypto.ts` parses the durable runtime keyring and encrypts transient
  worker commands.
- `replay/postgres-replay-capsule-store.ts` owns capsule encryption/decryption beside the bounded
  vault lifecycle.
- `replay/replay-runtime-config.ts` parses fail-closed replay retention and key configuration.

Both preserve AES-256-GCM, authenticated context, key versions, and ciphertext lifecycle. Neither
shares keys or payload formats with the other.

## Fastify composition and route plugins

`apps/api/src/app.ts` is the composition root. It:

1. creates Fastify with established AJV and redacted logging settings;
2. installs CORS, Swagger, and Swagger UI through `plugins/platform.ts`;
3. installs the shared safe error handler;
4. registers typed feature route plugins;
5. returns the app.

Route modules own paths, methods, HTTP schemas, status codes, thin service mapping, and safe
route-specific logs:

```text
routes/
  operations.ts
  executions.ts
  execution-events.ts
  replay.ts
  comparisons.ts
  investigations.ts
  investigation-cases.ts
```

Dependencies arrive through typed plugin options from `app-options.ts`. Route modules do not create
repositories or implement domain policy.

## TypeBox schemas and query values

Transport schemas live under `schemas/`. Contract-owned TypeBox schemas are reused directly.
Transport-only headers, links, error bodies, route parameters, and query shapes stay in the API.

`ExecutionEnvelopeSchema` and `ComparisonViewSchema` deliberately use `Type.Unsafe`: the established
domain interfaces do not have complete runtime TypeBox schemas, while the API must preserve its
existing JSON Schema. The nearby comments make that boundary visible.

`http/query-values.ts` owns exact investigation range pairing and repeated/comma-separated array
normalization. TypeBox and core continue to own bounds and cursor validation.

## Error and SSE boundaries

`http/error-mapper.ts` maps known domain errors, Fastify validation errors, generic 4xx errors, and
safe internal failures. The installed handler preserves warning logs without returning sensitive
error detail.

`routes/execution-events.ts` owns the SSE HTTP boundary: tenant headers, cursor precedence,
backfill, caught-up terminal completion, headers, development CORS echo, heartbeat comments,
terminal close, and client-abort cleanup. `event-stream.ts` remains the transport-independent
polling iterator and formatter.

## Compatibility-only legacy list

`PostgresExecutionRepository.list` remains unbounded for existing package/API compatibility. New
scalable operator reads should use the bounded Investigation Workbench queries. Phase 2 deliberately
did not change this legacy behavior.

Use [Change recipes](change-recipes.md) before extending a contract, query, transaction, evidence
type, or read endpoint. It identifies the adjacent persistence, API, web, test, and documentation
boundaries that must remain aligned.
