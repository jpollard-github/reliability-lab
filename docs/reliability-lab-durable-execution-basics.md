# Reliability Lab: Durable Execution Basics

This document explains the implemented Durable Execution Foundation in plain language.

## The next horizon in one sentence

**Durable execution means that once the API truthfully accepts an LLM request, the work can continue or reach an explicit recovery outcome even if the API or worker process restarts.**

Reliability Lab now has two explicit modes.

- `in_process` is the infrastructure-free default. It is honest asynchronous execution, but accepted in-flight work remains tied to the API process.
- `postgres_worker` atomically stores accepted work and lets a separate worker continue it later.

Only the second mode is durable asynchronous execution.

---

## What happens in the default in-process mode?

The current lifecycle is approximately:

```text
Client submits request
        ↓
API creates running execution
        ↓
API persists execution.accepted
        ↓
API returns 202
        ↓
The same API process continues the work
        ↓
Provider attempts and events are persisted
        ↓
Execution finishes
```

The `202` is honest because the execution ID and accepted evidence exist before completion.

But there is a gap:

```text
API returns 202
        ↓
API process crashes
        ↓
In-memory continuation disappears
```

The database may still contain a running execution with no process left to finish it.

---

## What happens in PostgreSQL worker mode?

Durable mode separates request acceptance from execution work:

```text
Client
  ↓
API
  ↓
Durable job record
  ↓
Worker
  ↓
Provider
  ↓
Persisted evidence and terminal outcome
```

The API accepts and stores the work.

A worker claims and performs the work.

If the worker disappears before safely beginning, another worker can claim the stored job later.

---

## What is a job or execution command?

The **execution envelope** is the public operational record:

- execution ID;
- tenant;
- provider and model;
- policy;
- budgets;
- attempts;
- events;
- status.

The worker also needs the private command that says what to execute:

- input or messages;
- structured-output schema;
- selected provider and model;
- policy and budget;
- safe failure-injection data in local mode.

That private command may contain sensitive input.

It therefore must not be stored as plaintext in a queue table.

---

## Execution command versus replay capsule

These are related but different.

### Encrypted execution command

Purpose:

> Hold the sensitive request long enough for a worker to perform accepted work.

Lifecycle:

```text
Accept request
→ Encrypt command
→ Worker decrypts command
→ Execution reaches terminal state
→ Delete command payload
```

It is required for durable processing.

### Replay capsule

Purpose:

> Preserve the minimum sensitive material needed to run the case again later.

Lifecycle:

```text
Execution runs
→ Retention policy permits replay
→ Store encrypted replay capsule
→ Capsule expires or is deleted later
```

Replay retention is optional and policy-controlled.

A live request may therefore have:

```text
Encrypted execution command: yes, temporarily
Replay capsule: no
```

This distinction prevents “durable queue” from quietly becoming “retain every prompt forever.”

---

## What does atomic acceptance mean?

The API should return `202` only after one database transaction successfully records all facts required to honor acceptance:

- the initial execution row;
- the `execution.accepted` event;
- the encrypted durable job;
- the idempotency record when supplied;
- a comparison experiment row when the accepted work is a comparison variant.

Either all required records commit, or none do.

Without this boundary, the system could create:

- an execution with no job;
- a job with no execution;
- an idempotency key pointing nowhere;
- a comparison experiment with no runnable variant;
- a variant with no comparison experiment.

Atomic acceptance closes that trapdoor.

---

## What is a worker?

A worker is a separate process that performs queued executions.

A worker:

1. finds an available job;
2. claims it;
3. decrypts and validates the command;
4. loads the accepted execution;
5. runs the normal execution engine;
6. persists events and attempts;
7. marks the job terminal;
8. removes the transient command payload.

The API remains available to accept and inspect work while the worker handles provider calls.

---

## What is a lease?

A lease is a temporary claim on a job.

```text
Worker A claims job until 10:30:30
```

While the lease is valid, other workers should not execute that job.

The worker periodically extends the lease with a **heartbeat**.

If the worker dies and the lease expires, another worker may inspect and reclaim the job.

A lease is not ownership forever. It is a renewable parking permit.

---

## Why recovery is difficult around provider calls

Suppose the worker records:

```text
attempt.started
```

Then it sends the request to the provider.

Before recording the response, the worker crashes.

After restart, the system knows:

- the request may have reached the provider;
- the provider may have completed it;
- the result was not durably recorded.

It does not know whether calling the provider again would duplicate work or cost.

This is **provider-call ambiguity**.

A conservative first implementation should not silently issue the call again. It should record an explicit ambiguous recovery outcome such as:

```text
Provider request may have been sent.
No durable response evidence exists.
Automatic duplicate call was not attempted.
```

That is less magical than pretending exactly-once execution exists.

---

## At-least-once versus exactly-once

A durable queue can usually provide **at-least-once delivery**:

> A job will be offered to a worker until it reaches a terminal state.

That does not automatically provide exactly-once external effects.

Exactly-once provider calls are difficult because the local database and remote provider do not share one transaction.

Possible protections include:

- provider-supported idempotency keys;
- operation-specific deduplication;
- explicit ambiguity handling;
- safe operator recovery;
- compensating actions.

Reliability Lab should expose this boundary rather than bury it under a green status badge.

---

## What should happen after a worker restart?

Several cases are different:

### Job was never started

Safe to claim and execute.

### Job was leased but no provider attempt began

Usually safe to reclaim after the lease expires.

### Execution already reached a terminal state

Do not execute again. Reconcile the job as completed and remove the command payload.

### A provider attempt was running when the lease expired

Do not silently repeat the provider call. Record explicit ambiguity and move the execution to a safe terminal or operator-review state.

### Database state is internally inconsistent

Record a normalized recovery failure. Do not invent missing evidence.

---

## What does idempotency do?

An idempotency key lets a client safely retry submission:

```text
POST request times out at client
Client submits same key again
```

The system should return the same accepted execution when:

- tenant matches;
- idempotency key matches;
- request hash matches.

It should reject the retry when the same key is reused for a different request.

In durable mode, checking and recording the idempotency key must occur inside the acceptance transaction. A separate “check, then insert” sequence has a race under concurrent requests.

---

## What happens to SSE and the Live Machine View?

The browser does not need to connect to the worker directly.

The worker persists the same append-only execution events.

The API’s SSE endpoint continues to read those persisted events:

```text
Worker writes event
        ↓
PostgreSQL
        ↓
API SSE backfill or poll
        ↓
Live Machine View
```

That is one reason persisted events were built before workers.

The display remains a projection of the factual record.

---

## What does the first durable slice prove?

The bounded implementation and its tests prove:

1. the API can accept work without performing it;
2. accepted work survives API restart;
3. a worker can process the stored command later;
4. a job not yet started survives worker restart;
5. concurrent idempotent submissions create one execution and one job;
6. expired leases are reclaimed safely;
7. ambiguous in-flight provider calls are made explicit rather than duplicated;
8. transient command plaintext never appears in the database;
9. encrypted command payload is removed after terminal completion;
10. replay retention remains a separate decision;
11. comparative variants use the same durable path;
12. the Live Machine View still follows events across processes.

That is enough for a coherent foundation.

---

## What remains out of scope?

The first durable slice intentionally does not include:

- Kubernetes;
- Redis as a job queue;
- multiple cloud regions;
- autoscaling;
- batch campaigns;
- general workflow orchestration;
- cancellation;
- priority scheduling;
- dead-letter administration UI;
- authenticated users;
- distributed circuit-breaker state;
- exactly-once provider guarantees;
- a transactional outbox for unrelated external systems.

Those may belong later, but they should not obscure the core acceptance and recovery boundary.

---

## Working vocabulary

| Term                     | Plain meaning                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Durable acceptance       | The system has persisted enough state to continue accepted work after process loss |
| Execution job            | The durable scheduling record for accepted work                                    |
| Execution command        | The sensitive private request needed by a worker                                   |
| Worker                   | A separate process that claims and performs jobs                                   |
| Lease                    | A time-limited worker claim on a job                                               |
| Heartbeat                | A lease extension showing the worker is still alive                                |
| Reclaim                  | Another worker safely taking an expired job                                        |
| Provider-call ambiguity  | The provider may have received a call, but no durable result was recorded          |
| Idempotency              | Repeating the same submission safely returns the same execution                    |
| Atomic acceptance        | Execution, event, job, and related records commit together or not at all           |
| At-least-once delivery   | A job may be offered again until it reaches a terminal state                       |
| Exactly-once effect      | A stronger guarantee that is generally impossible without provider cooperation     |
| Command payload deletion | Removing transient sensitive input after execution                                 |
| Replay retention         | Optional longer-lived storage for later reproduction                               |

---

## Final mental model

In-process mode is a restaurant where the cashier accepts an order and then personally walks into the kitchen to cook it.

Durable execution adds a ticket rail and a cook:

```text
Cashier:
  accepts and records the order

Ticket rail:
  preserves the work request

Cook:
  claims and prepares it

Order history:
  records every meaningful step
```

If the cashier restarts, the ticket remains.

If the cook disappears before touching the order, another cook can claim it.

If the cook disappears after putting something in the oven, the system does not pretend it knows whether the dish finished. It records the ambiguity and handles it explicitly.
