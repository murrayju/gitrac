---
id: 55
title: Issue dependencies and a ready/next command
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T02:29:36.819Z'
---

To orchestrate agents, the tracker must describe the work graph.

## Acceptance criteria

- Frontmatter fields `blockedBy: number[]` (and derived "blocks"), optional `parent: number`.
- `gitrac link <id> --blocked-by <id>` / `unlink`.
- `gitrac ready` lists open, unassigned (or mine), unblocked issues sorted by priority then ID; `-o json`.
- `gitrac next --claim` atomically picks and claims the top ready issue (under the mutation lock).
- Web UI shows dependencies on the detail view.
