---
name: export-working-files
description: Export explicitly allowlisted Git-ignored non-secret working artifacts, such as local trace captures, sanitized fixtures, screenshots, or diagnostic bundles. Use only when the user asks to package important local working files that are intentionally excluded from the repository.
---

# Export working files

Run from the repository root.

1. Read `.working-files.export.json`.
2. Refuse to continue if `include` is empty, a path escapes the repository, or a candidate appears
   secret.
3. Run `pnpm export:working -- --dry-run` first.
4. Review the allowlisted paths and sizes.
5. Only after a clean dry run, run `pnpm export:working`.
6. Report the archive path and summarize `WORKING-FILES-MANIFEST.json`.

Never add secrets, environment files, credential stores, raw production prompts, or user data to the
allowlist. Use the repository command; do not bypass a safety refusal.
