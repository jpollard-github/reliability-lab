---
name: export-repo
description: Export the current repository as a compressed archive containing tracked and untracked non-ignored files, while excluding Git-ignored content, repository metadata, generated export archives, and likely secrets. Use when the user asks to package, archive, share, or export the repository.
---

# Export repository

Run from the repository root.

1. Run `pnpm export:repo -- --dry-run`.
2. Review the exact file list for secrets, generated files, and unintended artifacts.
3. If the dry run is clean, run `pnpm export:repo`.
4. Report the archive path, byte size, file count, branch, commit (when present), and dirty state
   from `EXPORT-MANIFEST.json`.

Use the repository command. Do not invent an ad hoc archive command or bypass a refusal.
