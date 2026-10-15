---
id: 71
title: close fails in a fresh clone/worktree without .issues/closed/
status: in_progress
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T14:28:12.994Z'
createdBy: Justin Murray
updated: '2026-10-15T14:28:23.163Z'
---

Found by the #65 subagent and reproduced by the orchestrator. Git doesn't track empty directories, so a fresh clone or worktree of a repo with no closed issues has no `.issues/closed/`. `relocateIssue` (`src/fs/issue-store.ts`) renames the issue file into `closed/` without creating it:

```
$ gitrac close 1
Error: ENOENT: no such file or directory, rename '…/.issues/1-a.md' -> '…/.issues/closed/1-a.md'
```

This breaks step 3 of the documented "Parallel Agents in Worktrees" workflow (agent closes its issue in its worktree) for any repo without closed issues yet. #67 added `mkdir` to `writeIssue`, but the rename path in `relocateIssue` (and the legacy `moveToClose`/`moveToReopen`) don't create the target directory.

## Acceptance criteria

- `relocateIssue`, `moveToClose` and `moveToReopen` create the target directory before renaming.
- Regression test: closing an issue when `.issues/closed/` doesn't exist (service + real CLI in a fresh clone).
