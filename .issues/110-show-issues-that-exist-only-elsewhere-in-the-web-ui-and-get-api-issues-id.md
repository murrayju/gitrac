---
id: 110
title: 'Show issues that exist only elsewhere in the web UI and GET /api/issues/:id'
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-16T21:58:37.177Z'
createdBy: Justin Murray
updated: '2026-10-17T13:28:54.549Z'
---

Follow-up from #107. `gitrac ls --elsewhere`, `gitrac show <id>` and `GET /api/issues?elsewhere=1` can see issues that exist only in another worktree or on an unmerged branch, but:

- The web UI doesn't use `?elsewhere=1`, so the board can't show what agents filed.
- `GET /api/issues/:id` returns 404 for such an issue, while `gitrac show` shows it.

## Acceptance criteria

- The issue list can include these issues (e.g. a toggle), each with an "only in worktree ..." / "only on branch ..." badge; their detail view is read-only.
- `GET /api/issues/:id` falls back to the cached scan like `show`, with `foundElsewhere`; mutations still 404.
- Tests.
