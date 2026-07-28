# Reliability Lab: Investigation Workbench Basics

This document explains the next Reliability Lab product slice in plain language.

## The feature in one sentence

**The Investigation Workbench helps an engineer find meaningful execution patterns, narrow them to concrete cases, and drill into the evidence without querying PostgreSQL or reading source code.**

The existing execution detail page answers:

> What happened in this one execution?

The workbench answers:

> Which executions should I investigate, and what pattern do they belong to?

---

## Why a workbench is needed

Reliability Lab already records rich evidence:

- execution outcomes;
- attempts;
- normalized failures;
- retries;
- fallback;
- structured-output validation;
- budgets;
- provider and model routes;
- replay and comparison relationships;
- trace IDs;
- durable queue and recovery events.

But opening execution IDs one at a time does not scale.

An operator needs to move through three levels:

```text
Aggregate signal
      ↓
Filtered execution set
      ↓
One execution or comparison
```

For example:

```text
Fallback dependence increased
      ↓
Show successful executions that used fallback
      ↓
Open one execution
      ↓
Replay it with a different retry policy
      ↓
Compare the result
```

The workbench connects the pieces the project already has.

---

## What is an investigation signal?

An **investigation signal** is a derived, explainable pattern calculated from persisted execution evidence.

Examples:

- terminal failure;
- degraded success;
- retry recovery;
- fallback dependence;
- latency-budget failure;
- structured-output rejection;
- ambiguous provider outcome;
- repeated rate limiting;
- unusually slow execution.

A signal is not a diagnosis.

It says:

> Something in this set is worth examining.

It does not say:

> The provider is bad.

---

## Execution-level versus attempt-level evidence

This distinction is essential.

### Execution-level evidence

Describes the complete request lifecycle:

- final status;
- total duration;
- number of attempts;
- whether fallback was used;
- whether a retry eventually recovered;
- whether the latency budget was exceeded.

### Attempt-level evidence

Describes one provider/model call:

- provider and model;
- success or failure;
- normalized error;
- observed latency;
- token usage;
- estimated cost.

An execution may involve more than one provider.

For example:

```text
Attempt 1: Provider A, rate limited
Attempt 2: Provider B, succeeded
Execution: degraded success
```

Provider-health views should therefore use attempt evidence, not merely the execution’s original provider field.

---

## What is retry recovery?

A **retry recovery** is an execution that encountered a failed attempt or scheduled retry and later reached success or degraded success.

```text
Attempt 1 failed
Retry scheduled
Attempt 2 succeeded
```

This tells us that the retry policy recovered useful work.

It does not automatically prove that retry was the best policy. Comparative Replay may show that immediate fallback would have been faster or cheaper.

---

## What is fallback dependence?

A successful or degraded execution is **fallback-dependent** when the execution reached an acceptable result only after selecting a fallback route.

```text
Primary provider failed
Fallback selected
Fallback provider succeeded
```

Fallback dependence is neither automatically good nor bad.

It may mean:

- the recovery policy worked;
- the primary route is unhealthy;
- the fallback is carrying too much traffic;
- the primary timeout is too patient;
- the system is operating as designed during a temporary incident.

The workbench should expose the cases and sample size, not declare a universal verdict.

---

## How should success rates be calculated?

Outcome rates should use **terminal executions** as the denominator.

```text
Terminal executions:
  succeeded
  degraded
  failed
  cancelled
```

Queued and running executions are shown separately.

Suppose the selected window contains:

```text
80 succeeded
10 degraded
10 failed
5 still running
```

Then:

```text
Terminal executions: 100
Success rate: 80%
Degraded rate: 10%
Failure rate: 10%
In flight: 5
```

The running executions should not silently dilute or improve the terminal outcome rates.

---

## What does provider health mean?

In this project, provider health means:

> What did Reliability Lab observe from attempts routed to this provider and model during the selected time window?

Useful fields include:

- attempt count;
- successful attempt count;
- failed attempt count;
- observed success rate;
- median and p95 attempt latency;
- timeout count;
- rate-limit count;
- provider-capacity count when represented by normalized evidence;
- structured-output rejection associated with responses;
- sample size.

This is an **observed window**, not an SLA or a universal provider ranking.

A provider with one successful attempt should not receive a giant green HEALTHY badge.

Small samples should be labeled as insufficient or low-confidence evidence.

---

## What are p50 and p95?

Latency percentiles describe the observed distribution.

### p50

The median.

Half the observed values are at or below it.

### p95

A tail-latency measure.

Ninety-five percent of observed values are at or below it, and the slowest five percent are above it.

Example:

```text
p50: 400 ms
p95: 2,800 ms
```

Most requests are reasonably fast, but a meaningful tail is much slower.

Percentiles should show their sample size and should not be calculated from missing duration evidence.

---

## Why not use averages alone?

Averages can hide the shape of failures.

Consider:

```text
Nine attempts: 200 ms
One attempt: 8,000 ms
```

The average is 980 ms.

That does not communicate that most attempts were fast while one was extremely slow.

The workbench may show averages where useful, but p50, p95, counts, and drill-down are more informative.

---

## What is a time window?

Every aggregate needs an explicit period:

- last hour;
- last 24 hours;
- last 7 days;
- last 30 days;
- custom range.

Without a window, “failure rate” is a number floating without context.

The UI should display the exact resolved UTC range while presenting dates in the operator’s locale.

---

## What should search support?

A useful execution explorer should search or filter by evidence such as:

- execution ID;
- trace ID;
- terminal status;
- provider;
- model;
- normalized error category or code;
- time range;
- retry recovery;
- fallback use;
- latency-budget failure;
- structured-output rejection;
- provider-call ambiguity;
- replay-derived execution.

Search state should live in the URL so a filtered view can be bookmarked or shared.

---

## What is drill-down?

Every aggregate should lead back to evidence.

Clicking:

```text
Latency-budget failures: 12
```

should open the execution explorer with the corresponding filter applied.

Clicking a provider/model row should show attempts or executions associated with that route.

The workbench must not become a wall of decorative metrics that cannot answer:

> Which executions produced this number?

---

## What does trace correlation mean here?

Every execution already has a trace ID.

The first workbench slice should support:

- exact trace-ID search;
- visible trace ID in execution summaries;
- copyable correlation information;
- direct navigation to the execution detail.

An external trace or log backend may be linked later through explicit configuration.

The workbench should not pretend it can search logs that are not connected.

---

## What is not a reliability score?

The workbench should not collapse everything into one number such as:

```text
Provider A reliability: 87
```

Such a score would require arbitrary hidden weights for:

- failure;
- degraded success;
- latency;
- cost;
- retries;
- fallback;
- structured-output rejection;
- sample size.

Instead, show the dimensions and let the operator drill into their evidence.

---

## Why server-side filtering and aggregation matter

The current prototype can load all executions and calculate simple counts in the web process.

That works with a handful of deterministic runs.

It does not scale because full execution envelopes may include:

- attempts;
- event history;
- replay capability hydration;
- outputs;
- error data.

The Investigation Workbench should use a read-oriented summary model:

```text
Small execution summaries for lists
Aggregate queries for metrics
Full envelopes only for detail pages
```

This also removes the current unbounded list and replay-capability N+1 pattern.

---

## What should the first workbench slice prove?

The first bounded slice should prove that an engineer can:

1. choose a time window;
2. see evidence-grounded aggregate signals;
3. drill from a metric to a filtered execution set;
4. search by execution ID or trace ID;
5. filter by status, route, failure, and derived signal;
6. page through results stably;
7. inspect provider/model attempt observations;
8. open an execution or comparison;
9. understand definitions and sample sizes;
10. do all of this without SQL or source-code inspection.

---

## What remains later within Horizon 5?

The first workbench foundation does not need to include:

- saved named investigation cases;
- comments or collaboration;
- alerting;
- automatic anomaly detection;
- statistical significance claims;
- external log ingestion;
- external trace-backend integration;
- batch experiment campaigns;
- automatic policy recommendations;
- LLM-generated incident summaries;
- a general BI platform.

Those can be added only when the evidence and workflow justify them.

---

## Working vocabulary

| Term                    | Plain meaning                                                  |
| ----------------------- | -------------------------------------------------------------- |
| Investigation Workbench | Search, aggregate signals, and evidence-grounded drill-down    |
| Investigation signal    | A derived pattern worth examining                              |
| Execution summary       | A small list-oriented representation of one execution          |
| Terminal denominator    | Completed executions used for outcome rates                    |
| In flight               | Accepted, queued, or running executions                        |
| Retry recovery          | A retrying execution that later succeeded or degraded          |
| Fallback dependence     | An acceptable outcome that used a fallback route               |
| Provider observation    | Attempt-level evidence for one provider/model in a time window |
| p50                     | Median observed latency                                        |
| p95                     | Tail latency below which 95% of observations fall              |
| Drill-down              | Moving from an aggregate number to the executions behind it    |
| Trace correlation       | Finding an execution through its trace ID                      |
| Sample size             | Number of observations supporting a metric                     |

---

## Final mental model

The existing execution page is a microscope.

The Investigation Workbench is the lab bench:

```text
Lab bench:
  Which sample should I examine?

Microscope:
  What happened inside this execution?

Wind tunnel:
  What changes under a controlled variation?
```

The workbench does not replace execution detail or Comparative Replay.

It guides the operator toward the cases where those tools are useful.

## What the foundation implements now

The bounded foundation is available at `/investigations`. It uses focused tenant-scoped APIs for
compact execution search, aggregate summary evidence, and provider/model attempt observations.
Every response returns its resolved time range; search uses an opaque newest-first cursor; URL
filters drill into ordinary execution detail pages while preserving a return link.

The compatibility execution-list endpoint remains for older callers. The workbench does not use it,
does not fetch replay capsules or prompt/output bodies, and does not hydrate full attempts and
events for table rows. External logs/traces, saved investigation cases, alerting, anomaly detection,
and universal provider rankings remain intentionally outside this foundation.
