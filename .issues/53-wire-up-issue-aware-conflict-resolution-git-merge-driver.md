---
id: 53
title: Wire up issue-aware conflict resolution (git merge driver)
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T01:50:48.605Z'
---

`resolveIssueConflict`, `mergeIssueFrontmatter` and `mergeComments` in `src/git/conflict.ts` are implemented and tested but never invoked. `pullRebase` is also unused.

## Proposal

- Add `gitrac merge-driver %O %A %B %P` command implementing a git custom merge driver for `.issues/**/*.md` (exit non-zero when descriptions truly conflict).
- `gitrac init` (and a `gitrac install-merge-driver` command) writes `.gitattributes` (`.issues/**/*.md merge=gitrac`) and the local `merge.gitrac.driver` git config.
- A merge strategy for `config.yaml` (`nextId` = max of both, union of labels/assignees).
- Fix: `mergeIssueFrontmatter` should take the max of `updated` rather than "ours wins".
