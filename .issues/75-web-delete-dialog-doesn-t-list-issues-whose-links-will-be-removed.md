---
id: 75
title: Web delete dialog doesn't list issues whose links will be removed
status: todo
priority: low
assignee: ''
labels:
  - enhancement
created: '2026-10-15T16:06:59.362Z'
createdBy: Justin Murray
updated: '2026-10-15T16:06:59.362Z'
---

Since #68, deleting an issue also strips `blockedBy`/`parent` references from other issues. The CLI shows them in its plan and `--dry-run`, but the web confirmation dialog only says links will be removed.

## Acceptance criteria

- Dry-run support on the API (e.g. `DELETE /api/issues/:id?dryRun=1`, or a `GET .../delete-plan`) returning the same plan as the CLI `--dry-run`: the issue, assets, and `unlinked` issues. No writes.
- The UI confirmation dialog lists the assets and linked issues that will change before the user confirms.
- Tests for the dry-run route.
