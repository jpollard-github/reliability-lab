# Reliability Lab Horizon 5 Closure basics

## Status

Horizon 5 is established against one bounded, repository-backed operator drill. This document is the
current closure record. It does not claim production readiness, measured usability, factual answer
quality, universal provider health, or Horizon 6 tenant safety.

## The established loop

```text
Execute → Explain → Watch → Replay → Compare → Investigate → Preserve → Experiment → Conclude
```

The implementation lets an operator:

1. execute a policy-controlled LLM request and inspect append-only decision evidence;
2. watch current and recorded execution state;
3. replay retained input and compare one bounded variation;
4. investigate a fixed tenant-scoped time range and preserve it as a case;
5. review current authoritative evidence, including explicit unavailable states;
6. run one case-driven policy experiment without changing retained input;
7. recover a created-but-unlinked comparison after reload without creating a second experiment;
8. record a finding and resolution under fixed readiness checks; and
9. export the same bounded safe projection as a deterministic Markdown review packet.

The drill is supported across contracts, core, memory, PostgreSQL, API, worker, App Router server
rendering, focused client mutations, and workflow-named tests.

## Durable partial-result recovery

Comparison creation and case linking are not atomic. When creation succeeds but linking fails, the
case timeline records `case.comparison_link_failed` with safe identifiers. The derived review
reconstructs one pending continuation from persisted events, current case evidence, and a current
tenant-scoped comparison read.

The server-rendered case page and review packet show the existing comparison. The only mutation is
“Link existing comparison to case.” A successful link records
`case.comparison_link_recovered`. That completion remains authoritative even if the evidence link is
later removed intentionally. See [ADR 0012](adr/0012-derived-case-comparison-link-recovery.md).

Available, missing, and current-read-unavailable recovery states are explicit. Wrong-tenant
comparison reads look missing. The projection is bounded to 50 items with an explicit total and
`hasMore`; reads run in fixed-size batches.

## Conclusion readiness

The existing five checks remain:

- exact saved scope;
- at least one linked evidence reference;
- an explicit current review state for every linked reference;
- a current finding; and
- a current resolution.

Pending comparison recovery is visible but does not add a score, claim correctness, or change the
resolved-case requirement. A case can still be resolved only with non-empty finding and resolution.

## Evidence and exclusions

Cases and packets may contain bounded operational prose and typed internal references. They exclude
raw prompts, messages, outputs, provider bodies, attempt/event payloads, replay material, encrypted
commands, credentials, authorization, cookies, and note bodies. Timeline recovery metadata contains
only case, comparison, execution, timestamp, and link-state identifiers.

The tenant header is routing context, not authenticated identity. No actor, author, owner, approval,
RBAC, RLS, KMS, exactly-once provider effect, generic recovery system, scenario campaign, or
production operating guarantee follows from Horizon 5 closure.

## Operator drills

The focused case experiment drill verifies:

- normal comparison creation and automatic evidence linking;
- real partial-link failure after the comparison is persisted;
- a full reload and a new no-JavaScript page showing server-rendered pending recovery;
- opening the existing comparison;
- link-only recovery after capacity is available;
- one comparison request and one evidence association;
- durable completion after API/repository re-instantiation;
- pending packet content before recovery and its removal afterward;
- tenant-safe missing behavior, sensitive exclusions, responsive layout, and no browser errors.

Repository verification additionally covers unit, API, PostgreSQL integration, built runtime, API,
worker, and production web startup.

## What closure does not elect

Broader scenario catalogs, statistical campaigns, external trace/log integrations, universal
provider-health views, generic recovery tooling, and deeper operator research remain optional
future candidates. Horizon 6 identity and tenant guarantees are the next named horizon, but they are
not implemented or implicitly started.
