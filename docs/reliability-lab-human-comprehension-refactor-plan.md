# Reliability Lab Human-Comprehension Refactor Plan

> **Historical completed plan.** All four phases were completed before the later Horizon 5
> movements. Current ownership rules live in `AGENTS.md`, the codebase tour, pattern guides, and
> change recipes; current product status lives in the roadmap and Horizon 5 closure basics.
>
> This is a staged engineering plan, not a new product horizon. Feature expansion pauses while the repository is reorganized into software its owner can explain, defend, and modify.

## Current stable baseline

The product currently supports:

- execution evidence and normalized failures;
- trusted encrypted replay;
- live persisted-event visualization;
- Comparative Replay;
- durable worker execution with fenced leases;
- Investigation Workbench search and aggregate signals;
- Saved Investigation Cases.

The current exported baseline contains approximately 17,700 lines of TypeScript and TSX.

The largest production files are:

| File                                       | Approximate lines |
| ------------------------------------------ | ----------------: |
| `packages/core/src/index.ts`               |             1,929 |
| `apps/api/src/app.ts`                      |               969 |
| `packages/contracts/src/index.ts`          |               862 |
| `packages/db/src/investigation.ts`         |               802 |
| `packages/core/src/comparison.ts`          |               617 |
| `apps/web/app/investigations/page.tsx`     |               616 |
| `packages/core/src/investigation-cases.ts` |               607 |
| `packages/core/src/investigation.ts`       |               515 |

The system works, but important responsibilities are difficult to locate and several package barrels contain implementation rather than navigation.

## Refactor outcome

A competent TypeScript engineer should be able to:

- identify package responsibilities from the source tree;
- trace an execution from HTTP request to terminal evidence;
- find replay, comparison, worker, investigation, and saved-case code quickly;
- understand central domain types without advanced conditional-type archaeology;
- modify one subsystem without opening unrelated god files;
- preserve the existing public package imports;
- explain the design in an interview using concrete files and flows.

## Roadmap placement

This work is a cross-cutting engineering interlude.

```text
Saved Investigation Cases established
        ↓
Human-Comprehension and Ownership Pass
        ↓
Product Tour and Operator Guidance
        ↓
Resume Horizon 5 product work
```

It is not Horizon 6 and should not advance tenant-security claims.

The product roadmap should continue to show Horizon 5 as incomplete.

## Why the work is staged

A whole-repository mechanical split would create a large, difficult-to-review diff and could simply redistribute confusion into dozens of tiny files.

The refactor therefore proceeds by architectural layer.

## Phase 0: Freeze and map the baseline

Before structural edits:

- commit the completed Saved Investigation Cases slice;
- run a clean `pnpm verify:full`;
- record package-root public exports;
- record production file line counts;
- record important flow entrypoints;
- confirm no migrations or contract changes are required;
- preserve an archive of the stable baseline.

Completion signal:

> The team can compare the refactored repository against a known working baseline.

## Phase 1: Contracts and core domain

Primary targets:

- `packages/contracts/src/index.ts`
- `packages/core/src/index.ts`
- `packages/core/src/comparison.ts`
- `packages/core/src/investigation.ts`
- `packages/core/src/investigation-cases.ts`

Outcomes:

- package root barrels contain exports rather than implementations;
- contract families live in named modules;
- execution event payloads are explicit named domain types;
- ports live in discoverable modules;
- `ExecutionService` remains the public facade but delegates cohesive responsibilities;
- durable worker and lease logic live under a durable namespace;
- replay, comparison, investigation, and saved-case logic have named homes;
- internal modules import direct owners, never their own package barrel;
- package-root public exports remain stable.

Completion signal:

> The central execution and domain paths can be located and explained without opening a file larger than roughly 500 lines.

### Implemented Phase 1 structure

The contracts and core package roots are now export-only maps. Execution events use named payload,
metadata, and stored-event types. `ExecutionService` delegates provider policy to `ExecutionRunner`;
event metadata, execution preparation, backoff, structured validation, and terminal failure have
named modules. Durable, replay, comparison, Investigation Workbench, and saved-case responsibilities
live in discoverable feature folders.

The exact current map is maintained in [the codebase tour](codebase-tour.md), with concrete call
paths in [system flows](system-flows.md). Phase 2 API and persistence splitting remains deliberately
separate from the completed Phase 1 change set.

## Phase 2: Persistence and API composition

Primary targets:

- `packages/db/src/index.ts`
- `packages/db/src/investigation.ts`
- `packages/db/src/investigation-cases.ts`
- `packages/db/src/schema.ts`
- `apps/api/src/app.ts`
- large API tests

Outcomes:

- database connection/types are separate from repository exports;
- execution mapping lives beside execution persistence;
- investigation search, summary, provider observations, and cursor logic are separate modules;
- saved-case persistence separates queries, row mapping, and command transactions;
- Fastify routes are grouped by domain;
- app construction is a small composition root;
- shared route schemas and error mapping are discoverable;
- internal database modules do not import from `./index.js`;
- API behavior and OpenAPI contracts remain unchanged.

Completion signal:

> A route or SQL read model can be found by feature name, and API composition no longer requires scanning a thousand-line file.

### Implemented Phase 2 structure

`packages/db/src/index.ts` is now a 19-line export-only public map. Pool/Drizzle construction lives
in `database/database.ts`; schema definitions are grouped by execution, durable execution,
comparison, saved-case, and replay domains. Execution and comparison mapping have named modules.
Durable and replay persistence live under separate feature folders with independent command and
capsule cryptographic configuration.

The PostgreSQL Investigation Workbench shell delegates to separately named execution search,
reliability aggregate/trend, and provider observation query modules. Saved cases separate stable
list/count SQL, detail hydration, row/reference mapping, and command transactions. Query counts,
tenant/time predicates, cursor totals, encryption, and transaction boundaries remain established
behavior.

`apps/api/src/app.ts` is a small composition root. Platform registration, error mapping, query
normalization, transport schemas, execution SSE, and each domain route family have discoverable
modules. `buildApp(options)`, normalized OpenAPI, and the Fastify route inventory remain unchanged.
API and database tests are grouped by behavior with shared setup.

The structural audit now covers DB and API export maps, direct imports, required feature-name
boundaries, composition-root behavior, and production line ceilings. The exact current maps and
manual locate-by-name drill live in [the codebase tour](codebase-tour.md); persistence conventions
are explained in [Persistence and API Patterns](persistence-and-api-patterns.md).

## Phase 3: Operator console and test organization

Primary targets:

- `apps/web/app/investigations/page.tsx`
- large client components
- `apps/web/tests/dashboard.spec.ts`
- large core/API/database tests

Outcomes:

- server data loading, query parsing, presentation sections, and client controls are separated;
- Workbench cards, provider observations, trend, filters, and execution explorer have named components;
- page files describe composition rather than contain the whole interface;
- E2E tests are grouped by workflow;
- test utilities and deterministic seed helpers are shared;
- accessibility and behavior remain unchanged.

Completion signal:

> A developer can find the component or test for one visible feature by its product name.

### Implemented Phase 3 structure

The App Router pages are now composition roots over operator-named feature folders. Investigation
URL interpretation and saved-scope preparation live in `features/investigations/search-state.ts`;
the server-only `workbench-loader.ts` performs the three established bounded reads concurrently.
Summary cards, trend, provider observations, filters, and the execution explorer have separately
locatable components.

The Live Machine separates stream/reconnect/event merge from Timeline playback state and from
readout, controls, route, and raw timeline presentation. Comparative Replay separates form-string
draft parsing and preset values from submission and detail presentation. Saved cases separate
typed browser mutations, controls, evidence, notes, timeline, overview, creation, linking, and list
state.

`app/globals.css` is an ordered import map over feature-named styles whose concatenated,
whitespace-normalized content matches the former stylesheet. At this phase's close, the catch-all
dashboard spec had been replaced by five workflow-named specs that preserved the eight then-current
journeys, used unique idempotency keys, and explicitly drained worker-produced evidence. Later
Horizon 5 work expanded that suite; current names live in Operator Console Patterns. The web
structural audit enforces production/test ceilings, required feature boundaries, the CSS import
map, client/server imports, and detectable same-feature runtime cycles.

The exact final source map and locate-by-name drill are in [the codebase tour](codebase-tour.md).
Web conventions are explained in [Operator Console Patterns](operator-console-patterns.md).

## Phase 4: Ownership documentation and design-review walkthrough

**Established.** The repository now has one primary evidence-based
[design-review walkthrough](design-review-walkthrough.md), one practical
[change-recipes guide](change-recipes.md), three README reading paths, and a dependency-free
documentation audit in `scripts/check-documentation.mjs`.

The walkthrough connects the product loop to current packages, processes, complete execution and
worker traces, replay encryption, Comparative Replay, bounded investigation, saved cases,
server/client UI boundaries, verification layers, guarantees, non-guarantees, limitations, and
honest interview answers. The recipes map ten representative modifications to their primary owner,
adjacent boundaries, contracts, persistence, API, web, tests, documentation, invariants, and unsafe
shortcuts.

The codebase tour, system flows, architecture, TypeScript/persistence/operator patterns, README,
AGENTS guide, roadmap, and supplied ownership basics agree with current files and symbols. ADR
history remains intact, with status notes only where durable execution materially refined the
earlier in-process/comparison boundaries.

Completion signal:

> The repository itself teaches a new engineer how to understand, evaluate, and safely modify it.

All four phases are established. The Human-Comprehension and Ownership Pass is complete as a
cross-cutting interlude, not a product horizon. This sentence closes the historical plan; Product
Tour and Operator Guidance and the later Horizon 5 movements are now established. See
[`roadmap.md`](roadmap.md) for current status.

## Structural conventions

### Root barrels

Package root `src/index.ts` files should:

- contain re-exports;
- contain little or no runtime implementation;
- remain short enough to scan;
- present the intentional public API.

### Direct internal imports

Within a package:

```ts
// Avoid
import type { ExecutionRepository } from "./index.js";

// Prefer
import type { ExecutionRepository } from "./execution/ports.js";
```

### Cohesive modules

Prefer a folder when a concept has several cooperating parts:

```text
execution/
  execution-service.ts
  execution-runner.ts
  event-recorder.ts
  ports.ts
  errors.ts
```

Do not create one file per tiny function.

### Explicit central types

Use explicit named types for important domain concepts.

Advanced TypeScript is acceptable when:

- it removes genuine repetition;
- the result remains readable;
- the pattern has a clear name;
- a nearby explanation states why it exists;
- a simpler explicit model would be materially worse.

### Composition roots

Files such as API and worker startup may legitimately know many adapters.

Domain modules should not.

### Module explanations

Each non-trivial module should begin with a short comment explaining:

- what it owns;
- what it deliberately does not own;
- which adjacent module it collaborates with.

Avoid narrating obvious syntax.

## Quantitative guardrails

These are review signals, not universal laws:

- package root barrels should generally remain below 100 lines;
- ordinary production modules should generally remain below 400 lines;
- complex cohesive modules may approach 500 lines;
- production files above 600 lines require explicit justification;
- same-package imports from the package root or `./index.js` are prohibited;
- feature folders should avoid circular runtime imports.

A small structural audit may enforce the obvious rules without adding dependencies.

## Public API stability

Existing imports from these roots must remain valid:

```text
@reliability-lab/contracts
@reliability-lab/core
@reliability-lab/db
@reliability-lab/providers
```

Internal file paths are not public contracts.

Before and after each phase:

- compare exported symbol names;
- typecheck all consumers;
- run full tests;
- inspect generated declarations where useful.

## Behavior stability

The comprehension pass does not intentionally change:

- API paths or payloads;
- event semantics;
- retry/fallback behavior;
- encryption or retention;
- worker leases;
- comparison interpretation;
- investigation metrics;
- case persistence;
- UI workflows;
- database schema.

No migration should be created solely for file organization.

## Human review exercises

After each phase, manually locate and explain:

### Execution

- request acceptance;
- event creation;
- retry decision;
- fallback decision;
- terminal projection.

### Replay and comparison

- replay capability;
- encrypted storage port;
- variation resolution;
- comparison projection.

### Durable execution

- job acceptance;
- claim fencing;
- heartbeat cancellation;
- ambiguous recovery.

### Investigation

- signal definitions;
- execution search;
- provider observations;
- saved scope;
- evidence linking.

The documentation should point to these exact modules.

## Non-goals

The comprehension pass does not add:

- product features;
- authentication or RBAC;
- scenario catalog expansion;
- external trace/log integration;
- alerting;
- cancellation;
- cloud deployment;
- new queue technology;
- new framework dependencies;
- an architecture framework;
- one-class-per-file ceremony;
- Java-style `ManagerServiceFactory` layers;
- Silverlight.

## Final acceptance

The pass is complete when:

```text
Tests pass
AND public APIs remain stable
AND central modules are cohesive
AND root barrels are maps
AND important types are explicit
AND the source tree communicates the architecture
AND the owner can trace and explain the system
```

The final measure is not merely smaller files.

It is lower cost of understanding.
