# Reliability Lab Basics

This document defines the core terms used by Reliability Lab in plain language.

## The project in one sentence

**Reliability Lab is a small system for running an LLM request, recording how the system handled it, and testing whether different handling rules would produce a better result.**

It is not primarily a chatbot. It is a workbench for understanding the behavior of software that calls LLMs.

---

## What does “reliability” mean here?

In this project, **reliability means that an LLM-powered system behaves predictably and explainably even when something goes wrong or becomes uncertain.**

An LLM call can fail in many ways:

- the provider may time out;
- the provider may reject the request;
- the model may return malformed JSON;
- the result may arrive too late to be useful;
- a retry may succeed;
- a fallback provider may succeed;
- repeated retries may waste time or money;
- the system may technically succeed but only after degraded behavior.

Reliability Lab is concerned with questions such as:

- Did the request eventually succeed?
- How many attempts did it take?
- Why did the system retry?
- Why did it stop retrying?
- Did it switch to another provider or model?
- Did the output satisfy the expected schema?
- Did the work stay within its latency or cost budget?
- Can an engineer understand the decisions afterward?
- Could the same case be reproduced safely?

Reliability does **not** mean that the model is always factually correct, wise, or useful. Those are quality and evaluation concerns. They may eventually overlap with this project, but the current focus is the dependability of the execution system around the model.

A compact definition:

> **Reliability is the system’s ability to produce an acceptable, explainable outcome under normal conditions and expected failures.**

---

## What exactly is an “LLM execution”?

An **LLM execution** is one complete attempt by the application to fulfill an LLM-powered request.

It begins when the application accepts a request and ends when the application reaches a final outcome.

One execution may contain several provider calls.

For example:

```text
Execution begins
  → Attempt 1 calls Provider A
  → Provider A times out
  → Reliability policy allows a retry
  → Attempt 2 calls Provider A
  → Provider A returns malformed JSON
  → Reliability policy allows fallback
  → Attempt 3 calls Provider B
  → Provider B returns valid JSON
Execution ends with degraded success
```

That entire sequence is **one execution** with **three attempts**.

The execution record may include:

- a unique execution ID;
- tenant or caller context;
- start and finish times;
- each provider attempt;
- normalized errors;
- retry and fallback decisions;
- latency;
- token usage or estimated cost;
- structured-output validation;
- the final outcome;
- an append-only event timeline;
- replay availability.

The distinction matters:

- **Execution:** the whole lifecycle of fulfilling the request.
- **Attempt:** one call to one provider or model within that lifecycle.

---

## What is a “reliability policy”?

A **reliability policy** is the set of rules the system uses to decide what to do before, during, and after an LLM provider call.

It answers operational questions such as:

- How long may an attempt run?
- Which failures are retryable?
- How many retries are allowed?
- How much delay or jitter should occur between retries?
- When should the system use a fallback provider?
- What output shape is required?
- What is the total latency budget?
- Is there a cost or token budget?
- When should a circuit breaker stop calls to an unhealthy provider?
- When should the system stop and return failure?

A simplified policy might say:

```text
- Require valid JSON matching schema version 1.
- Retry a timeout up to two times.
- Do not retry an authentication error.
- Use Provider B if Provider A still fails.
- Stop all work after 8 seconds.
```

The policy is not the prompt and not the model configuration alone. It is the application’s **decision-making layer around the provider call**.

Reliability Lab records policy decisions so an engineer can later see not only what happened, but why the system chose each action.

Eventually, the lab should support comparing policies:

```text
Original policy:
  2 retries, then fallback
  Result: success in 7.4 seconds

Alternative policy:
  no retry, immediate fallback
  Result: success in 2.1 seconds at slightly higher cost
```

That comparison is one of the project’s main long-term goals.

---

## Why call an LLM execution an “incident”?

An execution is **not automatically an incident**.

The roadmap used the word too loosely.

An incident is an execution, or group of executions, that is worth investigating because something undesirable, unusual, or surprising happened.

Examples:

- all attempts failed;
- the request exceeded its latency budget;
- malformed structured output caused retries;
- fallback was required;
- the circuit breaker opened;
- cost or token use was unexpectedly high;
- a replay produced a different outcome;
- a supposedly successful execution behaved in a suspicious way.

A normal successful execution may simply be an **execution record**.

A problematic or interesting execution may become an **investigation case** or **incident**.

For this project, “investigation case” is often the clearer term because the event does not need to be a production outage or emergency.

A better version of the roadmap question is:

> **Can this execution or investigation case be reproduced safely?**

Rather than:

> Can the incident be reproduced safely?

---

## What would be reproduced?

Reproduction means preserving enough information to run a controlled version of the same request again.

That may include:

- the original input;
- the expected output schema;
- provider and model selection;
- relevant policy version;
- safe configuration values;
- deterministic failure-injection settings;
- execution metadata.

Some of that information may be sensitive. Reliability Lab therefore separates:

### Execution evidence

Operational facts that can usually be retained safely:

- attempts;
- timing;
- normalized failure categories;
- policy decisions;
- output-validity status;
- event history.

### Replay capsule

The minimum sensitive material required to recreate the request, such as retained input or prompt content.

The replay capsule is treated as a controlled, revocable capability. It may be encrypted, expired, deleted, or unavailable because retention was disabled.

The execution evidence should remain useful even when no replay capsule exists.

---

## A concrete example

Suppose an application asks an LLM to return:

```json
{
  "priority": "high | medium | low",
  "summary": "string"
}
```

The first provider returns prose instead of JSON. The system retries. The second response is valid JSON.

Reliability Lab would record something like:

```text
Execution outcome: success after retry
Attempt 1:
  Provider: fake-provider-a
  Result: invalid structured output
  Policy decision: retry

Attempt 2:
  Provider: fake-provider-a
  Result: valid structured output
  Policy decision: accept

Total latency: 840 ms
Attempts: 2
Replay capability: available until 2026-07-28T20:00:00Z
```

An engineer could then ask:

1. What happened?
2. Why did the system retry?
3. Can this case be replayed?
4. Would immediate fallback have been faster?
5. Can the investigation occur without exposing another tenant’s data?

Those are the five roadmap questions in practical form.

---

## The five roadmap questions, rewritten plainly

1. **What happened during this request?**
2. **Why did the system retry, fall back, accept, or stop?**
3. **Can we safely run the same case again?**
4. **Would different rules, providers, models, or budgets produce a better result?**
5. **Can we investigate it without exposing sensitive data or another tenant’s information?**

---

## Current project boundaries

Reliability Lab currently focuses on:

- provider-call failures;
- retries and jitter;
- fallback;
- latency budgets;
- structured-output validation;
- execution evidence;
- replay;
- operator inspection;
- eventual policy comparison.

It is not yet primarily about:

- judging whether an answer is factually correct;
- measuring subjective answer quality;
- prompt optimization;
- autonomous agents;
- model training;
- a production-scale queueing platform;
- full authentication and authorization.

Those could become related areas later, but they are not required to understand the project’s current purpose.

---

## Working vocabulary

| Term               | Plain meaning                                                                     |
| ------------------ | --------------------------------------------------------------------------------- |
| Execution          | The complete lifecycle of one LLM-powered request                                 |
| Attempt            | One provider/model call within an execution                                       |
| Reliability        | Predictable, explainable handling of normal operation and expected failure        |
| Reliability policy | Rules governing retry, fallback, validation, budgets, and stopping                |
| Execution evidence | The operational record of what happened and why                                   |
| Replay capsule     | Retained sensitive input needed to reproduce an execution                         |
| Replay             | Running a controlled version of a previous execution again                        |
| Incident           | A problematic or unusual execution worth investigating                            |
| Investigation case | A clearer, less dramatic term for an execution selected for study                 |
| Degraded success   | The request succeeded, but only after retry, fallback, or another recovery action |
| Normalized failure | A provider-specific error translated into a stable project-level category         |

---

## Final mental model

Think of Reliability Lab as a **flight recorder and wind tunnel for LLM calls**.

The flight recorder captures what happened during a real execution.

The wind tunnel lets an engineer replay the case under changed conditions:

- another provider;
- another model;
- another retry rule;
- another latency budget;
- another validation rule.

The purpose is to replace:

> “The LLM call acted weird.”

with:

> “The first provider timed out, the policy retried once, fallback succeeded, the request exceeded its preferred latency budget, and immediate fallback would have completed faster.”
