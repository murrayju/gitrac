---
id: 107
title: Surface issues created in other worktrees or on unmerged branches
status: backlog
priority: low
assignee: ''
labels:
  - feature
created: '2026-10-16T12:13:33.538Z'
createdBy: Justin Murray
updated: '2026-10-16T12:13:33.538Z'
---

`listIssues` and `listReadyIssues` only load `.issues/*.md` files present in the current worktree's filesystem, then overlay `issueStatesElsewhere` for those IDs.

When a subagent running in another worktree discovers a bug or decomposes work by creating new issues (`gitrac create`) on its branch, those issues are invisible to `gitrac ls` / `gitrac show` / the web UI in the `main` worktree (and other worktrees) until the branch is merged (even though `allocateIssueId` already scans all refs to avoid ID collisions).

## Acceptance criteria

- Extend the cross-worktree / cross-branch scan (or add an option / section in `ls`, `show`, and the web API/UI) so issues that exist only in another worktree or on an unmerged branch can be inspected from `main` before their branch is merged.
- Tests with real git worktrees and branches.
