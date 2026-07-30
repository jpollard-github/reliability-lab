# Reliability Lab: Case-Driven Policy Experiments Basics

## The feature in one sentence

A saved investigation case can start one ordinary controlled comparison from execution evidence
already linked to that case, then bring the comparison back as current case evidence.

## Why the case drives the experiment

The case holds the operator's exact investigation scope, question, interpretation, and typed
evidence references. Starting from that surface preserves the reason for the experiment without
introducing an experiment-suite record or copying source evidence. The case remains the durable
grouping surface; `ComparisonExperiment` remains the authoritative experiment record.

One submission creates one comparison. This is not a batch campaign, repeated sampling system, or
automatic policy search.

## Which linked executions are eligible

The operator chooses a persisted execution `evidenceId`, not a free execution identifier. The
coordinator verifies that the evidence:

- belongs to the requested case;
- has type `execution`;
- resolves through the same tenant-scoped execution repository;
- currently has replay capability.

Case detail derives the selector from the bounded case review projection, so identity, status, and
replay state appear in server-rendered HTML. Deleted, expired, missing, or policy-disabled replay
material stays visible as ineligible evidence rather than disappearing.

## What stays fixed

The retained input stays fixed. The case does not receive a copy of the input, output, replay
capsule, provider request, execution envelope, or comparison envelope.

The operator can vary only the established Comparative Replay fields: provider, model, retry
limits and backoff, fallback conditions, jitter, and latency budget. Blank fields inherit the
baseline, explicit removal stays distinct from inheritance, and presets use the same draft
resolution logic as execution-detail comparisons.

## Comparison creation and case linking are separate

`InvestigationCaseExperimentService` first delegates to the ordinary comparison service. It then
links the resulting comparison identifier to the case through the existing evidence service.
These operations cross separate persistence boundaries and are not atomic.

The result is explicit:

- `comparison_linked` means the comparison exists and its evidence reference is linked;
- `comparison_created_link_failed` means the comparison exists, but automatic evidence linking
  failed.

An ordinary replay-unavailable result is still a valid comparison record and can be linked as
useful evidence.

## Recover without creating a duplicate

When automatic linking fails, the response and UI preserve the experiment identifier and link to
the existing comparison. Recovery calls the established case evidence-link endpoint with that
identifier. It does not submit another comparison.

The browser disables repeat submission while a request is active and after an experiment result is
returned. This prevents ordinary accidental double clicks, but comparison-create idempotency is not
established across independent clients or retried HTTP requests.

## How the result returns to review

A linked comparison uses the existing typed evidence reference. The current case review resolves
it through the authoritative comparison repository, applies the normal available/unavailable
projection, includes it in deterministic conclusion readiness, and renders it through the existing
Markdown packet. There is no experiment-specific packet renderer or shadow result copy.

Metadata-only timeline events record a successful comparison start or an automatic-link failure.
They may name case, evidence, execution, experiment, operation, and link state, but contain no
variation prose, prompt content, output, provider body, credentials, headers, or cookies.

## What is intentionally not built

This slice does not add experiment suites, batch campaigns, statistical confidence, repeated
stochastic sampling, semantic scoring, an LLM judge, a winner, automatic recommendations,
automatic findings or resolution, prompt replacement, external telemetry ingestion, cancellation,
generic recovery tooling, authenticated authorship, assignment, approval, RBAC, or production
tenant isolation.

The experiment supplies bounded evidence for a human conclusion. It does not prove answer
correctness, causation, policy superiority, provider health, exactly-once creation, or atomic
comparison-and-case persistence.

## Related reading

- [Comparative Replay basics](reliability-lab-comparative-replay-basics.md)
- [Saved Investigation Cases basics](reliability-lab-saved-investigation-cases-basics.md)
- [Evidence-Backed Case Conclusions basics](reliability-lab-evidence-backed-case-conclusions-basics.md)
- [ADR 0011](adr/0011-case-driven-policy-experiments.md)
- [System flows](system-flows.md#6b-case-driven-policy-experiment)
