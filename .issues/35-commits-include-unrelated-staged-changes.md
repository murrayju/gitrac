---
id: 35
title: Commits include unrelated staged changes
status: in_progress
priority: urgent
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:01:06.963Z'
---

`commitIssueChange` (`src/git/operations.ts`) and `AmendTracker.amend` do `git add <files>` followed by a plain `git commit`, which commits the **entire index**. Anything the user (or another agent) had staged gets swept into the `issue:` commit.

## Repro

```bash
echo secret > code.txt && git add code.txt
gitrac comment 2 "hi"
git show --stat HEAD   # includes code.txt
```

## Acceptance criteria

- gitrac commits contain only the paths gitrac passed (use `git commit -- <paths>` / `--only` semantics, including for amend).
- Deleted/renamed paths (close, reopen, title change) still work — paths that no longer exist on disk must be handled (e.g. `git add -A -- <paths>` or `git rm --cached` as needed).
- Pre-existing staged changes remain staged and uncommitted afterwards.
- Regression tests for commit and amend.
