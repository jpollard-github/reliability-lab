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

## Completion contract

For code changes:

1. Inspect relevant code and documentation before editing.
2. Implement the smallest coherent change.
3. Add or update tests.
4. Run targeted checks.
5. Run `pnpm verify` when practical.
6. Run integration or e2e checks when the change crosses those boundaries and infrastructure is
   available.
7. Review the diff for regressions, leaked secrets, accidental generated files, and false
   documentation claims.
8. Report exactly which commands ran and whether they passed.

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
