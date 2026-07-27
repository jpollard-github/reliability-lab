# ADR 0003: capability-based replay with live retention off

Status: accepted, 2026-07-27.

Default live-provider request retention to off. Treat replay as a capability proven by an available
capsule, not an assumption derived from execution metadata.

Prompts can contain secrets, personal data, proprietary context, or regulated content. Retaining
them merely because replay is useful creates disproportionate risk. Fake fixtures are safe enough
for local deterministic replay; live replay requires explicit policy and a durable encrypted store.

Some live incidents will be non-replayable. The API returns that state and reason rather than
fabricating a replay. Operators still retain normalized attempts, policy decisions, timing, hashes,
and errors for diagnosis.
