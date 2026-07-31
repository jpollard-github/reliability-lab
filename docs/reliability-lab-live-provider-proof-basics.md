# Reliability Lab Live Provider Proof basics

## Status

This is a bounded post-Horizon-5 provider proof. It does not reopen Horizon 5, begin Horizon 6, or
claim provider health, production readiness, answer quality, authenticated tenancy, or exactly-once
external effects.

## Four different operator concepts

- A **deterministic scenario** is a repeatable fake-provider lab instrument. It can inject known
  failures and makes no external provider request.
- **Timeline playback** presents recorded execution evidence only. It makes no provider call,
  creates no execution, mutates no evidence, and does not use replay retention.
- **Replay** creates a new linked execution from retained input. It makes a new provider call and
  records new evidence.
- A **live execution** is an ordinary execution through a configured external provider. It may incur
  cost and cannot use deterministic failure injection.

The execution detail, events, Timeline playback, replay, comparison, Workbench, saved case,
case-driven experiment, evidence review, and review packet continue to consume the same ordinary
execution envelope and append-only evidence.

## Provider capability evidence

`GET /v1/providers` requires the prototype tenant-routing header and returns a bounded,
server-derived projection:

- provider ID;
- deterministic or live kind;
- safe model label;
- transport family;
- whether configuration is complete;
- whether failure injection is supported;
- whether the provider is eligible for the operator path; and
- a fixed safe unavailable reason when it is not eligible.

The route performs no provider request. Configuration is not health. It excludes the API key, base
URL, query strings, headers, raw environment configuration, and provider response data.

`buildProviderRuntime` in `packages/providers/src/provider-runtime.ts` is the single API/worker
construction owner. This prevents the two processes from silently selecting different adapters or
models.

Root development commands first register `scripts/register-local-environment.mjs` through Node's
supported `--import` option. Its loader reads only repository-root `.env.local` and `.env`; exported
process variables win, `.env.local` wins over `.env`, and `.env.example` is never loaded. The same
inherited environment reaches Next.js, API, and worker processes. An explicit production
`NODE_ENV` bypasses local-file loading, and direct package production entrypoints continue to
prefer injected deployment variables.

## Live execution bounds

The home page always renders **Deterministic lab scenarios**. It renders **Live provider execution**
only when the capability projection reports an eligible configured live provider.

The live form:

- identifies the server-configured provider and safe model label;
- warns that an external request may incur cost;
- requires explicit submission;
- limits browser input to 2,000 characters;
- uses one attempt, no fallback, no failure injection, and a 20-second latency budget; and
- tells the operator that request input is not retained for replay by default.

The browser sends no endpoint, credential, provider configuration object, or selectable live model.
Server enforcement remains authoritative: live requests must match the configured provider/model,
cannot include `failureMode`, accept exactly one bounded input shape, cap message count and total
content, cap structured-schema size, cap retry/backoff policy, and cap latency/cost budget values.
The adapter independently refuses model mismatch or failure injection before `fetch`.

## Retention and replay

Live request-body retention remains default-deny. With
`ALLOW_LIVE_PROMPT_RETENTION=false`, a successful live execution records normalized evidence but its
replay capability is `retention_disabled`. Timeline playback still works because it reads recorded
events and needs no replay capsule.

Replay is separate. Enabling it requires the existing explicit live-retention flag plus the durable
PostgreSQL encrypted Replay Vault prerequisites. Replay then creates another ordinary execution and
another provider call. The live proof commands do not enable replay.

## Transport decision

The generic `OpenAICompatibleHttpProvider` deliberately remains a Chat Completions adapter for the
current cross-provider compatibility claim. It sends `store: false`, supports the existing focused
JSON Schema response format, and normalizes the supported response shape.

Current OpenAI guidance recommends the Responses API for new OpenAI-specific projects while keeping
Chat Completions supported. A future OpenAI-specific Responses adapter should therefore be elected
as a separate transport with its own request, output-item, structured-output, statefulness, and
compatibility tests—not hidden inside the generic adapter. See
[ADR 0013](adr/0013-generic-chat-completions-and-future-openai-responses-adapter.md) and the
[official migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses).

## Failure and response boundaries

The adapter:

- never returns a raw provider error body;
- normalizes 400, 401/403, 429, and 5xx responses;
- normalizes network, caller-abort, and timeout failures;
- treats invalid JSON or unsupported success payloads as malformed responses;
- caps declared and actual response bodies at 1,000,000 bytes; and
- reports normalized usage without logging the credential, endpoint, input, or provider body.

## Proof commands

`pnpm verify:local-provider-wire` is automatic and network-local. After a build, it starts a
loopback wire-compatible provider, starts the built API in memory mode, reads `/v1/providers`,
submits one ordinary execution, and proves exactly one mock provider request plus default-deny replay
retention.

`pnpm verify:live-provider` is external and guarded. Without
`RUN_LIVE_PROVIDER_VERIFY=true`, it exits successfully with an explicit **not run; no request was
made** message. If execution is explicitly requested but URL, key, or model configuration is
missing, it makes no request, names only the missing setting names, and exits nonzero.

When enabled, it starts the built API, submits one small uniquely identified non-sensitive
execution with one attempt and a bounded timeout, and succeeds only when the normalized execution
status is exactly `succeeded`. Failed, rejected, timed-out, cancelled, degraded, unknown, malformed,
or wait-timeout results exit nonzero and are never described as passed. Success output is limited to
provider ID, configured model, normalized status, bounded total/provider latency and token counts
when available, and the known external request count. It never prints the key, endpoint, input,
output, authorization, cookie, or provider body. Replay is not part of this command, and one success
proves only one connectivity/execution path.

For a concise local setup:

```bash
cp .env.example .env
# Add the real OPENAI_API_KEY only to this ignored file, then restart pnpm dev.
```

The template uses `https://api.openai.com/v1` and `gpt-4.1-mini` as editable operator examples.
After restart, `/v1/providers` should mark the live provider configured and operator eligible while
excluding both the API key and base URL. Shell exports remain available for ephemeral configuration
and override local file values.

Normal unit, integration, build, and Playwright workflows never make a paid external request.
Playwright uses a loopback mock provider only.

## Remaining limits

The capability route proves configuration shape, not reachability, authorization success, service
health, model quality, price, or quota. One successful live execution proves only that one ordinary
request completed under the recorded conditions. It does not establish an SLA, universal provider
health, exactly-once effects, production secret management, or safe production tenancy.
