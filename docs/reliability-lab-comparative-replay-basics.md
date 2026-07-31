# Reliability Lab: Comparative Replay Basics

This document explains the current Comparative Replay feature in plain language.

## The feature in one sentence

**Comparative Replay takes one recorded LLM execution, reruns the same retained input under a controlled change, and shows exactly how the operational outcome differs.**

It is the wind-tunnel part of Reliability Lab.

The original execution says:

> This is what happened.

The variant says:

> This is what happened when one or more controlled conditions changed.

The comparison says:

> These dimensions improved, worsened, stayed the same, changed with mixed meaning, or could not be determined.

---

## What is a comparison experiment?

A **comparison experiment** links two ordinary executions:

1. the **original execution**;
2. the **variant execution**.

The variant is not a simulated row in a report. It goes through the normal execution path:

- request acceptance;
- provider attempts;
- retries;
- fallback;
- structured-output validation;
- budgets;
- append-only events;
- terminal outcome.

That matters because the comparison is built from real execution evidence rather than guesses.
Timeline playback of either side is different: it only presents each execution's recorded events
and never creates a variant or calls a provider.

```text
Original retained input
        ├── Original conditions → Original execution
        └── Changed conditions  → Variant execution

Original execution + Variant execution
        → Comparison projection
```

---

## What stays fixed?

The retained request input stays fixed.

That may include:

- input text or messages;
- the structured-output schema;
- deterministic failure-injection information for local scenarios.

The comparison API does not accept replacement prompt text. This prevents a supposed policy experiment from quietly becoming a different request.

---

## What may change?

The current slice allows bounded changes to operational conditions such as:

- provider;
- model;
- maximum attempts;
- retry backoff;
- jitter;
- fallback provider and model;
- latency budget;
- cost budget where supported.

These are **reliability controls around the LLM call**.

The feature does not currently change the prompt, judge subjective answer quality, or train a model.

---

## Requested variation versus resolved configuration

This is an important distinction.

### Requested variation

The operator supplies only what should change:

```json
{
  "policy": {
    "maxAttempts": 1,
    "fallbackProvider": "fake-fallback"
  }
}
```

Everything omitted means:

> Inherit the original value.

### Resolved configuration

The service combines the requested changes with inherited original values:

```json
{
  "provider": "fake-primary",
  "model": "deterministic-v1",
  "policy": {
    "maxAttempts": 1,
    "baseBackoffMs": 1500,
    "maxBackoffMs": 1500,
    "jitterRatio": 0,
    "fallbackProvider": "fake-fallback",
    "fallbackModel": "deterministic-v1"
  },
  "budget": {
    "maxLatencyMs": 8000
  }
}
```

The resolved configuration is the complete, non-sensitive description of what the variant actually ran.

This prevents future confusion such as:

> Did the blank field mean zero, none, default, or inherit?

---

## What is a reproducibility check?

A normal comparison must change something.

A **reproducibility check** deliberately runs the same retained input under the same resolved conditions.

It asks:

> Do the same recorded conditions produce the same normalized evidence again?

The system requires this to be explicit so an accidental no-op is not presented as a meaningful variant.

A reproducibility check may still produce different model output when a live model is nondeterministic. That difference is evidence, not automatically a failure.
It is therefore still a new provider execution, unlike Timeline playback.

---

## What does the comparison measure?

The current comparison projection examines dimensions such as:

- terminal outcome;
- normalized error;
- provider and model route;
- total attempts;
- retry count;
- fallback use;
- structured-output result;
- duration;
- input and output tokens;
- estimated cost when available;
- latency-budget result;
- exact output equality.

Each dimension has:

```text
Original value
Variant value
Change classification
Explanation
```

The change classifications are:

| Classification | Plain meaning                                                 |
| -------------- | ------------------------------------------------------------- |
| `improved`     | Better for this specific dimension under an explicit rule     |
| `worsened`     | Worse for this specific dimension under an explicit rule      |
| `unchanged`    | The normalized evidence matched                               |
| `mixed`        | It changed, but the change is not inherently better or worse  |
| `unavailable`  | The necessary evidence does not exist yet or was not recorded |

---

## Why is there no overall score?

Because reliability is multi-dimensional.

Consider:

```text
Original:
  succeeded
  2 attempts
  1.5 seconds
  no fallback

Variant:
  degraded success
  2 attempts
  20 milliseconds
  fallback used
```

The variant is much faster, but it depends on a fallback and has a degraded outcome classification.

A single score would require arbitrary weights:

- How much is 1 second worth?
- How bad is fallback dependence?
- Is degraded success acceptable?
- Does cost matter more than latency?
- Is exact output equality important for this request?

Reliability Lab therefore reports the tradeoffs and leaves the decision visible.

---

## A useful first experiment

Start with the deterministic **Retry after rate limit** scenario.

The original path should resemble:

```text
Attempt 1: primary provider rate-limited
Retry scheduled: 1500 ms
Attempt 2: primary provider succeeds
Outcome: success
```

Then create a variant using the **Immediate fallback** preset:

```text
Attempt 1: primary provider rate-limited
Fallback selected
Attempt 2: fallback provider succeeds
Outcome: degraded success
```

The comparison should reveal something like:

```text
Original                         Variant
primary → primary               primary → fallback
1 retry                         0 retries
no fallback                     fallback used
~1500 ms                        much faster
success                         degraded success
```

That is a real reliability tradeoff:

> Waiting preserved the preferred provider and full success classification. Immediate fallback reduced latency but introduced fallback dependence and degraded status.

---

## Why the deterministic scenarios may feel unsurprising

They are deliberately controlled.

Their first job is to prove:

- the same evidence drives execution, streaming, playback, and comparison;
- changing one condition causes an explainable change;
- the system does not invent events;
- tenant and replay boundaries remain intact;
- missing evidence is not silently converted to zero;
- the UI reports mixed tradeoffs without declaring a fake winner.

That can feel more like watching a laboratory demonstration than discovering something unexpected.

The feature becomes more interesting when it receives real investigation cases:

- an actual provider capacity rejection;
- a rate-limit incident;
- malformed structured output from a live model;
- a slow provider route;
- two configured models with different latency and usage;
- a retry policy that unexpectedly increases cost without improving outcome.

The deterministic fixtures are the calibration weights. They are not the final concert.

---

## What exact output match means

The system may report whether text and structured output match exactly.

Exact match means only:

> These stored outputs are byte-for-byte or structurally identical under the project’s canonical comparison.

It does not mean:

- semantically equivalent;
- factually correct;
- equally useful;
- equally safe;
- equally well written.

Likewise, an exact mismatch is a factual difference, not automatically a quality regression.

---

## One semantic caution

Lower latency, fewer attempts, and lower estimated cost can reasonably be marked improved for those individual dimensions.

Token counts require more restraint:

- lower input tokens may indicate a provider-accounting difference;
- lower output tokens may indicate efficiency, truncation, or simply a shorter answer;
- more output tokens may be wasteful or may contain necessary detail.

Token changes are best treated as evidence or mixed tradeoffs unless a specific token budget was part of the experiment.

---

## What Comparative Replay does not yet solve

It does not yet provide:

- resumable continuation after an ambiguous provider call;
- semantic answer evaluation;
- an LLM judge;
- batch experiment campaigns;
- statistical confidence across many runs;
- authenticated users or authorization;
- production KMS;
- aggregate provider-health analysis;
- automatic policy recommendations.

Those are separate horizons.

---

## Working vocabulary

| Term                   | Plain meaning                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Original execution     | The recorded execution selected for comparison                                                    |
| Variant execution      | A normal replay-derived execution with controlled changed conditions                              |
| Comparison experiment  | The durable record linking original, requested variation, resolved variant, and variant execution |
| Requested variation    | Only the fields the operator wants to change                                                      |
| Resolved configuration | The complete effective configuration after inheritance                                            |
| Comparison projection  | The derived dimension-by-dimension differences                                                    |
| Reproducibility check  | An explicit same-conditions rerun                                                                 |
| No-op variation        | A variation that resolves to no actual change                                                     |
| Mixed change           | A difference that is not inherently an improvement or regression                                  |
| Exact output match     | Factual equality, not semantic quality                                                            |

---

## Final mental model

The original Reliability Lab basics used the image of a **flight recorder and wind tunnel**.

Comparative Replay is the wind tunnel operating:

```text
Flight recorder:
  What happened?

Wind tunnel:
  What changes when we alter one controlled condition?

Comparison panel:
  Which consequences improved, worsened, stayed fixed, or remained ambiguous?
```

The purpose is to replace:

> “Maybe immediate fallback would have been better.”

with:

> “Immediate fallback removed 1.5 seconds of retry delay, changed the route, required the fallback provider, and changed the outcome from success to degraded success.”

A saved investigation case can start this same ordinary comparison from linked replay-capable
execution evidence and receive the result as typed evidence. See
[Case-Driven Policy Experiments basics](reliability-lab-case-driven-policy-experiments-basics.md).
