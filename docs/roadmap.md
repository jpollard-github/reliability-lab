# Reliability Lab Roadmap

> This is a map of outcomes, not a backlog. It describes what the system is becoming, how the major parts fit together, and what “done enough” looks like at each horizon. Individual implementation choices can change without turning this document into a graveyard of checkboxes.

## North star

Reliability Lab should let an engineer answer five questions about an LLM execution:

1. **What happened?**
2. **Why did the reliability policy make those decisions?**
3. **Can this execution or investigation case be reproduced safely?**
4. **What changes when the provider, model, budget, or policy changes?**
5. **Can we investigate all of this without leaking or crossing tenant data?**

The end goal is not another chatbot, provider wrapper, or generic admin panel. It is an **explainable reliability workbench**: capture an execution, preserve the useful evidence, replay it under controlled conditions, compare outcomes, and learn which policies actually improve reliability.

```text
Execute → Explain → Preserve safely → Replay → Compare → Learn → Operate
```

This is the system-evolution sequence: it describes how product capabilities build on safe
evidence. The operator Guide uses a distinct product-use workflow:
`Execute → Explain → Watch → Replay → Compare → Investigate → Preserve`.

## The moving parts

### Evidence plane

The execution envelope, attempts, normalized failures, policy decisions, timing, usage, trace correlation, and append-only events form the factual record. This plane explains an execution or investigation case without requiring raw prompt retention.

### Replay vault

Replay capsules preserve the minimum sensitive input needed to reproduce an execution. They must be tenant-scoped, encrypted, expirable, deletable, auditable, and explicitly unavailable when policy does not permit retention.

### Experiment engine

A replay becomes more valuable when it can run under the original conditions or a deliberate variation. Versioned policies, provider/model substitutions, scenario definitions, and normalized comparisons turn isolated incidents into reliability experiments.

### Runtime control plane

Rate limits, circuit state, latency and cost budgets, idempotency, cancellation, leases, queues, and recovery govern live execution. These controls eventually need distributed, multi-replica semantics rather than process-local memory.

### Operator console

The dashboard is the investigation surface: execution search, timelines, attempt details, replay controls, comparisons, scenario runs, and aggregate reliability signals. It should expose evidence and decisions, not raw sensitive data by default.

### Trust boundary

Identity, tenant membership, authorization, row-level isolation, retention policy, access auditing, redaction, key management, and safe provider egress determine who can see or replay what.

### Operational shell

Deployment, migrations, telemetry pipelines, health and readiness, backups, restore exercises, runbooks, and a reproducible demo make the lab operable beyond one developer process.

## Roadmap horizons

The horizons are intentionally ordered around the product’s distinctive value. Generic platform machinery should not outrun the replay-and-comparison story.

### Horizon 0: A working execution record

**Established foundation.** Reliability Lab’s first vertical slice delivered validated execution,
deterministic failure injection, retry and fallback policy, structured-output validation,
append-only events, PostgreSQL execution persistence, OpenTelemetry spans, an operator dashboard,
idempotency, and an initial process-local replay path.

This horizon proves that an execution can be represented as an inspectable envelope rather than a final HTTP status and a shrug.

### Horizon 1: Replay that can be trusted

**Established foundation.** Replay survives a restart without turning retained prompts into an ungoverned
side database.

A replay capsule is durably encrypted, scoped by tenant and execution, written under an explicit retention policy, and represented by a current capability state. Operators can see whether replay data is available, expired, deleted, or unavailable by policy. Deletion and access are auditable. Key versions support read-old/write-current rotation without pretending that local environment keys are a production KMS.

The prototype now meets this horizon's completion signal with a PostgreSQL AES-256-GCM vault,
tenant-scoped access, current capability states, expiry, deletion, metadata-only auditing, key
versions, restart-durable replay, and fail-closed live retention. Environment keys and the missing
authenticated actor remain deliberate prototype limitations rather than production claims.

### Horizon 2: Watch the machine work

**Established foundation.** The operator can observe a running execution as actual persisted events occur and
can replay the recorded event history when the execution is too fast to watch live.

The console visibly projects the active route through request acceptance, provider attempts,
normalized observations, retry and real backoff, fallback, structured-output validation, budgets,
circuit decisions, and terminal outcome. Attempt branches and route changes remain grounded in the
append-only event record. The tenant-scoped SSE transport backfills persisted history, resumes from
a sequence cursor, and closes after terminal evidence; playback changes presentation timing only.

The prototype meets this horizon's completion signal with dashboard-started deterministic retry and
fallback scenarios, a refresh-safe event stream, live incremental history, and pause, resume, step,
restart, and speed controls. The stream now also projects durable queue, worker claim, and recovery
evidence.

### Horizon 3: Compare, not merely repeat

**Established foundation.** An execution or investigation case can be replayed as a controlled,
tenant-scoped original-versus-variant experiment.

The operator chooses bounded provider, model, retry, fallback, and budget overrides while retained
input remains fixed. The service persists the requested variation and fully resolved safe
conditions, submits the linked variant through the normal execution path, and derives comparison
dimensions from the two ordinary envelopes. Missing evidence is unavailable rather than zero, and
the product does not invent a weighted score, semantic judge, or universal winner.

The dashboard now meets this horizon's completion signal with guided presets, inherited and
overridden conditions, side-by-side recorded/live machines, playback on either envelope,
dimension-level explanations, and links to both execution details.

### Horizon 4: Execution that survives reality

**Established foundation after its final bounded correctness pass.** In explicit PostgreSQL worker
mode, accepted work is no longer tied to the API process.

The foundation atomically accepts executions and comparison variants into PostgreSQL, encrypts
transient commands, serializes idempotency by tenant/key, and uses a separate worker with exclusive
versioned leases, serialized observed heartbeats, claim fencing, lease-aware continuation, bounded
concurrency, safe reclaim, terminal reconciliation, and conservative provider-call ambiguity.
Existing persisted SSE carries worker-produced evidence.

This lease-safety work is the final correctness pass for the current Durable Execution Foundation,
not a new horizon. Accepted work survives API loss, untouched jobs survive worker loss, and stale
claims are fenced. Provider-call ambiguity remains explicit rather than exactly-once.

Continuation still does not have a general transactional outbox, cancellation, operator
recovery/dead-letter tools, distributed rate/circuit controls, or resumable mid-policy execution.
Those remain possible future work, not prerequisites for Horizon 5.

**Completion signal.** An API or worker restart does not silently lose accepted work, duplicate an execution, or erase the explanation of what happened.

### Horizon 5: An operator’s reliability lab

**Established movements: Saved Investigation Cases, Product Tour and Operator Guidance, and
Evidence-Backed Case Conclusions and Review Packets.**
Investigation persists beyond one browser session without becoming a generic ticketing system, and
the product now teaches the established operator workflow. The cross-cutting Human-Comprehension and
Ownership Pass has established Phase 1 contracts/core, Phase 2 persistence/API composition, Phase 3
operator-console/test organization, and Phase 4 ownership documentation/design review. The
Human-Comprehension and Ownership Pass is complete.

The established console supports bounded filtering and search, internal trace-identifier
correlation, replay comparisons, five deterministic scenarios, attempt-level provider/model
observations, and aggregate reliability evidence. It exposes signals such as success, degraded
success, retry recovery, fallback dependence, and latency-budget failure. Broader scenario catalogs,
policy experiment surfaces, external trace/log correlation, and universal provider-health views
remain future possibilities.

The established first movement, **Investigation Workbench Foundation**, provides bounded explicit
time ranges, compact and stably paginated execution search, aggregate reliability signals,
attempt-level provider/model observations, trace correlation, and evidence-grounded drill-down to
existing detail/replay/comparison flows.

The established second movement, **Saved Investigation Cases**, adds exact canonical scope snapshots, bounded
current interpretation, archive status, typed current evidence references, append-only notes, and a
metadata-only lifecycle timeline. It deliberately has no fabricated author, assignment, threaded
comments, arbitrary attachments/URLs, automatic case creation, or copied execution envelopes. The
tenant header remains routing context rather than authenticated identity.

The established third movement, **Product Tour and Operator Guidance**, adds a server-rendered Guide,
focused contextual concept help, and stateless on-demand tours for all six established route
families. It teaches the current product and its limitations without adding a broad scenario
catalog, analytics, stored progress, or a second demonstration application.

The established fourth movement, **Evidence-Backed Case Conclusions and Review Packets**, derives
bounded current summaries for execution, comparison, and provider-observation links; shows every
link as available or explicitly unavailable; applies five deterministic workflow-readiness checks;
requires finding and resolution before resolving; and exports the same safe projection as escaped
Markdown with internal trace links and explicit exclusions. It does not copy source evidence,
generate conclusions with AI, score truth, establish causation, or turn the packet into a
public-safe report.

Horizon 5 is not complete. A broader scenario catalog and explicitly configured external trace/log
correlation remain later possibilities when the workflow justifies them. The product still does not
claim universal provider health or alerting. The supported-conclusion completion signal below is
now established for the bounded saved-case workflow, while broader Horizon 5 scope remains open.

**Completion signal.** A developer can move from an investigation case to a supported reliability conclusion without querying tables or reading application source.

### Horizon 6: A tenant-safe service

**Desired outcome.** Prototype routing context becomes an enforceable security model.

Authenticated principals, tenant membership, roles and permissions, service authorization, PostgreSQL row-level security, controlled replay privileges, retention-policy ownership, access review, and isolated provider credentials protect the evidence and replay planes.

**Completion signal.** Tenant isolation and replay authorization are enforced at multiple layers and can be demonstrated by tests, not inferred from a header convention.

### Horizon 7: A reference reliability system

**Desired outcome.** Reliability Lab is reproducible, demonstrable, and operationally honest.

A reference deployment includes migrations, telemetry, dashboards, backup and restore procedures, dependency and image maintenance, incident runbooks, safe sample scenarios, and a compact demonstration narrative. The project can show both its capabilities and its deliberate limitations.

**Completion signal.** Another engineer can deploy it, run representative execution scenarios, understand the architecture, and evaluate the tradeoffs without private context from its author.

## Ordering principles

- Deepen the **explain → replay → compare** loop before building a broad platform around it.
- Keep normalized evidence useful even when sensitive replay data is unavailable.
- Treat replay as a revocable capability, not a permanent boolean stamped at execution time.
- Preserve framework-independent domain policy and keep infrastructure at composition boundaries.
- Prefer one complete vertical slice over several impressive skeletons.
- Make unsafe states explicit and fail closed rather than silently falling back to weaker storage.
- Let production hardening serve a demonstrated workflow; do not add queues, auth, Redis, or cloud-specific machinery merely because mature systems usually have them.

## Near-term direction

The product sequence is:

```text
Durable Execution Safety
        ↓
Investigation Workbench Foundation
        ↓
Saved Investigation Cases
        ↓
Human-Comprehension and Ownership Pass complete
        ↓
Product Tour and Operator Guidance established
        ↓
Evidence-Backed Case Conclusions and Review Packets established
        ↓
Evaluate the next broader Horizon 5 movement
```

Comparative Replay now turns a retained case and its live evidence into a controlled experiment.
The **Horizon 4 Durable Execution Foundation** now makes acceptance restart-durable in PostgreSQL
worker mode and fences stale claims without overstating exactly-once provider behavior. The
Investigation Workbench Foundation and Saved Investigation Cases are established. Contracts/core
(Phase 1), persistence/API composition (Phase 2), operator-console/test organization (Phase 3), and
ownership documentation/design review (Phase 4) now make those capabilities easier to locate,
explain, defend, and safely modify. Product Tour and Operator Guidance and Evidence-Backed Case
Conclusions and Review Packets are established without advancing Horizon 6 claims. The next broader
Horizon 5 movement remains intentionally unelected;
candidates include a guided scenario catalog and policy experiments, explicitly configured
trace/log correlation, or deeper operator recovery. None is declared
complete. Cancellation, Redis coordination, generic outbox tooling, resumable workflow machinery,
and cloud infrastructure are not prerequisites for evaluating that choice.
