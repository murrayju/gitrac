---
id: 119
title: Decide whether close and reopen should respect claims held elsewhere
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-17T14:25:26.507Z'
createdBy: Justin Murray
updated: '2026-10-20T21:47:26.007Z'
---

Found by #108. `edit` / `PATCH` now refuse a status or assignee change when someone else holds the issue (here or in another worktree or branch), unless forced. `close` and `reopen` (`closeIssue` / `reopenIssue`) don't check claims. That is often right (an orchestrator closes an agent's finished work), but a close on main can silently supersede a newer active claim in an agent's worktree, and the agent's later merge then fights with it.

## Acceptance criteria

- Decide the rule (for example: `close` of an issue held by someone else elsewhere needs `--force`, or only warns on stderr), document it in the spec and skill, and apply it identically on the CLI and the web.
- Tests with a real worktree claim.

---

### Justin Murray — 2026-10-20T21:14:05.038Z

Renumbered from #115 (duplicate ID).
