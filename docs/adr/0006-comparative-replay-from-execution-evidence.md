# ADR 0006: comparative replay from normal execution evidence

Status: accepted, 2026-07-28.

Represent comparative replay as a versioned experiment definition plus two ordinary execution
envelopes. Accept only bounded provider, model, policy, and budget variation while keeping retained
input fixed. Persist the requested variation and fully resolved non-sensitive conditions, then
derive dimension-level comparison results from the envelopes on read.

This preserves one execution lifecycle and one append-only event model. The variant uses normal
submission, policy, persistence, continuation, and SSE, so comparison does not invent shadow
attempts or synthetic events. Missing evidence is explicit, route and fallback changes are
tradeoffs, and exact output equality is factual rather than a semantic quality judgment. No
weighted score or universal winner is assigned.

The vault is the authority for retained input and is read only inside the service operation.
Experiment rows contain tenant, linked execution IDs, requested overrides, resolved safe
configuration, status, and timestamps; never input or messages. Unavailable vault states are
persisted as unavailable experiments. No-op variants require an explicit reproducibility check.

Variant execution creation and experiment persistence are not atomic in this in-process prototype.
A failure after execution acceptance can leave a linked variant without its experiment row. The
durable-execution horizon must add reconciliation and a stronger transaction or workflow boundary.
This decision does not add a queue, worker, cancellation, leases, generic A/B framework, LLM judge,
weighted ranking, or batch experiments.
