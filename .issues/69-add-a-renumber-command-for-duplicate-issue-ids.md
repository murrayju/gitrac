---
id: 69
title: Add a renumber command for duplicate issue IDs
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-15T13:15:04.607Z'
createdBy: Justin Murray
updated: '2026-10-15T13:15:18.780Z'
---

Two separate clones that create issues without fetching each other can still allocate the same ID (#54 limitation). After merging, gitrac reports `duplicate_issue` (#63) and the fix is manual.

## Acceptance criteria

- `gitrac renumber <id> --file <path>` (or an interactive choice when stdin is a TTY) moves the selected file to a fresh ID allocated the normal way (#54 allocator), renaming the file and updating its frontmatter `id`, under the repo lock, committed (respect `--no-commit`), `-o json` output with old/new IDs and paths.
- Without `--file`, if the ID is duplicated, list the candidates and exit with `duplicate_issue`/usage guidance; if the ID isn't duplicated, require `--force` to renumber anyway.
- References: since `#N` mentions and `blockedBy`/`parent` links are ambiguous when an ID is duplicated, do not rewrite them by default; print (and include in JSON) the issues that reference the old ID; `--update-refs` rewrites `blockedBy`/`parent` links in other issues to the new ID.
- Error messages for `duplicate_issue` (CLI hint + skill/spec docs) point to `gitrac renumber`.
- Tests (service + CLI), including a real two-clone merge producing a duplicate.
