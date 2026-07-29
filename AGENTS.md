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
