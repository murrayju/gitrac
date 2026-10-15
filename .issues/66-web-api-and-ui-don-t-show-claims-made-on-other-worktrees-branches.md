---
id: 66
title: Web API and UI don't show claims made on other worktrees/branches
status: todo
priority: medium
assignee: ''
labels:
  - feature
created: '2026-10-15T13:15:02.044Z'
createdBy: Justin Murray
updated: '2026-10-15T13:15:02.044Z'
---

`claimedElsewhere` (#56) is exposed by the CLI (`ls`/`show`/`ready`, JSON field) but not by the web API or UI, so someone watching the board can't see what agents in other worktrees are working on.

## Acceptance criteria

- `GET /api/issues` and `GET /api/issues/:id` include the optional `claimedElsewhere` field, using the same service code as the CLI.
- The scan is not run unboundedly per request: cache results briefly (e.g. a few seconds, invalidated by the file watcher for this worktree) so list polling/SSE refetch bursts stay cheap; document the staleness bound.
- UI: list rows and the detail view show a clear indicator ("claimed by X in worktree/branch Y"), using the existing badge styling.
- Optional: periodically refresh while the page is open (other worktrees' changes are not watched).
- Tests for the API field and caching; UI build passes.
