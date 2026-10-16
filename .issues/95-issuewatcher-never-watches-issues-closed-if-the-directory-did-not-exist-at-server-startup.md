---
id: 95
title: >-
  IssueWatcher never watches .issues/closed/ if the directory did not exist at
  server startup
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:12:41.648Z'
createdBy: Justin Murray
updated: '2026-10-16T14:13:06.222Z'
---

Git does not track empty directories, so in a fresh clone/worktree or a repository with no closed issues yet, `.issues/closed/` does not exist on disk when `gitrac serve` starts (see #71).

In `src/web/watcher.ts`, `IssueWatcher.start()` loops over `[issuesDir, closedDir]` once at startup with `recursive: false` and ignores `ENOENT` when `.issues/closed/` is missing. Once the first issue is closed (`mkdir('.issues/closed', { recursive: true })`), `IssueWatcher` never attaches a watcher to `.issues/closed/` (nor re-attaches if git removes and recreates the directory across branch checkouts).

As a result, subsequent edits, comments, or deletions on closed issues never emit `issues-changed` SSE events and never bump `watcher.generation()` (leaving `ElsewhereCache` stale as well).

## Acceptance criteria

- `IssueWatcher` detects when `.issues/closed/` is created (or recreated) after `start()` and attaches a watcher to it so changes inside `.issues/closed/` always emit debounced change events and bump `generation()`.
- Tests in `src/web/` verifying that starting `IssueWatcher` when `.issues/closed/` does not exist still emits change events when `.issues/closed/` is created later and files inside it are modified.
