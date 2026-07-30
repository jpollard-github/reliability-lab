# Reliability Lab: Saved Investigation Cases Basics

This document explains the next Reliability Lab product slice in plain language.

## The feature in one sentence

**A saved investigation case collects the executions, comparisons, filters, notes, and conclusions that belong to one reliability question.**

The Investigation Workbench helps an engineer discover a pattern.

A saved case helps the engineer keep the investigation coherent over time.

```text
Workbench signal
      ↓
Filtered executions
      ↓
Saved investigation case
      ↓
Evidence, notes, comparisons, and conclusion
```

---

## Why saved cases are useful

The current workbench can answer:

> Which executions used fallback in the last 24 hours?

It can then drill into one execution and create a comparison.

But the investigation itself currently exists only in:

- the engineer’s browser history;
- copied execution IDs;
- temporary URL filters;
- personal notes;
- memory.

A saved case gives the investigation a durable home.

For example:

```text
Title:
  Primary-provider rate limits on July 28

Question:
  Is retrying the primary route better than immediate fallback?

Evidence:
  14 rate-limited executions
  3 comparison experiments
  provider observation for fake-primary/deterministic-v1

Finding:
  Immediate fallback reduced p95 latency but changed successful outcomes to degraded.
```

---

## A case is not automatically an incident

A saved investigation case may represent:

- a production incident;
- an unusual execution;
- a suspected provider regression;
- a reproducibility study;
- a policy experiment;
- a routine reliability review;
- a question that ultimately proves harmless.

Calling the object an **investigation case** avoids pretending every saved question is an emergency.

---

## What belongs in a case?

A useful case contains several kinds of information.

### Identity

- case ID;
- tenant;
- title;
- status;
- created and updated times.

### Question

A short statement of what the engineer is trying to understand.

Example:

> Why did fallback dependence rise during the selected period?

### Scope

The original investigation filters and time range:

- from and to;
- providers;
- models;
- statuses;
- normalized failures;
- derived signals;
- trace or execution search.

The saved scope is a snapshot of the question, not a permanently live query unless explicitly refreshed.

### Evidence links

References to existing evidence:

- executions;
- comparison experiments;
- provider/model observations;
- saved workbench URLs or filter snapshots.

The case should reference evidence, not duplicate full execution envelopes.

### Notes

Append-only observations written during the investigation.

Examples:

- “All seven failures used the same model route.”
- “Comparison showed immediate fallback was faster.”
- “Sample size is too small for a provider-wide conclusion.”

### Findings

A concise current interpretation supported by the linked evidence.

A finding may change as evidence changes.

### Resolution

The decision or conclusion reached:

- no action;
- policy change recommended;
- provider escalation;
- continue monitoring;
- insufficient evidence;
- expected behavior;
- resolved by configuration change.

---

## What is the difference between a note and a finding?

A **note** is one observation recorded during the investigation.

> Execution E failed with `provider_unavailable`.

A **finding** is a broader interpretation supported by one or more observations.

> The selected window shows a temporary provider-unavailable cluster, but the sample is too small to call it a provider regression.

Notes are append-only history.

The current finding is editable because understanding evolves.

---

## What is an evidence link?

An evidence link is a typed reference to an existing Reliability Lab object.

Examples:

```text
execution: 01J...
comparison: cmp_01J...
provider observation:
  provider=fake-primary
  model=deterministic-v1
  from=...
  to=...
```

The case does not copy prompts, outputs, replay capsules, or command payloads.

When an engineer opens an evidence link, the normal tenant and security boundaries still apply.

---

## Why not copy all evidence into the case?

Copying full evidence creates stale duplicates.

Suppose an execution is still running when linked.

If the case stored a copied envelope, it could remain stuck at:

```text
status: running
```

even after the real execution completed.

Instead, the case stores the reference and loads current evidence when needed.

The saved filter snapshot remains historical context, while linked executions remain authoritative.

---

## What does “save current investigation” mean?

From the workbench, the engineer can save the current:

- time range;
- filters;
- investigation question;
- selected executions or comparisons.

The saved case should preserve the exact resolved UTC range.

It should not silently reinterpret “last 24 hours” every time the case is opened.

Example:

```text
Clicked at:
  July 28, 3:00 PM

Saved range:
  July 27, 3:00 PM through July 28, 3:00 PM
```

Opening the case tomorrow still shows that original range.

The engineer may explicitly refresh or create a new related query later.

---

## Suggested case statuses

A small status model is enough:

```text
open
investigating
resolved
archived
```

Possible meanings:

- **open:** created but not actively worked;
- **investigating:** active analysis;
- **resolved:** a supported conclusion or action was recorded;
- **archived:** retained for history but no longer active.

Avoid building a general ticketing system.

---

## Should cases have severity?

Severity is optional and easy to misuse.

A first slice may support a restrained classification such as:

```text
routine
notable
urgent
```

But it should not fabricate production-incident severity rules.

A case may be technically interesting without being operationally urgent.

If severity is included, it should be user-selected and clearly separate from evidence-derived signals.

---

## What about authors and ownership?

The current project has tenant routing but no authenticated users.

Therefore it cannot honestly claim:

- who wrote a note;
- who owns a case;
- who changed a finding;
- who resolved it.

The first slice should record timestamps and leave actor fields absent or explicitly unavailable.

Do not invent users from headers or environment variables.

Authenticated actors belong to the later tenant-security horizon.

---

## How should edits be audited?

A useful first model is:

- case title, question, status, and finding are current state;
- notes are append-only;
- evidence additions and removals create lifecycle events;
- status changes create lifecycle events.

This gives the case a readable timeline without turning every keystroke into event sourcing.

---

## What is a case timeline?

A case timeline explains how the investigation developed:

```text
Case created
Execution E linked
Comparison C linked
Note added
Status changed to investigating
Finding updated
Status changed to resolved
```

Timeline entries contain metadata only.

They must not contain prompt text, replay material, encryption keys, or provider credentials.

---

## How does this relate to Comparative Replay?

Comparative Replay answers one controlled question:

> What changed when these conditions changed?

A saved case may contain several comparisons.

Example:

```text
Case:
  Rate-limit recovery strategy

Comparison 1:
  retry twice vs immediate fallback

Comparison 2:
  retry once vs immediate fallback

Comparison 3:
  same-conditions reproducibility check
```

The case gathers those experiments into one supported conclusion.

---

## How does this relate to the Investigation Workbench?

The workbench discovers and filters evidence.

The case preserves the investigation.

```text
Workbench:
  Find the pattern

Case:
  Preserve the question and evidence

Execution detail:
  Explain one run

Comparative Replay:
  Test one variation
```

Each surface has a distinct job.

---

## What should the first saved-case slice prove?

An engineer should be able to:

1. save the current workbench scope as a case;
2. give it a title and question;
3. link executions and comparisons;
4. add append-only notes;
5. update the current finding;
6. change case status;
7. open linked evidence;
8. return to the saved workbench scope;
9. list and filter saved cases;
10. review bounded current summaries for every evidence link;
11. see explicit unavailable states and fixed conclusion-readiness checks;
12. resolve only after recording both finding and resolution;
13. download a deterministic internal Markdown review packet;
14. do all of this without copying sensitive execution content.

---

## What remains later?

The first slice does not need:

- authenticated authors;
- assignments;
- comments between users;
- notifications;
- approval workflows;
- Jira or ServiceNow synchronization;
- alert creation;
- automatic case generation;
- LLM-written summaries;
- semantic incident classification;
- attachments;
- arbitrary external links;
- general project management.

Those features can wait until there is a demonstrated workflow.

---

## Working vocabulary

| Term               | Plain meaning                                                        |
| ------------------ | -------------------------------------------------------------------- |
| Investigation case | A durable home for one reliability question                          |
| Saved scope        | Exact workbench range and filters captured when the case was created |
| Evidence link      | Typed reference to an execution, comparison, or provider observation |
| Note               | Append-only observation made during investigation                    |
| Finding            | Current interpretation supported by evidence                         |
| Resolution         | Final or current decision based on the investigation                 |
| Evidence review    | Bounded current summary derived from each authoritative link         |
| Readiness          | Five fixed workflow-completeness checks, not a correctness score     |
| Review packet      | Safe internal Markdown projection with trace links and limitations   |
| Case timeline      | Metadata history of important case changes                           |
| Actor unavailable  | Honest statement that authentication does not yet identify people    |

---

## Final mental model

The Investigation Workbench is the detective’s evidence board.

A saved investigation case is the case file:

```text
Evidence board:
  What pattern is visible right now?

Case file:
  What question were we asking?
  Which evidence did we preserve?
  What did we conclude?
```

The case file should make the investigation durable without becoming another enterprise ticket system with seventeen required dropdowns.

---

## What is implemented now

The first bounded slice is available at `/investigation-cases` and from the
`/investigations` workbench.

It implements:

- exact resolved UTC ranges rather than moving presets;
- canonical filters without cursor, page size, or presentation anchors;
- bounded tenant-scoped case list search and stable cursor pagination;
- title, question, status, optional importance, current finding, and resolution;
- coherent resolved timestamps and archive instead of hard deletion;
- typed execution, comparison, and provider-observation references;
- same-tenant validation and idempotent duplicate evidence links;
- append-only notes;
- metadata-only lifecycle timeline events;
- links back to the exact saved workbench scope and current evidence pages;
- derived bounded execution, comparison, and provider-observation summaries;
- explicit unavailable state for every link that cannot currently be summarized;
- five fixed conclusion-readiness checks without a score;
- a resolved-state invariant requiring non-empty finding and resolution;
- a tenant-scoped deterministic Markdown review packet with exclusions and internal trace links;
- memory and PostgreSQL persistence;
- no actor fields.

Case storage deliberately does not copy full envelopes, prompt/messages, outputs, attempts, events,
replay capsules, encrypted commands, ciphertext, provider bodies, credentials, arbitrary logs, or
external URLs. Removing an evidence association does not remove the authoritative execution or
comparison.

The tenant header is still not authentication. A timestamp says when an operation occurred, but the
system cannot truthfully say who performed it. See
[ADR 0009](adr/0009-saved-investigation-cases-and-evidence-references.md) for the persistence and
reference decision, [ADR 0010](adr/0010-derived-case-evidence-review-and-safe-review-packets.md) for
the derived-review decision, and
[Evidence-Backed Case Conclusions Basics](reliability-lab-evidence-backed-case-conclusions-basics.md)
for the review/readiness/packet model.
