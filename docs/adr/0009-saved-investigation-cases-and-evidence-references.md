# ADR 0009: Saved investigation cases and typed evidence references

- Status: accepted
- Date: 2026-07-28

## Context

The Investigation Workbench can resolve a bounded reliability signal to exact executions, provider
observations, and Comparative Replay experiments. Before this decision, the investigation question,
URL scope, selected evidence IDs, notes, and conclusion existed only in browser history or private
operator notes. Copying full execution envelopes into a case would create stale evidence and another
retention surface for prompts, outputs, attempts, events, replay material, or command data.

The prototype routes by tenant but has no authenticated person. It cannot truthfully attribute a
note, finding, status transition, or resolution to an author.

## Decision

Add a versioned `InvestigationCase` current record with bounded plain-text title/question,
open/investigating/resolved/archived status, optional user-selected importance, exact canonical
saved scope, current finding/resolution, and coherent resolved timestamp.

The saved scope contains a half-open exact `from`/`to` range and only semantic workbench filters.
Moving presets are resolved before persistence. Arrays are trimmed, deduplicated, and sorted.
Cursor, page limit, presentation anchors, and `window=24h`-style presets are excluded. A pure domain
function reconstructs the saved workbench URL.

Store three typed evidence associations:

- execution ID, validated under the same tenant;
- comparison experiment ID, validated under the same tenant;
- provider/model/exact-range observation reference.

Evidence additions are idempotent by canonical identity. Removal deletes only the association and
adds a timeline event; it does not delete the execution or comparison. Existing APIs remain
authoritative when evidence is opened. No arbitrary external URL is accepted.

Store notes as append-only rows with no update/delete endpoint. Store current case interpretation in
the case row. Add metadata-only timeline events for creation, current-field updates, status,
finding/resolution presence, note IDs, and evidence lifecycle. Do not duplicate note, finding, or
resolution text in timeline metadata. This is not event sourcing for the whole aggregate.

Use a small framework-independent service and repository port with memory and PostgreSQL adapters.
PostgreSQL uses separate case, note, evidence, and event tables with explicit tenant columns.
Current-state mutations and their timeline events are transactional. Case listing is ordered by
`updatedAt DESC, caseId DESC`, uses a two-field opaque cursor, and obtains total from a separate
fixed count query so empty terminal pages remain truthful.

Archive is the retention action for this slice; there is no hard-delete case endpoint.

## Security and identity

Cases may contain bounded operational prose in plaintext. They must not contain copied prompts,
messages, outputs, attempts, events, replay capsules, encrypted commands, ciphertext, credentials,
raw provider bodies, HTML, arbitrary logs, attachments, or external URLs. Logs and traces identify
case IDs and operation types, not question, finding, resolution, or note bodies.

No author, owner, assignee, or resolver field exists. `X-Tenant-Id`, environment values, and browser
state are not people. Authenticated authorship, role-based access, and PostgreSQL row-level security
remain future tenant-safety work.

## Consequences

- An operator can save and reopen one exact reliability question, link current evidence, record
  append-only observations, and preserve a supported current conclusion.
- Saved scope is historical context while linked execution/comparison evidence remains current.
- Replay expiry/deletion does not remove an execution association.
- Case tables introduce an intentional plaintext operational-prose retention surface that requires
  tenant controls and documented retention policy before production.
- This slice does not add assignment, comments, notifications, approval workflows, automatic case
  creation, Jira/ServiceNow integration, arbitrary attachments, full-text search, alerting, or a
  generic project-management domain.
