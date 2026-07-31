# ADR 0013: Keep generic Chat Completions separate from a future OpenAI Responses adapter

- Status: accepted
- Date: 2026-07-30

## Context

Reliability Lab already has a narrow generic `OpenAICompatibleHttpProvider` used for providers that
implement the Chat Completions wire shape. The bounded live-provider proof needs to exercise that
adapter without silently narrowing the product claim to OpenAI alone.

OpenAI's current guidance says the Responses API is recommended for new projects while Chat
Completions remains supported. Responses differs in endpoint, typed output Items, structured-output
shape, state handling, and streaming semantics. It also stores responses by default unless storage
is disabled. See the
[official Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses).

## Decision

Keep `OpenAICompatibleHttpProvider` on `/chat/completions` as the explicitly named generic
cross-provider adapter. Send `store: false`, retain its focused JSON Schema support, and test its
wire contract and normalization boundaries directly.

Do not make a provider-name or base-URL conditional switch to `/responses`. If the product elects
an OpenAI-specific path, add a separately named Responses adapter and transport family with its own
request/output parsing, structured-output, statefulness, retention, failure, size, and live-proof
tests.

## Consequences

- The current proof preserves compatibility with existing Chat Completions implementations.
- The capability projection truthfully identifies
  `openai_compatible_chat_completions`.
- OpenAI-specific future work has an explicit migration boundary instead of hidden transport
  behavior.
- The current adapter does not gain Responses-only tools, Items, conversation state, or streaming.
- Chat Completions support does not imply it is the preferred starting point for a new
  OpenAI-specific integration.
