# Reliability Lab: From Working Software to Owned Software

This document explains the purpose of the human-comprehension refactor in plain language.

## The goal in one sentence

**Reliability Lab should remain fully working while becoming easy enough for a competent TypeScript engineer to locate, explain, modify, and defend without decoding giant files or compiler riddles.**

The project has reached an important transition:

```text
AI-assisted construction
        ↓
Verified working system
        ↓
Human-comprehension refactor
        ↓
Owned software
```

The refactor is not a retreat from AI-assisted development.

It is the step that converts generated capability into engineering ownership.

---

## What does “owning the software” mean?

You own the software when you can answer questions such as:

- Where does a request enter the system?
- Which module accepts an execution?
- Where are retry and fallback decisions made?
- Which code encrypts replay capsules?
- Which code claims durable jobs?
- What prevents a stale worker from finishing a newer claim?
- Where are comparison dimensions calculated?
- How does the Investigation Workbench calculate fallback dependence?
- Which contracts are public?
- What must remain true when a module changes?
- Which limitations are deliberate?

Ownership does not require memorizing every line.

It requires a reliable mental map and the ability to follow important paths.

---

## Four levels of understanding

### 1. Product understanding

You can explain what the feature does for an operator.

Example:

> Comparative Replay reruns retained input under controlled changed conditions and reports dimension-level tradeoffs without inventing a universal winner.

### 2. Architecture understanding

You can explain which package owns each responsibility.

Example:

```text
contracts:
  portable data shapes

core:
  domain behavior and ports

db:
  PostgreSQL adapters

api:
  HTTP composition and routes

worker:
  durable job polling and execution

web:
  operator experience
```

### 3. Flow understanding

You can trace one request through the code.

Example:

```text
POST /v1/executions
→ validate request contract
→ accept execution
→ persist accepted evidence
→ queue durable command
→ worker claims job
→ execution policy runs
→ events are persisted
→ SSE projects events
→ UI updates
```

### 4. Local code understanding

You can open the relevant module and understand the names, inputs, outputs, and invariants without first reading 1,500 unrelated lines.

The comprehension refactor primarily improves levels 3 and 4.

---

## What is a module?

A module is a file or small folder with one understandable purpose.

Good module purposes include:

- build an execution envelope;
- record execution events;
- run retry and fallback policy;
- manage replay capability;
- claim durable jobs;
- compare two executions;
- canonicalize investigation scope;
- persist saved cases.

Weak module purposes include:

- miscellaneous helpers;
- all core behavior;
- every API route;
- shared things;
- index.

A useful file name answers:

> Why would I open this file?

---

## What is a god file?

A god file contains many unrelated responsibilities because adding one more thing was initially easier than deciding where it belonged.

Typical symptoms:

- thousands of lines;
- many classes, interfaces, helpers, and errors;
- unrelated changes often touch the same file;
- private methods form hidden subsystems;
- tests require searching by line number;
- an `index.ts` contains the application rather than exports;
- understanding one feature requires scanning the whole file.

A god file may work perfectly.

Its defect is that the structure does not communicate the design.

---

## What should `index.ts` do?

A package entrypoint should mostly present the package’s public surface.

Example:

```ts
export * from "./execution/execution-service.js";
export * from "./execution/ports.js";
export * from "./durable/durable-execution-worker.js";
export * from "./replay/replay-store.js";
```

It should not contain a 1,900-line implementation.

A useful rule:

> Root `index.ts` files are maps, not cities.

Internal modules should import directly from the module that owns a type.

Avoid:

```ts
import type { ExecutionRepository } from "./index.js";
```

Prefer:

```ts
import type { ExecutionRepository } from "./execution/ports.js";
```

Importing from the same package’s barrel hides dependencies and can create circular module graphs.

---

## What is a public API?

The public API is what another package imports from a package root.

Example:

```ts
import {
  ExecutionService,
  MemoryExecutionRepository,
  DurableExecutionWorker,
} from "@reliability-lab/core";
```

The refactor may move those implementations into new internal files, but these imports should continue to work.

```text
Before:
  core/src/index.ts contains ExecutionService

After:
  core/src/execution/execution-service.ts contains ExecutionService
  core/src/index.ts re-exports ExecutionService
```

The internal address changes.

The public address remains stable.

---

## Why are explicit types sometimes better?

Type inference is valuable when it removes repetition without hiding meaning.

It becomes harmful when understanding the domain requires knowing an obscure compiler rule.

For a central event contract, this is technically compact:

```ts
type EventPayload = ExecutionEvent extends infer Event
  ? Event extends ExecutionEvent
    ? Omit<Event, keyof EventGenerated>
    : never
  : never;
```

But the reader must understand:

- conditional types;
- distribution over unions;
- `infer`;
- how `Omit` behaves;
- why generated fields must be removed.

A clearer domain model defines the concepts in the direction they are used:

```ts
type AttemptStartedPayload = {
  type: "attempt.started";
  attemptNumber: number;
  provider: string;
  model: string;
};

type RetryScheduledPayload = {
  type: "retry.scheduled";
  attemptNumber: number;
  delayMs: number;
  reason: string;
};

type ExecutionEventPayload = AttemptStartedPayload | RetryScheduledPayload;
```

Then stored events add explicit generated metadata.

The code is longer.

The meaning is cheaper.

---

## What are discriminated unions?

A discriminated union is a set of related object shapes distinguished by one literal field.

```ts
type Result = { kind: "success"; value: string } | { kind: "failure"; error: Error };
```

The `kind` field tells TypeScript and the reader which shape is present.

Reliability Lab uses this pattern for:

- execution events;
- replay capability;
- provider results;
- evidence links;
- comparison dimensions;
- ownership outcomes.

This is a useful TypeScript feature because it mirrors domain alternatives explicitly.

The comprehension problem is not discriminated unions themselves.

The problem is hiding their shapes behind unnecessary type machinery.

---

## What does `#field` mean?

JavaScript supports runtime-private class fields:

```ts
class Example {
  readonly #repository: Repository;
}
```

The `#` means outside code cannot access the field.

This is stronger than TypeScript’s compile-time-only `private`.

The syntax is legitimate and useful.

But private fields do not make a giant class cohesive.

A 1,000-line class with 25 private methods may contain several modules that should become named collaborators.

The refactor should keep runtime privacy where it helps while reducing the size and responsibility of each class.

---

## Ports and adapters

Reliability Lab separates domain decisions from infrastructure through ports.

A **port** describes what the domain needs:

```ts
interface ExecutionRepository {
  create(...): Promise<void>;
  findById(...): Promise<ExecutionEnvelope | null>;
}
```

An **adapter** implements that need:

```text
MemoryExecutionRepository
PostgresExecutionRepository
```

The domain knows the port.

It does not know Drizzle or PostgreSQL.

This is a central architectural decision worth preserving.

The refactor should make ports easier to locate, not merge them into implementation files.

---

## TypeBox, Ajv, and TypeScript

Reliability Lab uses three related type systems for different purposes.

### TypeScript types

Used by developers and the compiler.

They disappear at runtime.

### TypeBox schemas

Runtime JSON Schema objects authored through a TypeScript-friendly API.

They support:

- Fastify validation;
- OpenAPI generation;
- inferred TypeScript types.

### Ajv

A runtime JSON Schema validator.

Reliability Lab uses it for dynamic structured-output schemas supplied with an execution.

A useful rule:

```text
API contract defined by project:
  TypeBox

Arbitrary JSON Schema supplied as data:
  Ajv

Developer compile-time reasoning:
  TypeScript
```

The codebase guide should show where each is used.

---

## A behavior-preserving refactor

A behavior-preserving refactor changes structure without intentionally changing external behavior.

Examples:

- move a class to a named module;
- extract retry logic into a policy runner;
- replace a cryptic derived type with explicit named payload types;
- split API routes into plugins;
- split SQL read models by query purpose;
- move page sections into components;
- reorganize tests by feature.

It should not:

- change API contracts;
- alter retry behavior;
- add new product features;
- rename public exports;
- modify persistence semantics;
- create migrations;
- redesign the UI.

Tests are the safety net, but they are not the only acceptance criterion.

The new structure must also be more understandable.

---

## Avoid the opposite failure: confetti architecture

Splitting every function into its own file is not clarity.

It creates a treasure hunt.

Useful modules are cohesive and substantial enough to explain one responsibility.

A reasonable target is often:

- small utilities: tens of lines;
- ordinary modules: roughly 100–300 lines;
- complex services: perhaps 300–500 lines;
- larger files require a clear reason.

Line count is a warning signal, not a law of nature.

The real question is:

> Does this file have one nameable purpose?

---

## What documentation should exist afterward?

### Codebase tour

A map of packages and important modules.

It should answer:

- where to start;
- where each responsibility lives;
- what each package exports;
- which files are composition roots;
- where tests live.

### System flows

Plain-language and code-path walkthroughs for:

- execution;
- replay and comparison;
- durable worker execution;
- investigation and saved cases.

Each walkthrough should name actual files and functions.

### Type-system guide

Examples from the repository explaining:

- TypeBox and Ajv;
- discriminated unions;
- event payload versus stored event;
- private fields;
- exact optional properties;
- the few advanced patterns that remain.

### Architecture decision context

The existing ADRs explain why major choices were made.

The new guides explain where those choices live in code today.

---

## How to review the refactor

Do not review only by asking whether tests pass.

Open the repository and try these tasks:

1. Find the type for `attempt.failed`.
2. Find where generated event metadata is added.
3. Find where an execution becomes degraded.
4. Find where retry delay is calculated.
5. Find where a durable worker loses its lease.
6. Find where a replay capsule is inspected.
7. Find where a comparison labels a dimension mixed.
8. Find where fallback dependence is calculated.
9. Find where a saved case canonicalizes its scope.
10. Find the API route that creates a case.

Each answer should take seconds, not archaeology.

---

## What this means for AI-assisted development

The strong story is not:

> AI wrote a sophisticated repository for me.

It is:

> I used AI to accelerate construction, then audited the architecture, found correctness and maintainability issues, and refactored the result until I could explain and own it.

AI can generate implementation volume quickly.

Human engineering still decides:

- what the system means;
- which tradeoffs are acceptable;
- which abstractions clarify;
- which cleverness should be removed;
- which boundaries matter;
- whether the result can be maintained.

---

## Final mental model

Working software is a machine that runs.

Owned software is a machine with:

- labeled controls;
- an understandable wiring diagram;
- accessible service panels;
- documented operating limits;
- an engineer who knows why the machine was built this way.

The goal is not to make Reliability Lab simplistic.

The goal is to make its sophistication legible.

## Where the ownership map lives now

Phase 1 expresses the contracts and core architecture directly in the source tree:

- [Codebase tour](codebase-tour.md) maps questions to files and symbols.
- [System flows](system-flows.md) follows the established execution and investigation paths.
- [TypeScript patterns](typescript-patterns.md) explains explicit event payloads, TypeBox/Ajv,
  discriminated unions, exact optional properties, `satisfies`, and runtime-private fields.

The structural audit runs as `pnpm audit:structure` and is part of `pnpm verify`.
