# Reliability Lab: Evidence-Backed Case Conclusions Basics

## The problem in one sentence

**A saved case needs a bounded current review of every linked source before its finding, resolution,
and handoff packet can support a human reliability conclusion.**

## Evidence review is not evidence copying

The case stores typed references. `InvestigationCaseReviewService` resolves those references at read
time through the existing tenant-scoped execution, comparison, investigation, and replay ports. It
does not copy envelopes into case storage and does not call this application's HTTP API from core or
database code.

Execution review contains only a compact normalized summary and current replay capability.
Comparison review reuses the existing dimension projection and exposes requested versus resolved
safe conditions. Provider observation review reruns the existing bounded query for the exact saved
provider, model, and half-open range. Prompt, message, output, attempt, event, provider-body, replay,
command, and cryptographic content stays outside the projection.

## Available and unavailable evidence

Every persisted link produces one review item in the same deterministic order. An item is either:

- `available`, with a bounded typed summary; or
- `unavailable`, with its original typed reference, safe internal source route, constrained reason,
  and plain explanation.

A missing source, failed current read, empty exact provider observation, or unsupported historical
schema never makes the reference disappear. A missing replay capsule is only the execution's
current replay-capability state; it does not make the execution unavailable. Tenant predicates
remain on every authoritative read, and a wrong-tenant case is still ordinary not found.

## Readiness is not correctness

Conclusion readiness uses five fixed checks:

1. exact saved scope is present;
2. at least one evidence reference is linked;
3. every reference has an explicit current review state;
4. a non-empty finding is present;
5. a non-empty resolution is present.

`ready` means the case record is complete enough to resolve. It is not a percentage, evidence score,
confidence estimate, correctness claim, causal judgment, or provider ranking. Unavailable evidence
can still have an explicit review state; the operator must interpret that limitation.

## Finding and resolution

A **finding** is the current interpretation supported by the reviewed evidence. A **resolution** is
the current decision, action, or conclusion. They answer different questions, so both are required
while a case is `resolved`.

The domain service rejects a transition to `resolved` without both fields and rejects clearing
either field while the case remains resolved. An operator may reopen or archive the case and clear
or revise them. Historical inconsistent resolved rows remain readable and show failed readiness
checks; a later update cannot leave such a row resolved without correction.

## Review packet

The tenant-scoped API renders a Markdown packet from the same `InvestigationCaseReview` projection
used by the case page. It contains:

- title, ID, status, optional importance, question, and exact saved scope;
- current finding and resolution;
- the five readiness checks and their explanations;
- bounded available and unavailable evidence summaries;
- note count without note bodies;
- internal source routes;
- prototype, evidence, tenant, provider-effect, and correctness limitations;
- generated timestamp.

Bounded prose and Markdown destinations are escaped. The filename is sanitized as
`reliability-case-<safe-case-id>.md`. The browser download sends the established tenant header;
packet formatting exists only in core.

The packet excludes append-only note bodies, prompts, inputs, outputs, messages, raw provider
bodies, complete attempts, full events, validation payloads, replay capsules, encrypted commands,
credentials, authorization headers, cookies, keys, and arbitrary external URLs. It remains
tenant-scoped operational data and is not described as public-safe.

## Security and tenant limits

The derived read introduces no new table and no copied evidence retention. New links are capped at
50 per case; review reads use fixed-size concurrency batches while preserving order. Existing
repository tenant behavior makes wrong-tenant source reads indistinguishable from missing evidence.
Logs contain case IDs, operation types, evidence type/count metadata, and no case or evidence prose.

The tenant header is still routing context, not authenticated identity. The packet has no author,
owner, approver, resolver, role, or production-isolation claim.

## Intentionally not built

This movement adds no LLM-generated conclusion, semantic judge, evidence score, confidence
percentage, provider winner, automatic resolution, alert, assignment, approval, external
attachment, arbitrary link, broad scenario catalog, external trace/log integration, cancellation,
operator recovery, or Horizon 6 identity capability.

See [ADR 0010](adr/0010-derived-case-evidence-review-and-safe-review-packets.md) for the durable
architecture decision and [Saved Investigation Cases basics](reliability-lab-saved-investigation-cases-basics.md)
for the underlying case model.

Comparisons started from a case enter this same review and packet path through the ordinary typed
comparison evidence link; there is no second packet renderer or copied result. See
[Case-Driven Policy Experiments basics](reliability-lab-case-driven-policy-experiments-basics.md).
