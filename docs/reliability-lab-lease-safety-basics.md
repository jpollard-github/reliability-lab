# Reliability Lab: Lease Safety and Fencing Basics

This document explains one subtle part of durable execution: how the system prevents an old worker from continuing after it no longer owns a job.

## The problem in one sentence

**A lease is safe only when a worker notices that it lost the lease and is prevented from writing results as though it still owns the job.**

A lease record alone does not provide that guarantee.

---

## The ordinary lease flow

A worker claims a pending job:

```text
Worker A claims execution E
Lease owner: Worker A
Lease version: 1
Lease expires: 10:30:30
```

While the execution is running, Worker A renews the lease with heartbeats.

```text
10:30:10 heartbeat
10:30:20 heartbeat
10:30:30 heartbeat
```

When the execution finishes, Worker A marks the job terminal and removes the transient encrypted command payload.

---

## What can go wrong?

Suppose Worker A becomes disconnected from PostgreSQL while it is calling the provider.

Its heartbeats stop.

The lease expires.

Worker B sees the expired lease and claims the same job:

```text
Lease owner: Worker B
Lease version: 2
```

If Worker A does not notice, both workers may continue.

```text
Worker A: still waiting for provider response
Worker B: recovering the expired execution
```

That creates a **split-brain execution**.

The lease table may say Worker B owns the job while Worker A still believes it does.

---

## Why checking only the worker ID is insufficient

A worker ID identifies a process, but a process can claim the same job more than once over time.

A stronger claim includes a monotonically increasing **fencing token**:

```text
Worker A, claim 1
Worker B, claim 2
```

Every heartbeat, ownership check, terminal update, and cleanup operation must prove both:

- the expected worker ID;
- the expected claim version.

A stale claim cannot complete work created under a newer claim.

---

## What is a fencing token?

A fencing token is a number that increases every time the job is claimed.

The existing `claimCount` can serve this purpose when treated as a strict ownership version.

```text
First claim:  token 1
Reclaim:      token 2
Next reclaim: token 3
```

A terminal update from token 1 must fail after token 2 exists.

This is stronger than asking:

> Does the row still mention my worker ID?

It asks:

> Does the row still contain the exact claim I received?

---

## Heartbeats must be observed

A fire-and-forget heartbeat is not enough.

The worker must know whether the heartbeat:

- succeeded;
- failed temporarily;
- reported that the claim is no longer owned;
- could not be confirmed before the current lease deadline.

Otherwise the worker may continue through a database outage and discover too late that another worker reclaimed the job.

A safe heartbeat loop is:

- serialized, so heartbeats do not overlap;
- error-handled, so rejected promises do not escape;
- aware of the local lease deadline;
- able to abort continuation when ownership can no longer be confirmed.

---

## Provider calls make lease loss especially dangerous

A provider call is an external effect.

The sequence may be:

```text
attempt.started is persisted
        ↓
provider request is sent
        ↓
worker loses lease
        ↓
provider returns success
```

The old worker must not persist that success after losing ownership.

But the new worker also must not blindly call the provider again, because the first request may have succeeded.

The honest recovery is:

```text
Provider request may have been sent.
No trusted owner persisted the outcome.
Automatic duplicate request was avoided.
Execution marked outcome ambiguous.
```

That is the existing `provider_call_outcome_unknown` idea, strengthened with actual lease fencing.

---

## What should happen when the old worker loses ownership?

The stale worker should:

1. abort local waiting where possible;
2. stop retry and backoff progression;
3. avoid appending provider response or terminal success evidence;
4. avoid marking the job completed;
5. avoid deleting command payload under the stale claim;
6. leave recovery to the current owner.

The current owner can then inspect the persisted attempt evidence and classify the execution conservatively.

---

## Timeout versus lease cancellation

A provider attempt may stop for two very different reasons.

### Execution timeout

The configured latency budget expired.

This is ordinary reliability evidence:

```text
category: timeout
code: provider_timeout
```

### Lease cancellation

The worker can no longer prove that it owns the job.

This is runtime coordination evidence:

```text
worker lease lost
stale continuation stopped
```

These should not be collapsed into the same failure code.

Lease loss may lead the next worker to classify the provider outcome as ambiguous.

---

## Why the provider may still receive the request

An abort signal is best effort.

It may stop:

- a local fake provider;
- an HTTP request that has not completed;
- backoff sleep;
- additional retries.

It cannot guarantee that a remote provider did not already receive and process the request.

That is why abort support and ambiguity handling are both needed.

---

## What the implemented safety pass proves

The focused unit and PostgreSQL integration tests demonstrate:

```text
Worker A claims token 1
Worker A starts provider attempt
Worker A loses lease
Worker B claims token 2
Worker A cannot persist success or finish token 1
Worker B sees prior attempt activity
Worker B records provider_call_outcome_unknown
Provider is not called a second time
```

Other important proofs:

- stale heartbeat cannot extend a newer claim;
- stale completion cannot clear the newer owner’s command payload;
- heartbeat errors do not become unhandled promise rejections;
- an untouched expired job remains safely reclaimable;
- normal long executions keep their lease through serialized heartbeats.

---

## Where this fits in the roadmap

The project already has the main durable-execution machinery:

- atomic acceptance;
- encrypted commands;
- PostgreSQL jobs;
- a separate worker;
- leases;
- reclaim;
- ambiguity evidence.

Lease fencing is not a new product horizon. It is the correctness pass that closes a split-brain hole in the Durable Execution Foundation.

That bounded pass is complete: accepted work survives API loss, untouched jobs survive worker loss,
and stale claims are fenced. Provider-call ambiguity remains explicit rather than exactly-once.

After this pass, the project should move back toward visible product value:

```text
Durable safety
    ↓
Investigation Workbench
    ↓
Search, aggregate signals, provider health, and drill-down
```

The purpose is not to remain in infrastructure indefinitely.

---

## Working vocabulary

| Term               | Plain meaning                                                                    |
| ------------------ | -------------------------------------------------------------------------------- |
| Lease              | A temporary worker claim on a job                                                |
| Heartbeat          | A renewal proving the worker still owns the claim                                |
| Lease deadline     | The time after which another worker may reclaim the job                          |
| Fencing token      | A monotonically increasing claim version                                         |
| Stale worker       | A worker continuing after its claim is no longer current                         |
| Split brain        | Two workers acting as though both own the same execution                         |
| Lease guard        | A control checked before and after dangerous execution phases                    |
| Lease cancellation | Stopping continuation because ownership cannot be proven                         |
| Provider ambiguity | A request may have reached the provider, but no trustworthy result was persisted |

---

## Final mental model

A lease is a hotel key card.

The worker ID is the guest name.

The fencing token is the key-card generation.

When the front desk issues generation 2, generation 1 must stop opening the door, even if the old guest still has the physical card.

Without fencing, the database has changed the room assignment, but the old key may still work.
