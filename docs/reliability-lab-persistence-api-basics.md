# Reliability Lab: Persistence and API Composition Basics

This document explains the second phase of the human-comprehension refactor in plain language.

## The goal in one sentence

**The database and API layers should make it obvious where data is stored, how it is reconstructed, which transaction protects a workflow, and which HTTP route exposes each capability.**

Phase 1 gave the contracts and core domain understandable homes.

Phase 2 does the same for:

```text
packages/db
apps/api
```

The behavior should remain unchanged.

The address of the code becomes clearer.

---

## Where these layers fit

Reliability Lab separates several kinds of responsibility:

```text
contracts:
  What data crosses boundaries?

core:
  What does the system mean and decide?

db:
  How is domain evidence stored and queried in PostgreSQL?

api:
  How do HTTP requests reach domain services?

worker:
  Which process performs durable jobs?

web:
  How does an operator use the system?
```

The database does not decide whether retry is appropriate.

The API does not implement replay encryption.

Those layers adapt the core behavior to infrastructure.

---

## Persistence is more than “save this object”

A persistence adapter may need to:

- map a domain object into table columns;
- write several related rows in one transaction;
- append an event without rewriting the envelope;
- reconstruct an execution from projection, attempts, and events;
- enforce tenant scope;
- query compact summaries without hydrating full envelopes;
- lock a durable job;
- fence stale workers;
- encrypt sensitive payloads;
- preserve idempotency;
- calculate aggregate evidence.

Those are different responsibilities.

Putting all of them in `db/src/index.ts` or one 800-line query file makes the layer harder to understand than the database itself.

---

## Schema, row, domain object, and read model

These terms are related but not interchangeable.

### Database schema

The Drizzle table definition.

```ts
export const executions = pgTable("executions", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  status: text("status").notNull(),
});
```

It describes stored columns, indexes, keys, and references.

### Database row

One value returned from PostgreSQL.

```text
id
tenant_id
status
created_at
```

Dates may be JavaScript `Date` objects. JSONB fields may contain typed data.

### Domain object

The structure understood by the core system.

```ts
interface ExecutionEnvelope {
  executionId: string;
  tenantId: string;
  status: ExecutionStatus;
  attempts: ExecutionAttempt[];
  events: ExecutionEvent[];
}
```

It may combine several tables.

### Read model

A shape built specifically for one operator query.

```ts
interface ExecutionSummary {
  executionId: string;
  status: ExecutionStatus;
  attemptCount: number;
  retryRecovered: boolean;
  fallbackUsed: boolean;
}
```

It deliberately does not contain the full execution.

A useful database layer makes these transformations visible.

---

## What is a repository?

A repository implements a core persistence port.

The core may require:

```ts
interface ExecutionRepository {
  create(execution: ExecutionEnvelope): Promise<void>;
  update(execution: ExecutionEnvelope): Promise<void>;
  findById(tenantId: string, executionId: string): Promise<ExecutionEnvelope | null>;
}
```

The PostgreSQL adapter implements that contract:

```text
PostgresExecutionRepository
```

The repository owns persistence behavior.

It should not also own:

- database connection creation;
- comparison persistence;
- every investigation SQL query;
- replay cryptography;
- the package’s public export list.

---

## What is mapping?

Mapping translates between the domain and database representation.

### Write mapping

```text
ExecutionEnvelope
      ↓
executions row
execution_attempts rows
execution_events rows
```

### Read mapping

```text
executions row
+ attempt rows
+ event rows
      ↓
ExecutionEnvelope
```

Named mapping functions are useful because they reveal the boundary:

```ts
toExecutionInsert(...)
toExecutionUpdate(...)
toEventInsert(...)
hydrateExecution(...)
```

A mapper is not business policy.

It should preserve meaning, not invent it.

---

## What is hydration?

Hydration reconstructs a richer domain object from stored pieces.

An execution list may read only the `executions` table.

An execution detail needs:

```text
execution projection
+ ordered attempts
+ ordered events
+ current replay capability
```

Hydration is appropriate for detail views.

It is inappropriate for every row in a large investigation search.

That is why Reliability Lab has separate write repositories and investigation read models.

---

## What is a transaction?

A transaction makes several database changes succeed or fail together.

For durable acceptance, the system may need to store:

```text
initial execution
+ execution.accepted event
+ encrypted job
+ idempotency record
```

The API should return `202` only if the required records commit together.

Without the transaction, the system could create:

- an execution with no job;
- a job with no execution;
- an idempotency record pointing nowhere;
- a comparison with no runnable variant.

A transaction expresses a real invariant.

It should live in a module named for that workflow, not be hidden among unrelated queries.

---

## Command persistence versus read queries

Database code has two broad personalities.

### Command persistence

Changes state.

Examples:

- accept an execution;
- append an event;
- claim a job;
- renew a lease;
- save a case;
- add evidence;
- delete a replay capsule.

Command paths care about:

- transactions;
- row locks;
- ownership;
- idempotency;
- write ordering;
- sensitive-data lifecycle.

### Read queries

Inspect state.

Examples:

- search executions;
- calculate reliability summary;
- observe provider attempts;
- list saved cases;
- load a case timeline.

Read paths care about:

- bounded query count;
- pagination;
- filters;
- row mapping;
- sample size;
- avoiding full-envelope hydration.

These responsibilities deserve separate modules even when they use the same tables.

---

## Why split the schema?

One large `schema.ts` can work.

As the system grows, it stops explaining which tables belong together.

A clearer organization may be:

```text
schema/
  executions.ts
  durable-execution.ts
  comparisons.ts
  investigation-cases.ts
  replay.ts
  index.ts
```

Relationships remain explicit:

```text
attempts reference executions
jobs reference executions
comparisons reference executions
case notes reference cases
replay capsules reference executions
```

The split must not change the actual SQL schema.

No new migration should be required merely because TypeScript files moved.

---

## What should `packages/db/src/index.ts` do?

It should present the public database package API:

```ts
export * from "./database/database.js";
export * from "./execution/postgres-execution-repository.js";
export * from "./durable/postgres-durable-execution-store.js";
export * from "./replay/postgres-replay-capsule-store.js";
```

It should not create pools, hydrate executions, and persist comparison experiments inside the barrel.

The same principle applies:

> Root `index.ts` files are maps, not cities.

The implemented package root is 19 export-only lines. The established unbounded execution `list`
method remains compatibility-only; bounded operator search belongs to the Investigation Workbench.

---

## What is an API composition root?

An API composition root assembles the transport.

It knows that the application uses:

- Fastify;
- CORS;
- Swagger;
- route plugins;
- an error handler;
- composed domain services.

A small `buildApp` might conceptually do:

```text
create Fastify app
→ install platform plugins
→ install error handling
→ register operation routes
→ register execution routes
→ register replay routes
→ register investigation routes
→ return app
```

It should not contain every schema and handler in one file.

---

## What is a route plugin?

A Fastify route plugin groups related endpoints.

Example:

```text
routes/
  operations.ts
  executions.ts
  replay.ts
  comparisons.ts
  investigations.ts
  investigation-cases.ts
```

The execution route plugin owns HTTP concerns such as:

- URL;
- headers;
- request body schema;
- response schema;
- status code;
- logging;
- calling `ExecutionService`.

It does not own retry behavior.

A route file should answer:

> Which HTTP operations expose this feature?

---

## Request schema, handler, service

These are three different layers.

### Request schema

Defines what HTTP input is accepted.

```ts
headers: TenantHeadersSchema;
body: CreateExecutionBodySchema;
```

TypeBox and Fastify validate the input.

### Handler

Maps validated transport data into a service call.

```ts
const submission = await service.submit({
  tenantId: request.headers["x-tenant-id"],
  body: request.body,
});
```

### Service

Implements the domain workflow.

```text
ExecutionService.submit
```

The handler should remain thin.

When a handler contains policy decisions, persistence logic, and cryptography, the boundary has collapsed.

---

## What is shared API infrastructure?

Some API behavior belongs to all routes:

- tenant header schemas;
- standard error response;
- query array normalization;
- investigation range parsing;
- error-to-status mapping;
- Swagger setup;
- logging redaction;
- CORS configuration.

These deserve clear shared modules.

They should not become a new `utils.ts` landfill.

Use names such as:

```text
http/error-mapper.ts
http/common-schemas.ts
http/query-values.ts
plugins/openapi.ts
```

---

## What is error mapping?

Core errors describe domain failure:

```text
ExecutionNotFoundError
IdempotencyConflictError
RateLimitRejectedError
InvestigationQueryError
```

The API translates them into HTTP:

```text
404 not_found
409 idempotency_conflict
429 rate_limit_rejected
400 invalid_investigation_query
```

This mapping should be in one discoverable place.

Routes should not each invent their own interpretation of the same error.

Unexpected errors should remain internal errors without leaking sensitive details.

---

## What should remain stable?

A behavior-preserving API and persistence refactor should not change:

- HTTP paths;
- methods;
- status codes;
- request bodies;
- response bodies;
- OpenAPI contracts;
- tenant behavior;
- event-stream semantics;
- database tables;
- columns;
- indexes;
- migrations;
- transaction boundaries;
- encryption;
- replay retention;
- worker fencing;
- investigation calculations;
- case persistence.

The code moves.

The observable system does not.

---

## How do we prove API stability?

Useful checks include:

- all existing API tests;
- normalized OpenAPI comparison before and after;
- route inventory comparison;
- package typechecking;
- Playwright workflows;
- manual requests for important paths.

A refactor should not quietly change:

```text
202 to 200
optional to required
string to nullable string
missing response field
CORS method list
SSE headers
error code
```

Those details are public behavior.

---

## How do we prove database stability?

Useful checks include:

- no migration files added or changed;
- clean migration from an empty PostgreSQL database;
- all integration tests;
- schema table/column/index inventory comparison;
- package-root export comparison;
- transaction rollback tests;
- encryption and plaintext scans;
- query-count tests;
- query-plan review for investigation paths.

Moving schema definitions between files should not alter the database.

---

## Why split tests too?

A 700-line test file has the same navigation problem as a 700-line production file.

A developer should be able to find tests by behavior:

```text
operations.test.ts
executions.test.ts
replay.test.ts
comparisons.test.ts
investigations.test.ts
investigation-cases.test.ts
```

Shared setup may live in:

```text
test/support/build-test-app.ts
test/support/fixtures.ts
```

The goal is not fewer tests.

It is understandable evidence.

---

## Avoiding dependency-direction mistakes

The desired direction is:

```text
contracts
   ↑
core ports
   ↑
database adapters
   ↑
API and worker composition
```

The database package may implement core ports.

Core must not import PostgreSQL.

API routes may call core services.

Core must not import Fastify.

Within `packages/db`, modules should import the file that owns `ReliabilityDatabase`, not `./index.js`.

Within `apps/api`, route plugins should import shared API modules directly.

---

## What should Phase 2 make easy to find?

After the refactor, these questions should have quick answers:

- Where is the PostgreSQL pool created?
- Where is `ReliabilityDatabase` defined?
- Where is an execution row mapped?
- Where is an execution hydrated?
- Where is a comparison experiment persisted?
- Where is atomic durable acceptance implemented?
- Where is replay capsule encryption performed?
- Where is the execution-search SQL?
- Where is reliability-summary SQL?
- Where are provider observations calculated?
- Where is a saved-case update transaction?
- Which route creates an execution?
- Which route streams events?
- Which route creates a saved case?
- Where are API errors mapped?
- Where is Swagger configured?

The codebase tour should answer all of them.

---

## Final mental model

The core is the machine.

The database adapter is the storage and evidence room.

The API is the labeled control panel.

```text
Control panel:
  accepts a validated operator action

Machine:
  decides what the action means

Storage room:
  preserves evidence and durable work

Control panel:
  returns a safe result
```

Phase 2 labels the shelves and separates the controls.

It does not redesign the machine.
