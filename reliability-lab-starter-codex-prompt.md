# Reliability Lab: Starter Repository Build Prompt for Codex

You are working inside a local folder named `reliability-lab`.

Current state:

- The folder exists locally.
- Git has not been initialized.
- There is no remote repository.
- Assume the folder is otherwise empty, but inspect it before writing and preserve any existing user-created files.

Build the initial repository skeleton and a small, working vertical slice for **Reliability Lab**, an API reliability and incident-replay platform for LLM systems.

Do not stop for routine confirmations. Make reasonable engineering decisions, implement them, run the available checks, and report any genuine blockers. Do not create or configure a remote repository. Do not commit unless explicitly asked later.

## Product intent

Reliability Lab is a serious prototype that sits between an application and one or more OpenAI-compatible LLM providers. It should make requests observable, policy-driven, testable, and replayable.

The long-term product surface includes:

- typed API contracts
- request tracing
- idempotency
- retries with bounded exponential backoff and jitter
- timeout and circuit-breaker behavior
- rate limiting
- model or provider fallback
- structured-output validation
- immutable audit events
- tenant isolation
- cost and latency budgets
- deterministic replay
- failure injection
- an operator dashboard that explains why each request succeeded, degraded, or failed

The differentiating idea is **replayable production incidents**. An execution envelope should preserve enough safe metadata and, when retention policy permits, enough canonical request data to reproduce and compare an execution later.

This first pass is not the finished control plane. It must establish a credible architecture and deliver one honest, runnable vertical slice.

## Non-negotiable engineering principles

1. Prefer a working, testable slice over decorative scaffolding.
2. Do not claim features that are not implemented.
3. Keep provider behavior behind interfaces and dependency injection.
4. Make time, randomness, identifiers, and provider responses injectable where determinism matters.
5. Do not log secrets, API keys, full authorization headers, or unredacted prompts.
6. Use strict TypeScript. Avoid `any`; when unavoidable at an external boundary, isolate it and explain it.
7. API schemas are product surfaces. Validate requests and responses and publish OpenAPI output.
8. Domain logic must not depend directly on Fastify, Next.js, Postgres, Redis, or a specific LLM SDK.
9. Store execution events as append-only records. Do not rewrite history to make a later state look cleaner.
10. Do not create a `TODO.md`, backlog file, or mutable project plan. Record durable decisions in ADRs and current behavior in the README and architecture docs.
11. Never run dependency-audit auto-fix commands. Specifically prohibited:
    - `npm audit fix`
    - `npm audit fix --force`
    - `pnpm audit --fix`
    - any audit command with `--force`
    - automated dependency upgrades presented as security remediation without human review
12. Do not use destructive Git commands, force pushes, resets, or broad file deletion.

## Chosen stack

Use a pnpm TypeScript monorepo with the following foundation:

- Node.js: use a currently supported LTS version available locally; record it in `.nvmrc` and `engines`
- Package manager: pnpm, pinned with the root `packageManager` field
- API: Fastify
- API schemas: TypeBox plus Fastify type-provider integration, with JSON Schema and Ajv validation
- API documentation: `@fastify/swagger` and `@fastify/swagger-ui`
- Web dashboard: Next.js App Router with React and TypeScript
- Database: PostgreSQL
- Database access and migrations: Drizzle ORM and Drizzle Kit
- Redis client: the official `redis` package
- Logging: Pino structured logs
- Telemetry: OpenTelemetry APIs and SDK, with a console exporter by default in local development and optional OTLP configuration
- Tests: Vitest for unit and integration tests; Fastify injection for API tests; Playwright for one minimal dashboard smoke test
- Linting: ESLint flat configuration
- Formatting: Prettier with a check command
- Dependency and dead-code auditing: `pnpm audit` in read-only mode and Knip
- Local infrastructure: Docker Compose for PostgreSQL and Redis

Use current stable, mutually compatible package versions at execution time. Pin installed versions in the lockfile. Do not add a framework or library solely to make the dependency list look impressive.

## Repository layout

Create a structure close to the following. Adjust only when a clear technical reason exists and document that reason.

```text
reliability-lab/
  AGENTS.md
  README.md
  LICENSE
  package.json
  pnpm-lock.yaml
  pnpm-workspace.yaml
  tsconfig.base.json
  eslint.config.mjs
  prettier.config.mjs
  .prettierignore
  .editorconfig
  .gitignore
  .env.example
  .nvmrc
  compose.yaml

  apps/
    api/
      src/
      test/
      package.json
      tsconfig.json
    web/
      app/
      components/
      lib/
      tests/
      package.json
      tsconfig.json

  packages/
    contracts/
      src/
      package.json
      tsconfig.json
    core/
      src/
      test/
      package.json
      tsconfig.json
    db/
      src/
      migrations/
      package.json
      tsconfig.json
      drizzle.config.ts
    providers/
      src/
      test/
      package.json
      tsconfig.json
    observability/
      src/
      package.json
      tsconfig.json
    testkit/
      src/
      package.json
      tsconfig.json

  docs/
    architecture.md
    execution-envelope.md
    failure-model.md
    security-and-retention.md
    adr/
      0001-monorepo-and-stack.md
      0002-append-only-execution-events.md
      0003-replay-data-retention.md

  scripts/
    export-repo.mjs
    export-working-files.mjs

  .agents/
    skills/
      export-repo/
        SKILL.md
      export-working-files/
        SKILL.md

  .working-files.export.json
```

Use the MIT license unless an existing file says otherwise.

## Root workspace and commands

Create coherent root scripts. At minimum support:

```text
pnpm dev                 # API and dashboard development processes
pnpm dev:infra           # PostgreSQL and Redis via Docker Compose
pnpm dev:api
pnpm dev:web
pnpm build
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm verify              # format check, lint, typecheck, unit tests, and build
pnpm verify:full         # verify plus integration and e2e when infrastructure is available
pnpm audit:deps          # read-only production dependency audit
pnpm audit:unused        # Knip
pnpm audit               # both audit commands, with no mutation
pnpm db:generate
pnpm db:migrate
pnpm db:studio
pnpm export:repo
pnpm export:working
```

Do not make network-dependent audit commands part of the normal build. Audit failures must be reported, not automatically repaired.

## AGENTS.md requirements

Create a concise but strong root `AGENTS.md` that Codex will actually be able to follow. It must include:

### Repository purpose and boundaries

- This is a reliability platform prototype, not a generic chatbot.
- Protect the separation between domain logic, provider adapters, transport, persistence, and UI.
- Do not invent features in documentation or status reports.

### Toolchain

- pnpm only; do not use npm or Yarn to modify the workspace.
- List exact commands for install, development, lint, format checking, type checking, testing, building, migrations, and audits.
- Prefer targeted tests during development, then run the appropriate repository verification command before completion.

### Completion contract

For code changes, Codex must:

1. inspect relevant code and docs before editing
2. implement the smallest coherent change
3. add or update tests
4. run targeted checks
5. run `pnpm verify` when practical
6. run integration or e2e checks when the change crosses those boundaries and infrastructure is available
7. review the diff for regressions, leaked secrets, accidental generated files, and false documentation claims
8. report exactly which commands ran and whether they passed

Never state that a test, build, migration, audit, or runtime path passed unless it actually ran successfully.

### Audit policy

State prominently:

- Audit commands are observational only.
- Never run `npm audit fix`, `pnpm audit --fix`, any `--force` audit repair, or an automated major dependency upgrade.
- Summarize advisories and affected dependency paths for human decision.
- Do not suppress or downgrade an advisory merely to make the command green.

### Git policy

- Initialize a local repository on branch `main` if one does not exist.
- Do not create a remote.
- Do not commit, push, rebase, reset, force, or alter unrelated user work unless explicitly requested.
- Preserve a dirty worktree and keep edits scoped.

### Security and data handling

- Never commit `.env`, credentials, provider keys, replay encryption keys, raw production prompts, or local database volumes.
- Use `.env.example` with fake values and comments.
- Redact sensitive values from logs and persisted audit metadata.
- Follow default-deny retention for live provider request bodies.

### Skills

Document the two repository skills and when to use them:

- `$export-repo`: export the repository excluding Git-ignored content and secrets
- `$export-working-files`: export explicitly allowlisted, Git-ignored non-secret working artifacts

## Domain model

Define shared contracts and domain types for at least:

- `ExecutionId`
- `TenantId`
- `ExecutionStatus`: queued, running, succeeded, degraded, failed, cancelled
- `AttemptStatus`
- `ProviderRequest`
- `ProviderResponse`
- `ProviderError` with retryability and normalized category
- `ExecutionPolicy`
- `ExecutionBudget` for latency and optional cost limits
- `ExecutionEnvelope`
- `ExecutionAttempt`
- `ExecutionEvent`
- `ReplayRequest`
- `ReplayResult`
- `FailureMode`

Use a discriminated union for execution events. Include event types that can represent:

- execution accepted
- idempotency hit
- attempt started
- provider response received
- retry scheduled
- structured output rejected
- fallback selected
- budget exceeded
- circuit opened or request rejected
- execution succeeded
- execution failed
- replay started and replay completed

The event schema must be append-only and versioned so future schema evolution is possible.

## Provider abstraction

Create a provider interface that is independent of any official provider SDK. It should support:

- provider and model identity
- execution with an abort signal and timeout
- normalized usage and latency metadata
- normalized retryable and non-retryable failures
- structured-output validation result

Implement two adapters:

1. **Deterministic fake provider**
   - Default provider for local development and tests.
   - Deterministic from a seed, execution ID, or explicit fixture.
   - Supports forced failure modes without sleeping for long periods in unit tests.
   - Failure modes: latency, timeout, rate limit, malformed JSON, and provider error.

2. **OpenAI-compatible HTTP provider**
   - Disabled unless configured with environment variables.
   - Use a narrow HTTP adapter rather than coupling domain logic to an SDK.
   - Never log the API key or full prompt body.
   - It is acceptable for this first pass to support a focused subset needed for one text or structured-output request.

## Initial working vertical slice

Implement enough behavior that the repository demonstrates real engineering rather than empty folders.

### API endpoints

Create:

- `GET /healthz`
- `GET /readyz`, checking required infrastructure dependencies
- `GET /openapi.json`
- Swagger UI under a documented local path
- `POST /v1/executions`
- `GET /v1/executions`
- `GET /v1/executions/:executionId`
- `POST /v1/executions/:executionId/replay`

### Request conventions

For `POST /v1/executions`:

- Require `X-Tenant-Id`.
- Accept `Idempotency-Key` and prove repeated requests do not create duplicate executions.
- Accept a provider/model choice, messages or input, optional JSON Schema for structured output, policy options, and an optional local-development failure mode.
- Reject development failure injection unless the environment explicitly enables it.
- Return an execution identifier, status, trace identifier, and links or paths for inspection.

### Policy behavior

Implement a small but genuine policy engine with tests proving:

- a successful primary-provider execution
- a retryable failure followed by success
- primary-provider failure followed by fallback-provider success, producing `degraded` status
- a malformed structured response rejected by JSON Schema validation
- idempotent duplicate submission
- a latency budget rejection or timeout

Use bounded exponential backoff with jitter. Inject clock and randomness so unit tests remain fast and deterministic.

A production-grade distributed circuit breaker and global rate limiter do not need to be fully completed in this first pass. However:

- define clean interfaces for them
- provide an in-memory implementation suitable for deterministic tests
- provide Redis-backed adapter skeletons with honest documentation if they are not yet wired into the request path
- do not label a skeleton as production-ready

### Persistence

Create migrations and repositories for at least:

- `executions`
- `execution_attempts`
- `execution_events`
- `idempotency_records`

Use PostgreSQL JSONB where appropriate without turning every field into an untyped blob. Preserve common query fields as typed columns.

Store:

- tenant ID
- provider and model selections
- timestamps and duration
- normalized outcome
- trace ID
- request hash
- policy decisions
- attempt metadata
- normalized usage
- validation outcome
- redacted error metadata

### Replay and retention

Make replay honest and policy-aware.

- Fake-provider executions may retain the canonical fixture data needed for deterministic replay.
- Live-provider prompt retention must default to disabled.
- If live replay data is unavailable, the replay endpoint must return a typed, explainable non-replayable result rather than pretending.
- Define a `ReplayCapsuleStore` interface for future encrypted or external storage.
- Document how AES-256-GCM field-level encryption or a managed encrypted blob store could be introduced, but do not implement faux encryption.
- A replay must create a new execution linked to the original and record replay events.

### Observability

- Create an OpenTelemetry trace for each execution.
- Create spans around policy evaluation, provider attempts, validation, persistence, and replay.
- Include trace IDs in API responses, persisted execution records, and structured logs.
- Configure Pino redaction for authorization headers, API keys, cookies, and known sensitive fields.
- Do not put full prompt text in span attributes.

### Dashboard

Build a simple, credible operator dashboard rather than a marketing landing page.

At minimum:

- execution list with status, tenant, provider/model, attempts, duration, and timestamp
- execution detail page
- chronological event timeline
- attempt summaries and normalized errors
- visible indication of succeeded, degraded, failed, replayed, and non-replayable states
- a replay control for replayable fake-provider executions
- a small development-only form that can submit an execution and select one forced failure mode

Keep the visual design restrained and operational. Accessibility and clear information hierarchy matter more than animation.

## Local development behavior

Create `compose.yaml` with PostgreSQL and Redis services, health checks, named volumes, and non-secret local defaults.

Create `.env.example` documenting variables such as:

- `NODE_ENV`
- `API_PORT`
- `WEB_PORT`
- `DATABASE_URL`
- `REDIS_URL`
- `LOG_LEVEL`
- `OTEL_SERVICE_NAME`
- `OTEL_EXPORTER_OTLP_ENDPOINT`
- `OPENAI_COMPATIBLE_BASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ENABLE_FAILURE_INJECTION`
- `ALLOW_LIVE_PROMPT_RETENTION`

Do not create a real `.env` containing credentials. A local `.env` with only generated non-secret development values may be created only if required to make the demo run, and it must remain Git-ignored.

Seed a local demo tenant, such as `demo-tenant`, in a transparent development-only way.

## README.md requirements

Write a strong `README.md` for engineers and reviewers. It must be accurate at the end of this build.

Include:

1. One-paragraph project pitch
2. Why replayable incidents matter
3. Honest current status, clearly distinguishing implemented behavior from planned platform capabilities
4. Architecture diagram using Mermaid
5. Execution lifecycle
6. Repository layout
7. Quick start
8. Example `curl` requests for success, retry, fallback, malformed structured output, and replay
9. Dashboard and Swagger URLs
10. Command reference
11. Testing strategy
12. Observability behavior
13. Security and data-retention posture
14. Design tradeoffs
15. Production-hardening roadmap organized by capability areas, not as a mutable task checklist
16. Export skills and how to invoke them
17. Known limitations

Do not include badges for CI, coverage, deployment, or security scans unless they genuinely exist.

## Architecture documents and ADRs

Write concise, substantive documents:

- `docs/architecture.md`: components, data flow, trust boundaries, scaling direction, and clear separation of current implementation versus future design
- `docs/execution-envelope.md`: versioned envelope and event schemas, request hashing, attempts, links between original and replayed executions
- `docs/failure-model.md`: normalized failure categories, retry rules, fallback rules, timeout semantics, and deterministic failure injection
- `docs/security-and-retention.md`: tenant boundary, redaction, prompt retention defaults, secrets, replay risks, and production hardening
- ADR 0001: why pnpm monorepo, Fastify, Next.js, Postgres, Redis, and OpenTelemetry
- ADR 0002: why execution events are append-only
- ADR 0003: why live request retention defaults to off and replay is capability-based

## Repository export skill

Create `.agents/skills/export-repo/SKILL.md` using valid skill frontmatter:

```yaml
---
name: export-repo
description: Export the current repository as a compressed archive containing tracked and untracked non-ignored files, while excluding Git-ignored content, repository metadata, generated export archives, and likely secrets. Use when the user asks to package, archive, share, or export the repository.
---
```

The skill must instruct Codex to use `pnpm export:repo` rather than manually inventing archive commands.

Implement `scripts/export-repo.mjs` so it:

1. Requires execution from the repository root.
2. Uses Git as the source of truth with `git ls-files --cached --others --exclude-standard`.
3. Includes tracked files and untracked files that are not ignored.
4. Excludes `.git`, Git-ignored content, existing export archives, and the output file itself.
5. Fails closed if candidate files match likely secret patterns such as `.env`, private keys, credential files, or token dumps.
6. Rejects symlinks that resolve outside the repository.
7. Generates a compressed `.tar.gz` under `artifacts/exports/`.
8. Adds an `EXPORT-MANIFEST.json` to the archive containing:
   - export timestamp
   - repository name
   - Git commit when available
   - branch when available
   - dirty status
   - included file list
   - file sizes
   - SHA-256 hashes
9. Supports `--dry-run` to print the planned file list without creating an archive.
10. Prints the final archive path and size.

The generated export directory must be Git-ignored.

## Git-ignored working-files export skill

Create `.agents/skills/export-working-files/SKILL.md` using valid skill frontmatter:

```yaml
---
name: export-working-files
description: Export explicitly allowlisted Git-ignored non-secret working artifacts, such as local trace captures, sanitized fixtures, screenshots, or diagnostic bundles. Use only when the user asks to package important local working files that are intentionally excluded from the repository.
---
```

The skill must instruct Codex to:

1. Read `.working-files.export.json`.
2. Run `pnpm export:working -- --dry-run` first.
3. Refuse to export if the allowlist is empty, paths escape the repository, or files appear secret.
4. Run `pnpm export:working` only after a clean dry run.
5. Report the archive path and manifest summary.

Implement `.working-files.export.json` as a tracked configuration file with an empty default allowlist and documented examples. Use a shape similar to:

```json
{
  "include": [],
  "exclude": ["**/*.key", "**/*.pem", "**/.env*", "**/*credential*", "**/*secret*"],
  "maxTotalBytes": 262144000
}
```

Implement `scripts/export-working-files.mjs` so it:

- exports only explicitly allowlisted files or globs
- permits Git-ignored files but never silently exports all ignored files
- rejects files outside the repo, unsafe symlinks, secrets, environment files, keys, credentials, local browser profiles, and database credential stores
- includes SHA-256 hashes and source paths in `WORKING-FILES-MANIFEST.json`
- creates a `.tar.gz` under `artifacts/exports/`
- supports `--dry-run`
- exits cleanly with an explanatory message when the allowlist is empty

Examples of potentially exportable working artifacts after explicit configuration:

- sanitized OpenTelemetry JSON traces
- fake-provider incident fixtures
- Playwright screenshots
- redacted log bundles
- benchmark results

Examples that must never be exported by this skill:

- `.env` files
- API keys or tokens
- private keys or certificates
- raw production prompts or user data
- PostgreSQL or Redis credential files
- browser or shell credential stores

## Tests

Create meaningful tests, not snapshot confetti.

At minimum include:

- core policy tests for success, retry, fallback, timeout or budget failure, and structured-output rejection
- idempotency behavior
- deterministic fake-provider failure scenarios
- event ordering and schema-version tests
- API request and response validation using Fastify injection
- persistence repository integration tests when PostgreSQL is available
- replay behavior for fake-provider executions
- non-replayable result for retained-data-disabled live executions
- export script dry-run tests using temporary Git repositories and secret-file rejection
- one Playwright smoke test for the execution list/detail flow when the stack is running

Keep unit tests independent of Docker. Integration and e2e tests may require local infrastructure and must fail with clear setup guidance rather than hanging.

## Initial verification and demo

After implementation:

1. Initialize local Git on branch `main` if needed. Do not create a remote and do not commit.
2. Install dependencies with pnpm.
3. Run formatting checks, linting, type checking, unit tests, and builds.
4. Start infrastructure if Docker is available.
5. Run migrations.
6. Run integration tests.
7. Start the API and dashboard long enough to exercise the demo flow.
8. Use the API to create:
   - one successful execution
   - one execution that retries and succeeds
   - one execution that falls back and becomes degraded
   - one structured-output validation failure
   - one replay
9. Run the Playwright smoke test if the stack can run locally.
10. Run `pnpm export:repo -- --dry-run` and verify the output list.
11. Run the audit commands in observational mode if network access permits. Never repair automatically.
12. Stop only processes you started. Do not destroy local volumes unless explicitly requested.

If Docker or network access is unavailable, complete everything that can be verified without it and state precisely what remains unverified. Do not silently replace PostgreSQL or Redis with a different production architecture simply to make checks green.

## Acceptance criteria

The first pass is complete when:

- the repository is coherent and installable
- root commands are documented and work where dependencies are available
- `pnpm verify` passes
- the API has validated OpenAPI-documented endpoints
- the deterministic fake provider supports forced failures
- the policy engine proves retry and fallback behavior in tests
- execution records and append-only events persist to PostgreSQL when infrastructure is available
- the dashboard can display an execution and its timeline
- replay works for a retained fake-provider execution
- live-provider retention defaults to off
- trace IDs connect API responses, logs, and stored records
- export skills and scripts exist and have dry-run coverage
- `AGENTS.md`, `README.md`, and architecture documents accurately describe reality
- no secrets are present
- no audit fix or force command was run
- no remote repository was created
- no commit was made

## Final response

At the end, provide a compact engineering closeout with:

1. What was built
2. The actual repository tree at a useful depth
3. Architecture decisions and meaningful deviations from this prompt
4. Commands run with pass, fail, or not-run status
5. How to start the stack and exercise the demo
6. Current limitations and the single most valuable next vertical slice
7. Audit findings, if audits ran, without applying fixes
8. Export-skill usage
9. `git status --short`

Do not produce vague claims such as “production ready,” “fully secure,” or “enterprise grade.” Show the evidence and let the repository speak.
