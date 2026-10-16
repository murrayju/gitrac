---
id: 93
title: >-
  Issues closed in another worktree or branch lose their elsewhere indicator and
  can be re-claimed without --force
status: backlog
priority: high
assignee: ''
labels:
  - bug
created: '2026-10-16T12:12:39.477Z'
createdBy: Justin Murray
updated: '2026-10-16T12:12:39.477Z'
---

When a subagent in another worktree (or on an unmerged branch) finishes an issue and closes it (`gitrac close <id>`), two problems occur in other worktrees (such as `main`):

1. **`claim` does not check if the effective state is closed elsewhere:** In `src/core/claim.ts`, `decideUnclaim` checks `if (newer && isClosedStatus(config, newer.status))` and returns `{ action: 'closed' }`, but `decideClaim` only checks the *local* copy (`options.inClosedDir || isClosedStatus(config, issue.status)`). If the issue was closed in another worktree/branch, `effective.status` is `done` (not `activeStatus`), so `decideClaim` falls through and returns `{ action: 'claim', reopen: false }`. Running `gitrac claim <id>` on `main` succeeds without `--force` or warning, writing a newer `updated` timestamp (`T3 > T2`). When the agent branch is later merged into `main`, `mergeIssueFrontmatter` picks `main`'s `in_progress` status because `T3 > T2`, silently undoing the agent's close!
2. **The elsewhere indicator disappears on `ls` / `show` / web UI:** `claimedElsewhere` (`src/core/elsewhere.ts`) only reports when `newest.status === activeStatus(config)`. As soon as an agent in a worktree closes the issue on its branch, the `[claimed in worktree …]` badge disappears on `main`, making the issue look like an untouched open `backlog` issue until the branch is merged.

## Acceptance criteria

- `decideClaim` refuses with `action: 'closed'` (CLI exit 4 `issue_closed`, including `closedElsewhere` details) when the effective state is closed in another worktree or branch, unless `--force` is passed.
- `ls`, `show`, and the web API/UI surface when an open local issue's effective state is closed in another worktree or branch (e.g. `[closed (done) in worktree …]`), so orchestrators and humans can see completed work awaiting merge.
- Tests with real git worktrees and branches in `src/core/claim.test.ts` and `src/cli/commands/worktree-claims.test.ts`.
