---
id: 71
title: close fails in a fresh clone/worktree without .issues/closed/
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T14:28:12.994Z'
createdBy: Justin Murray
updated: '2026-10-15T14:37:20.578Z'
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

---

### Justin Murray — 2026-10-15T14:37:20.578Z

\## #71: `close` works in a fresh clone/worktree without `.issues/closed/`

**What was wrong:** git doesn't track empty directories, so a clone or worktree of a repo with no closed issues has no `.issues/closed/`. `relocateIssue` (the shared write path since #63) wrote the new content into the old file and then `rename`d it into `closed/` without creating the directory → `ENOENT … rename …`. This broke step 3 of the "Parallel Agents in Worktrees" workflow (agent closes its issue in its own worktree). #67's `mkdir` only covered `writeIssue`.

**What changed** (`src/fs/issue-store.ts`):
- `relocateIssue` creates the target directory (`.issues/` or `.issues/closed/`) before the rename.
- The legacy `moveToClose` does the same (`moveToReopen` targets `.issues/`, which always exists since it holds `config.yaml`).

**Tests:** `relocateIssue` and `moveToClose` with `.issues/closed/` removed (`src/fs/issue-store.test.ts`), and a real `git clone` of a repo without closed issues where `gitrac close 1` succeeds with a clean tree (`src/cli/commands/close.test.ts`). All three fail without the fix.
