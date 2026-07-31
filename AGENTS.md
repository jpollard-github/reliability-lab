# Reliability Lab agent guide

## Purpose and boundaries

Reliability Lab is a reliability-platform prototype for policy-driven, observable, replayable LLM
executions. It is not a generic chatbot. Preserve the separation among domain logic
(`packages/core`), provider adapters (`packages/providers`), transport (`apps/api`), persistence
(`packages/db`), observability, and UI (`apps/web`). Do not claim a capability that the code does not
implement.

## Toolchain

Use pnpm only; never use npm or Yarn to modify this workspace.

- Install: `corepack enable && pnpm install`
- Develop: `pnpm dev:infra`, `pnpm dev:api`, `pnpm dev:web`, or `pnpm dev`
- Format: `pnpm format` / check only: `pnpm format:check`
- Lint: `pnpm lint`
- Typecheck: `pnpm typecheck`
- Tests: `pnpm test:unit`, `pnpm test:integration`, `pnpm test:e2e`
- Build: `pnpm build`
- Repository checks: `pnpm verify`; infrastructure checks: `pnpm verify:full`
- Migrations: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`
- Observational audits: `pnpm audit:deps`, `pnpm audit:unused`, `pnpm audit`
- Exports: `pnpm export:repo -- --dry-run`, `pnpm export:working -- --dry-run`

Prefer targeted tests while editing, then run the appropriate repository verification command.

## Comprehension and module structure

- Start product work with `docs/design-review-walkthrough.md`, then use `docs/codebase-tour.md` and
  `docs/system-flows.md` to locate the owner. Use `docs/change-recipes.md` before representative
  cross-layer changes; pattern guides define local conventions.
- Package-root `src/index.ts` files are public export maps, not implementation files.
- Within `packages/contracts`, `packages/core`, and `packages/db`, import the module that directly
  owns a symbol; never import through the same package root or its root `index.ts`.
- Keep TypeBox schemas beside their `Static<>` types.
- Prefer cohesive feature modules over god files or one-function file confetti.
- Add a short ownership/invariant comment to non-trivial production modules.
- Preserve the explicit execution event distinction: callers provide `ExecutionEventPayload`, while
  `ExecutionEventRecorder` alone adds stored metadata.
- Keep DB connections in `database/database.ts`, schema definitions under `schema/`, fixed
  investigation SQL in purpose-named query modules, and atomic saved-case commands in their
  transaction module.
- Keep `apps/api/src/app.ts` as composition. Route plugins own transport schemas/status/log mapping;
  core owns policy and DB owns persistence.
- Keep `apps/web/app/**/page.tsx` as route composition. Server reads use `lib/server-api.ts`; browser
  mutations use `lib/client-api.ts` and feature-specific helpers. Keep URL state, live stream state,
  playback state, and form drafts in their named feature modules.
- Keep operator guidance under `apps/web/features/guidance`. Guide content and tour records are
  plain reviewable data; route sections own semantic `data-guide-anchor` values. Tours stay
  stateless, on demand, and free of product mutations or server-only imports.
- Keep global CSS in the ordered `app/globals.css` import map. Preserve selector names, declaration
  values, and cascade order when moving feature styles.
- Organize Playwright by operator workflow under `apps/web/tests`; shared setup uses domain names,
  unique idempotency keys, and explicit terminal drains.
- Run `pnpm audit:structure` after changing contracts/core/DB/API/web layout. The audit enforces
  export-only roots, direct internal imports, feature-name boundaries, API/page composition,
  client/server boundaries, detectable web-feature cycles, CSS/test organization, and production
  file ceilings.
- Keep public package-root exports stable unless a task explicitly authorizes a breaking change.
- Update `docs/change-recipes.md` when an architectural change moves an owner, adjacent boundary,
  invariant, or expected test layer. Documentation claims must be checked against current code,
  symbols, and tests; roadmap language never proves that a capability exists.

## Completion contract

For code changes:

1. Inspect relevant code and documentation before editing.
2. Implement the smallest coherent change.
3. Add or update tests and ownership documentation where responsibility changes.
4. Run focused checks for the changed owner.
5. Run `pnpm audit:docs` for documentation/path changes and `pnpm audit:structure` for source
   ownership changes.
6. Run `pnpm verify` when practical. Run integration tests for PostgreSQL queries, transactions,
   encryption persistence, or durable jobs; run E2E for routes, process boundaries, SSE, URL state,
   accessibility, or operator workflows.
7. Review the diff for regressions, leaked secrets, accidental generated files, and false
   documentation claims.
8. Report exactly which commands ran and whether they passed. Create exports only after edits and
   verification are complete.

Never state that a test, build, migration, audit, or runtime path passed unless it actually ran
successfully.

## Audit policy — observational only

Never run `npm audit fix`, `pnpm audit --fix`, an audit repair using `--force`, or an automated major
dependency upgrade as security remediation. Summarize advisories and affected dependency paths for
human decision. Do not suppress or downgrade advisories to make a command green.

## Git policy

Initialize a local repository on `main` if absent. Do not create a remote. Do not commit, push,
rebase, reset, force, or alter unrelated user work unless explicitly requested. Preserve dirty
worktrees and keep edits scoped.

## Security and data handling

Never commit `.env`, credentials, provider keys, replay encryption keys, raw production prompts, or
local database volumes. Keep `.env.example` fake and explanatory. Redact authorization headers,
cookies, keys, messages, and input from logs. Live-provider request-body retention is default-deny.

## Permanent product baseline

- Reliability Lab is an evidence workbench for bounded LLM execution policy. It is not an answer
  judge, generic chat product, model benchmark, or universal provider-health monitor.
- The established operator loop is `Execute → Explain → Watch → Replay → Compare → Investigate →
Preserve → Experiment → Conclude`. Preserve those links when changing one movement.
- Horizon 5 is established against the repository's bounded operator drill. That is a workflow
  signal, not empirical usability research, production readiness, or a Horizon 6 tenancy claim.
- Horizon 6 has not begun. Do not infer authentication, authorization, authorship, RBAC, RLS, or
  production isolation from the transparent tenant header or tenant predicates.
- Future candidates remain optional until explicitly elected. Do not add a generic scenario
  catalog, campaign engine, recovery platform, telemetry warehouse, or provider-health product to
  complete a focused task.

## Canonical implementation flow

Use this order when tracing or changing an operator-visible behavior:

1. Portable TypeBox schema and `Static<>` type in `packages/contracts`.
2. Framework-independent invariant, coordinator, projection, or port in `packages/core`.
3. Memory adapter for local behavior and deterministic tests.
4. PostgreSQL query or atomic command in `packages/db` when durability is part of the claim.
5. Fastify schema, route, and safe log mapping in `apps/api`.
6. Server read or focused browser mutation in `apps/web`.
7. Unit, API, integration, and Playwright evidence proportional to the claim.
8. Architecture, flow, recipe, tour, status, and roadmap wording that matches the code.

Do not skip directly from UI intent to database shape. Do not duplicate core semantics in Fastify,
Next.js, SQL, or test helpers.

## Truth and evidence rules

- Append-only lifecycle events explain what happened. Mutable rows and derived reviews describe
  current state. Keep those roles distinct.
- A current capability must be read from its authoritative owner. Historical success does not prove
  that replay material, comparison evidence, or a tenant-scoped source is still available.
- Missing, unavailable, running, failed, degraded, and partial results are data states, not generic
  errors to hide.
- Derived projections must be deterministic, bounded, tenant-scoped, and explicit about omitted or
  unavailable evidence. Avoid scores when fixed checks or dimensions preserve more truth.
- Evidence references remain references. Never copy raw prompts, messages, outputs, attempts,
  event bodies, replay capsules, encrypted commands, credentials, or provider request bodies into
  investigation cases or review packets.
- Finding and resolution are operator interpretation. Tests may prove presence and consistency, not
  factual truth or causation.
- Timeline metadata stays bounded and operational. Do not put note, finding, resolution, prompt, or
  output prose into lifecycle events or diagnostics.

## Tenant and sensitive-data boundary

- Every case, execution, comparison, replay, investigation, and durable-job read or mutation must
  carry the tenant predicate through its authoritative port and adapter.
- Wrong-tenant resources must be indistinguishable from missing resources at transport and review
  boundaries.
- Tenant routing is not authenticated identity. Do not add actor, owner, assignee, approver, or
  author claims without an explicit identity design.
- Logs and diagnostics may include bounded identifiers, operation names, safe event types, and
  constrained error names. They must exclude exception messages when those may contain payloads.
- Review packets are internal trace artifacts, not public-safe reports. Preserve their explicit
  exclusions and escaped internal links.

## Runtime and dependency contract

- Development resolves workspace packages to source through the `development` condition.
  Production uses emitted JavaScript and declarations through default/type package exports.
- API and worker production entrypoints run `dist/server.js`. Never point a production script back
  at TypeScript source to make a build pass.
- `pnpm build` includes `pnpm audit:runtime`; keep the built-runtime smoke explicit when package
  exports, build configs, or process entrypoints change.
- App Router pages are Server Component composition roots. Use `lib/server-api.ts` for current
  server reads and focused client helpers for browser mutations. Do not introduce Server Actions,
  middleware, or proxy behavior incidentally.
- Dependency audits are observational. Record exact advisory paths and versions; do not auto-fix,
  force, override, suppress, or weaken an audit without a separately authorized remediation task.
- Review lockfile changes for unrelated churn. A source or documentation task should not update
  dependencies.

## Recovery and consistency discipline

- Do not call a cross-resource workflow atomic when it is not. Preserve partial success with a safe
  identifier and a narrow continuation that operates on the existing resource.
- A durable recovery projection should come from existing authoritative state and explicit
  lifecycle completion where practical. Do not add a recovery table merely to mirror events and
  evidence.
- Recovery actions must be idempotent and must not repeat the original external effect. Test reload,
  process re-instantiation, wrong tenant, repeated action, and later evidence removal when relevant.
- Use fixed-size batches or purpose-built bounded queries. Never create unbounded concurrency from
  arbitrary event or evidence counts.

## Review and archive discipline

- At task start record the branch, commit, and dirty state. Existing changes belong to the user;
  preserve them and report overlap.
- Review `git diff --check`, the full diff/stat, untracked files, and dependency/lockfile changes
  before final verification.
- Run operator drills against the real API, worker, database, and server-rendered page when the
  claim crosses those boundaries. Browser interception alone does not prove durable recovery.
- No-JavaScript review should inspect server-rendered truth, even when the final mutation requires a
  small client island.
- Create the repository-review archive only after all edits and checks. Dry-run first, inspect the
  manifest, create once, hash it, and make no later edits without rerunning appropriate checks and
  recreating the archive.
- Never commit, push, deploy, or create a remote unless the user explicitly asks.

## Horizon and documentation discipline

- Status prose must say whether a document is current, historical, or a completed plan. Add a
  banner to superseded plans instead of rewriting their historical sequence as if it were current.
- The design review gives the short truthful explanation; architecture owns boundaries; system
  flows own sequences; the codebase tour owns find-it paths; change recipes own modification steps;
  ADRs own durable decisions; the roadmap owns established versus future.
- Update counts only when they help navigation, and verify them from the current suite. Prefer
  workflow names over brittle totals.
- A roadmap sentence is not implementation evidence. Cite current symbols, routes, tests, and
  operator drills before claiming a movement established.

## Repository skills

- `$export-repo`: package tracked and non-ignored repository files using `pnpm export:repo`; use when
  asked to archive or share the repository. This is the source handoff archive.
- `$export-working-files`: package only explicitly allowlisted, ignored, non-secret artifacts using
  `pnpm export:working`; use when asked to preserve local traces, sanitized fixtures, screenshots, or
  diagnostics. It is not a source-code change-set exporter.

When a substantial implementation task explicitly requests a reviewable handoff archive, run the
full repository export only after all edits and verification are complete. Review the dry run first;
a dry run is not an export. Do not edit after creating the final archive unless verification is
rerun as appropriate and the archive is recreated.
