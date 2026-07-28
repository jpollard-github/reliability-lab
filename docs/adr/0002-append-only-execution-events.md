# ADR 0002: append-only execution events

Status: accepted, 2026-07-27.

Record each execution decision as a versioned append-only event. Maintain a separate current-state
execution row for efficient queries.

Execution and investigation-case explanation requires the order and original context of retries,
fallbacks, validation, and budget decisions. Updating a single status document destroys that
evidence. Append-only events also support future projection rebuilding and audit review.

This increases storage and creates projection consistency work. Production writes should transact
the event and projection update and publish through an outbox. Corrections are new events, never
rewrites of historical events.
