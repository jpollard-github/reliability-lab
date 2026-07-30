# ADR 0010: Derived case evidence review and safe review packets

- Status: accepted
- Date: 2026-07-29

## Context

Saved cases retained an exact question, scope, prose, notes, and typed links, but the links exposed
only identifiers and routes. An operator had to reconstruct support manually, could mark a case
resolved without a finding or resolution, and could not hand off one bounded review artifact.
Copying source evidence into case rows would create stale data and another sensitive retention
surface. Generating conclusions or confidence scores would overstate what normalized reliability
evidence proves.

## Decision

Add `InvestigationCaseReviewService` as a framework-independent derived read orchestrator separate
from `InvestigationCaseService`. It reads the current case and resolves persisted links through the
existing execution, comparison, investigation, and replay ports. It performs no HTTP call and adds
no table. It processes links in fixed-size concurrent batches and returns items in persisted order.
New cases may link at most 50 evidence references.

Define portable TypeBox review contracts with typed available/unavailable items. Execution items
reuse `projectExecutionSummary` and expose current replay capability separately. Comparison items
reuse `projectComparison`, requested variation, resolved safe configuration, and changed/inherited
condition labels. Provider items rerun `observeProviders` for the exact saved provider, model, and
range. Missing or unreadable sources remain explicit; tenant-scoped not-found behavior does not
reveal cross-tenant existence.

Define conclusion readiness as five fixed boolean checks for exact scope, linked evidence, explicit
review state, finding, and resolution. It has no numeric score. Require non-empty finding and
resolution whenever an update would leave the case `resolved`. Preserve historical inconsistent
rows on read.

Render Markdown in core from `InvestigationCaseReview`. Escape bounded prose and internal link
destinations, sanitize the filename, include limitations and source routes, and exclude raw
execution/replay/note content. Expose case-scoped JSON and Markdown API reads. The web page uses the
JSON projection for server-rendered review/readiness and a tenant-header-bearing browser request for
the packet.

Do not add an AI conclusion, semantic judge, confidence measure, weighted evidence score, provider
ranking, automatic resolution, authorship, approval, attachment, or external URL.

## Consequences

- Current authoritative evidence can change after linking; the review intentionally shows current
  state while saved scope remains historical context.
- An unavailable reference remains visible and does not silently shrink the record.
- Ready means record completeness only. Human interpretation remains required.
- Packet structure, API JSON, and UI evidence share one projection and cannot independently redefine
  retry, fallback, comparison, or provider-observation semantics.
- The packet is bounded operational data, not public-safe. Prototype tenant routing remains weaker
  than authentication, authorization, and row-level security.
- No migration or copied evidence persistence is introduced.
