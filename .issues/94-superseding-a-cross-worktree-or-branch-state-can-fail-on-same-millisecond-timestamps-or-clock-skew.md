---
id: 94
title: >-
  Superseding a cross-worktree or branch state can fail on same-millisecond
  timestamps or clock skew
status: backlog
priority: medium
assignee: ''
labels:
  - bug
blockedBy:
  - 93
created: '2026-10-16T12:12:40.589Z'
createdBy: Justin Murray
updated: '2026-10-16T12:14:06.930Z'
---

`unclaimIssue` and `claimIssue --force` (`src/service/claim.ts`) release or override a claim held in another worktree or branch by writing a local version whose `updated` timestamp supersedes `elsewhere.updated`.

However, `newestElsewhere` (`src/core/elsewhere.ts`) compares timestamps with strict `isLater` (`>`), while `claimIssue` / `unclaimIssue` set `issue.updated = new Date().toISOString()` without ensuring the new timestamp is strictly greater than the previous local `updated` and any `elsewhere` `updated` timestamp.

If a script or agent claims and releases within the same millisecond, or if a remote branch's claim came from a machine whose clock was slightly ahead, `unclaim` prints `Released the claim … (this newer version supersedes it)`, but `newestElsewhere` still considers the other branch's timestamp newer (or tied), so the claim immediately reappears as active.

## Acceptance criteria

- Ensure mutations that write `issue.updated` (especially `claimIssue`, `unclaimIssue`, `closeIssue`, `reopenIssue`, `updateIssue`) produce an ISO timestamp strictly greater than the issue's existing `updated` and (where scanned) any `elsewhere` state's `updated` (e.g. `new Date(Math.max(Date.now(), maxPriorMs + 1)).toISOString()`).
- Unit and service tests covering same-millisecond and slightly future-dated `elsewhere` timestamps.
