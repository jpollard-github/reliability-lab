# Reliability Lab: Ownership and Design Review Basics

> Phase 4 is not another code-splitting campaign. It is the point where the repository proves that its owner can explain it, defend its choices, modify it safely, and verify the result.

## The purpose of Phase 4

The first three phases changed the repository's shape:

```text
Phase 1:
  contracts and core domain

Phase 2:
  persistence and API composition

Phase 3:
  operator console and workflow tests
```

Phase 4 changes the repository's teaching surface.

The goal is not more architecture.

The goal is a clear answer to four questions:

1. Can I explain how the system works?
2. Can I defend why it works that way?
3. Can I identify where a change belongs?
4. Can I prove that the change did not damage established behavior?

That is software ownership.

---

## Working software versus owned software

Working software answers:

> Does it run?

Owned software also answers:

> Where does this behavior live?

> Why is this boundary here?

> What tradeoff did we accept?

> What would change if the requirement moved?

> Which tests prove the behavior?

> Where could the system fail honestly?

A repository is not owned merely because its author wrote every line.

A repository is owned when its author can navigate, reason about, change, and verify it without depending on accidental memory.

---

## The four ownership tests

## 1. Explain

An explanation should connect product language to code.

Example:

```text
Operator submits an execution
        ↓
Fastify validates the transport request
        ↓
Core prepares the execution and applies reliability policy
        ↓
Repository records attempts and events
        ↓
Operator console reads persisted evidence
```

A useful explanation names:

- the product purpose;
- the architectural boundary;
- the concrete files;
- the evidence produced;
- the failure behavior.

It does not require reciting every class or function.

---

## 2. Defend

A design defense explains why a choice is appropriate for the current product.

It should include:

- the problem being solved;
- the rejected simpler or more complex alternative;
- the tradeoff accepted;
- the boundary that remains deliberately incomplete.

Example:

> Durable execution uses PostgreSQL leases and fencing because accepted work must survive an API restart and stale workers must not overwrite current claims. It does not claim exactly-once provider calls because PostgreSQL and a remote provider do not share a transaction.

That is stronger than:

> We used a queue because queues are scalable.

The first statement is evidence-based and bounded.

The second is architecture perfume.

---

## 3. Modify

Ownership includes knowing where a change belongs before editing.

Examples:

```text
New execution event:
  contracts event payload
  core event recording
  persistence mapping
  API or web projection
  focused tests

New Investigation Workbench filter:
  contracts query shape
  API transport schema
  DB read query
  web URL state
  Playwright workflow

New provider adapter:
  provider port implementation
  provider registry/composition
  configuration
  normalization tests
```

A good change recipe identifies:

- the primary owner;
- adjacent collaborators;
- public-contract implications;
- persistence implications;
- tests;
- documentation;
- dangerous shortcuts.

---

## 4. Verify

Verification is not a ceremonial final command.

It is a layered argument:

```text
Focused unit test:
  the local rule behaves correctly

Integration test:
  the database boundary behaves correctly

End-to-end test:
  the operator workflow still works

Structural audit:
  the repository remains navigable

Full verification:
  the combined system still agrees with itself
```

The owner should know which layer is relevant to a proposed change.

---

## What each document should do

A documentation set becomes confusing when every file attempts to explain everything.

Reliability Lab should give each document a job.

### README

Answers:

- What is this?
- What works now?
- Where should I start?

### Architecture

Answers:

- What are the major boundaries?
- Where does data cross trust boundaries?
- What consistency claims are made?
- What consistency claims are deliberately not made?

### Codebase tour

Answers:

- Where does each responsibility live?
- Which file and symbol should I open?

### System flows

Answers:

- How does one operation cross the layers?
- In what order do important calls and writes occur?

### Pattern guides

Answer:

- How is this kind of code written here?
- Which local conventions should a maintainer preserve?

### Design review walkthrough

Answers:

- How would the owner present the system coherently?
- Which choices deserve explanation?
- Which evidence supports the claims?
- What remains incomplete?

### Change recipes

Answer:

- Where would I make a representative change?
- Which boundaries and tests would it touch?

### Roadmap

Answers:

- What product outcome comes next?
- Which tempting work is intentionally deferred?

No document should become a second source tree.

---

## The sixty-second explanation

A compact explanation should sound approximately like this:

> Reliability Lab is an explainable reliability workbench for OpenAI-compatible LLM calls. It accepts a tenant-scoped execution, applies bounded retry, fallback, validation, and latency policy, and records append-only evidence for every decision. Accepted work can run in-process or through a PostgreSQL worker with leases and fencing. Eligible input can be retained in an encrypted replay vault, replayed under controlled variations, compared at the evidence level, investigated through bounded read models, and saved into an investigation case. The system emphasizes honest boundaries: it does not claim factual answer quality, exactly-once provider calls, authenticated tenancy, or universal provider health.

The words can vary.

The boundaries should not.

---

## The five-minute explanation

A five-minute walkthrough should cover:

1. the problem;
2. the execution envelope;
3. policy and evidence;
4. durable acceptance;
5. replay and comparison;
6. investigation and saved cases;
7. the operator console;
8. limits and next work.

A useful order:

```text
Why:
  provider calls fail in ways that a final HTTP status cannot explain

Execute:
  normalize one request into a durable evidence envelope

Explain:
  record attempts, failures, retries, fallback, validation, and terminal state

Watch:
  stream persisted events and project them into a machine view

Replay:
  use retained encrypted input only when current capability permits

Compare:
  run a controlled variation and compare evidence dimensions

Investigate:
  search bounded summaries and provider observations

Preserve:
  save scope, findings, references, and notes in an investigation case
```

---

## The fifteen-minute design review

A deeper design review should move through the code in architectural order.

### 1. Contracts

Show:

- execution requests and envelopes;
- explicit event payloads;
- stored event metadata;
- replay and comparison shapes;
- investigation and case contracts.

Explain why contracts are portable and framework-independent.

### 2. Core execution

Show:

- `ExecutionService` as facade;
- execution preparation;
- event recording;
- provider policy runner;
- retry calculation;
- validation;
- terminal failure projection.

Explain why the facade delegates rather than containing every decision.

### 3. Durable execution

Show:

- atomic acceptance;
- encrypted transient commands;
- job claim;
- claim version;
- heartbeat;
- lease guard;
- fenced completion;
- ambiguous provider-call recovery.

Explain the exact claim:

> accepted work survives process restart and stale claims are fenced.

Also explain the non-claim:

> remote provider calls are not exactly once.

### 4. Replay Vault

Show:

- replay capability;
- encryption adapter;
- key version;
- expiry;
- deletion;
- metadata-only audit;
- read-old/write-current behavior.

Explain why replay is a current capability rather than a historical boolean.

### 5. Comparative Replay

Show:

- requested variation;
- resolved non-sensitive conditions;
- linked variant execution;
- evidence dimensions;
- absence of a universal score.

Explain why controlled comparison is more useful than pretending one replay proves reliability.

### 6. Investigation Workbench

Show:

- bounded time window;
- execution search;
- reliability summary;
- trend;
- provider observations;
- URL-backed filters;
- exact saved scope.

Explain why investigation uses purpose-built read models instead of hydrating every full execution envelope.

### 7. Saved Investigation Cases

Show:

- canonical scope;
- current finding and resolution;
- typed evidence references;
- append-only notes;
- lifecycle timeline;
- archive status.

Explain why cases link evidence rather than copying execution envelopes.

### 8. API and persistence

Show:

- small composition roots;
- route plugins;
- transport schemas;
- error mapping;
- database connection;
- domain schema folders;
- read queries;
- command transactions;
- row mappers.

Explain how transport, domain policy, and persistence remain separate.

### 9. Operator console

Show:

- App Router page composition;
- server-rendered reads;
- focused client interaction;
- server/client API boundary;
- live stream controller;
- playback controller;
- workflow-named components and tests.

Explain why server and browser API modules are separate:

- security;
- runtime correctness;
- explicit ownership.

### 10. Verification

Show:

- unit tests;
- PostgreSQL integration tests;
- Playwright workflows;
- structural audit;
- repository export manifest.

Explain which claims each verification layer supports.

---

## Key choices to defend

## Append-only events plus mutable projection

The event stream explains what happened.

The mutable execution projection makes current reads practical.

The tradeoff is that some writes are not enclosed in a universal transactional outbox.

The system states that boundary rather than hiding it.

---

## Explicit event payload types

Important execution events use named payloads.

This costs a little repetition.

It avoids conditional-type archaeology at the center of the domain.

The trade favors comprehension over type-system cleverness.

---

## Bounded retry and fallback

Retry is not an infinite loop.

Fallback is not a hidden second chance.

Both are policy decisions recorded as evidence.

This makes recovery explainable and testable.

---

## PostgreSQL durable execution

PostgreSQL already holds the execution evidence and can atomically accept the job with the envelope.

The approach avoids introducing a separate queue before the workflow requires one.

The tradeoff is that PostgreSQL is not being presented as a universal queue solution.

---

## Lease fencing

A claim version distinguishes the current worker from stale workers.

Heartbeats extend an observed lease.

Fenced writes prevent an old claim from completing or clearing the current job.

This handles ownership races.

It cannot prove whether an external provider acted before a connection failed.

---

## Encrypted replay capsules

Replay input is more sensitive than normalized evidence.

The replay vault therefore has an independent retention and encryption boundary.

The tradeoff is operational complexity around keys, expiry, deletion, and unreadable states.

That complexity is visible in the capability model.

---

## Comparison without a universal score

A single score would hide meaning.

Reliability Lab compares dimensions such as:

- outcome;
- attempts;
- fallback;
- normalized failures;
- latency;
- validation;
- evidence route.

The operator interprets the evidence.

The tool does not manufacture certainty.

---

## Bounded investigation read models

The Workbench asks focused questions:

- What outcomes occurred?
- Which recoveries occurred?
- Which providers and models were observed?
- Which executions match this scope?

Dedicated queries keep those reads bounded and explainable.

The compatibility execution list remains intentionally separate and unbounded.

---

## URL-backed Workbench state

Important investigation state lives in the URL.

That permits:

- bookmarking;
- sharing;
- returning from evidence;
- saving exact scope;
- deterministic Playwright workflows.

The tradeoff is careful parameter compatibility and canonicalization.

---

## Server and browser API separation

Server reads may use:

- private configuration;
- server tenant configuration;
- internal networking;
- `cache: "no-store"`;
- server-only not-found behavior.

Browser mutations may use only public configuration.

The split primarily protects the trust boundary.

It also prevents runtime confusion and makes code ownership explicit.

---

## Saved cases reference evidence

A case stores bounded interpretation and typed references.

It does not copy prompts, outputs, capsules, arbitrary attachments, or full execution envelopes.

This reduces duplication and prevents the case system from becoming a shadow evidence store.

---

## Representative change recipes

A final repository should teach several changes without actually implementing them during Phase 4.

## Add a new execution event

Identify:

- contract payload;
- event schema version;
- recorder call site;
- persistence mapping;
- API/SSE transport behavior;
- machine projection;
- unit and E2E coverage.

Check whether the event changes terminal semantics or merely adds evidence.

---

## Add a new normalized failure

Identify:

- normalization owner;
- contract enum or union;
- provider adapter mapping;
- retry policy implications;
- investigation filters and aggregates;
- UI status text;
- fixtures and tests.

Avoid making provider-specific strings into domain categories.

---

## Add a provider adapter

Identify:

- provider port;
- adapter implementation;
- request and error normalization;
- configuration and composition;
- secret handling;
- deterministic tests;
- optional live verification.

Do not move provider SDK types into core contracts.

---

## Add a policy input

Identify:

- request contract;
- defaulting and bounds;
- policy owner;
- replay variation implications;
- comparison projection;
- API schema;
- form draft parsing;
- unit and E2E tests.

Do not add an input only to the browser and hope the server understands it.

---

## Add an Investigation Workbench filter

Identify:

- contract query;
- transport schema;
- database predicates;
- cursor stability;
- URL parsing and reconstruction;
- saved-scope canonicalization;
- active-filter presentation;
- workflow test.

Preserve exact time bounds and tenant predicates.

---

## Add an investigation signal

Identify:

- signal definition;
- SQL aggregate or execution predicate;
- memory adapter parity;
- API response;
- Workbench card or filter;
- evidence drill-down;
- test fixtures.

State precisely what the signal means and what it does not mean.

---

## Add a saved-case evidence type

Identify:

- evidence contract;
- validation;
- persistence schema and migration need;
- mapper;
- service rules;
- API schema;
- case rendering;
- lifecycle metadata;
- integration and E2E tests.

Do not allow arbitrary URLs or copied sensitive payloads by accident.

---

## Add an operator-console section

Identify:

- server read or browser mutation;
- feature folder;
- page composition;
- API boundary;
- accessibility labels;
- styles;
- unit logic;
- workflow test.

Do not convert the whole route into a Client Component for one button.

---

## Questions an interviewer may ask

### Why not use LangChain or another orchestration framework?

The core problem is evidence-grounded reliability behavior and explicit boundaries, not generic chain composition. Framework-independent contracts and ports keep retry, fallback, event, replay, and persistence semantics visible.

### Why PostgreSQL for jobs?

It supports atomic acceptance with the execution envelope and is sufficient for the current prototype. The project does not claim PostgreSQL is the final queue for every scale.

### Is it exactly once?

No. Job ownership and writes are fenced. External provider calls remain ambiguous because there is no distributed transaction with the provider.

### Why store events and a current projection?

Events explain the history. The projection makes current reads efficient. The system documents the consistency boundary between them.

### Why encrypt replay input but retain normalized evidence?

Replay input may contain sensitive prompt material. Normalized evidence is intentionally narrower and remains useful when replay retention is disabled, expired, deleted, or unreadable.

### Why no universal comparison score?

A score would collapse different reliability dimensions into false certainty. The comparison exposes evidence and lets the operator interpret it.

### Is tenant isolation secure?

Not yet. The tenant header is routing context, not authenticated identity. Authentication, authorization, and database-enforced tenant isolation belong to a later horizon.

### Why separate server and client API modules?

To protect private server configuration, preserve runtime-specific behavior, and make the browser trust boundary obvious.

### What would you build next?

After the ownership pass, Product Tour and Operator Guidance should help a new operator understand the workflow without reading source. Broader Horizon 5 work follows only when the product workflow justifies it.

---

## Honest limitations

A strong walkthrough states limitations before someone has to discover them.

Current deliberate limitations include:

- no authenticated principal;
- no RBAC or PostgreSQL row-level security;
- tenant header is not identity;
- no exactly-once provider-call claim;
- no cancellation;
- no general transactional outbox;
- no dead-letter or operator recovery workflow;
- no distributed circuit-breaker or rate-limit state;
- no managed KMS or envelope encryption;
- no physical backup-erasure guarantee;
- no universal provider-health claim;
- no broad scenario catalog;
- no external trace/log integration;
- compatibility execution list remains unbounded;
- dependency advisories require a reviewed upgrade decision.

Limitations are not apologies.

They are coordinates.

---

## A practical interview walkthrough

Use the repository rather than memorizing a speech.

### Opening

State:

- the problem;
- the product loop;
- the strongest boundary.

Example:

> This is a flight recorder and wind tunnel for LLM calls. It records policy decisions and failures, permits controlled replay when retained input is available, compares outcomes without inventing a universal score, and preserves investigations as evidence-linked cases.

### Show one path

Trace one durable retry execution:

```text
HTTP acceptance
→ durable job
→ worker claim
→ execution runner
→ attempt failure
→ retry decision
→ success
→ persisted events
→ SSE
→ machine view
```

### Show one safety boundary

Choose replay encryption or claim fencing.

Explain the exact guarantee and the exact non-guarantee.

### Show one investigation

Move from Workbench signal to execution evidence, comparison, and saved case.

### Show one change

Use a recipe to explain how a new filter, event, or provider adapter would be added.

### Close

State:

- what is established;
- what is intentionally incomplete;
- what comes next.

---

## The final ownership review

The Human-Comprehension and Ownership Pass is complete when another competent engineer can:

- identify package responsibilities from the tree;
- trace a request through transport, policy, persistence, and presentation;
- locate retry, fallback, replay, comparison, investigation, and saved-case behavior;
- explain the durable-execution guarantee without claiming exactly once;
- explain the replay trust boundary;
- explain why Workbench reads are bounded;
- explain why server and browser API access are separate;
- identify the tests for one workflow;
- describe where a representative change belongs;
- state deliberate limitations;
- run the appropriate verification commands;
- produce and verify a clean repository handoff.

The final metric is not line count.

It is whether understanding survives outside the author's head.

## Implemented Phase 4 ownership map

The final repository assigns each ownership question a primary teaching surface:

- [Design-review walkthrough](design-review-walkthrough.md) explains and defends the implemented
  product, architecture, flows, guarantees, tradeoffs, and limitations.
- [Change recipes](change-recipes.md) identifies the first owner, adjacent boundaries, tests,
  invariants, and shortcuts to avoid for ten representative modifications.
- [Codebase tour](codebase-tour.md) answers “where is it?” with current files and symbols.
- [System flows](system-flows.md) answers “how does it cross boundaries?” with entrypoints,
  persistence, terminal evidence, and tests.
- `pnpm audit:docs` checks required ownership documents, README entrypoints, relative Markdown
  links, and local absolute paths. It runs inside `pnpm verify`.

The Human-Comprehension and Ownership Pass remains established across contracts/core,
persistence/API, operator console/tests, and ownership documentation. Subsequent bounded movements
now include Product Tour and Operator Guidance, Evidence-Backed Case Conclusions and Review
Packets, and Case-Driven Policy Experiments; see the roadmap for the current horizon signal.
