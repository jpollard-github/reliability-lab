# Failure model

Provider adapters normalize external behavior into:

- `timeout`: abort or provider timeout; retryable
- `rate_limit`: HTTP 429 or equivalent; retryable
- `authentication`: rejected credentials; non-retryable
- `invalid_request`: caller/provider contract error; non-retryable
- `provider_unavailable`: upstream 5xx or explicit fake failure; retryable
- `malformed_response`: unsupported payload or schema rejection; non-retryable in this slice
- `budget_exceeded`: local latency policy stopped further work; non-retryable
- `unknown`: safely redacted boundary failure; adapter decides retryability

Retry is allowed only for normalized retryable failures and only while the maximum attempt count and
latency budget permit it. Delay is `min(maxBackoff, baseBackoff × 2^(attempt-1))` with bounded
proportional jitter. Clock and randomness are injected; tests advance fake time.

Fallback occurs after primary attempts are exhausted when both fallback provider and model policy
are resolvable. A successful fallback is `degraded`, not `succeeded`, because the requested route did
not complete normally. The fallback gets one attempt in this slice and does not inherit forced
primary failure injection.

The timeout passed to a provider is the remaining execution latency budget, enforced with an abort
signal. Providers must observe the signal. The fake provider avoids real sleeps; latency and timeout
are normalized immediately so unit tests remain deterministic.

Failure injection is rejected by the API unless `ENABLE_FAILURE_INJECTION=true`. Supported fake
modes are latency, timeout, rate limit, malformed JSON, and provider error. These controls must never
be enabled as an unauthenticated production capability.
