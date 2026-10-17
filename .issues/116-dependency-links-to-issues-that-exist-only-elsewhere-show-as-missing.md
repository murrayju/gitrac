---
id: 116
title: Dependency links to issues that exist only elsewhere show as missing
status: backlog
priority: low
assignee: ''
labels:
  - enhancement
created: '2026-10-17T14:25:27.667Z'
createdBy: Justin Murray
updated: '2026-10-17T14:25:27.667Z'
---

Found by #110. When a local issue links (`blockedBy` / `parent`) to an ID that exists only in another worktree or on an unmerged branch (for example a sub-issue an agent filed), `gitrac show`, `GET /api/issues/:id/dependencies` and the web dependencies panel show it as `(missing)`, because links are resolved against local issues only. `ready` also treats such a blocker as resolved (missing).

## Acceptance criteria

- Resolve links against the issues found elsewhere too (the cached scan on the web, the `withIssues` scan in the CLI), showing their title/status and where they are.
- Decide and document whether an open blocker that exists only elsewhere blocks `ready` / `next`.
- Tests.
