---
id: 68
title: Deleting an issue leaves dangling dependency references
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T13:15:03.763Z'
createdBy: Justin Murray
updated: '2026-10-15T13:15:17.905Z'
---

`gitrac delete` / `DELETE /api/issues/:id` (#59) removes the issue file but other issues may still reference it in `blockedBy` or `parent` (#55). They're treated as resolved/missing, but the references linger forever.

## Acceptance criteria

- `deleteIssue` removes the deleted ID from every other issue's `blockedBy` and clears `parent` where it pointed to the deleted issue, under the same lock, in the same commit (bumping `updated` on the touched issues).
- `--dry-run` / the confirmation plan lists the issues whose links will be removed; JSON output includes them.
- Tests (service, CLI, web).
