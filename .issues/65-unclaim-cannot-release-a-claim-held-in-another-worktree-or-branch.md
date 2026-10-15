---
id: 65
title: unclaim cannot release a claim held in another worktree or branch
status: todo
priority: medium
assignee: ''
labels:
  - bug
created: '2026-10-15T13:15:01.159Z'
createdBy: Justin Murray
updated: '2026-10-15T13:15:01.159Z'
---

Since #56, `claim`/`ready`/`next`/`ls` judge an issue by its *effective* state (newest `updated` across this working tree, other worktrees' working trees, and all local/remote-tracking refs). `unclaim` still only looks at the local file, so from `main` you can't release a claim made in an agent's worktree: the local file is unassigned, so `unclaim` is a no-op, and the claim keeps blocking `claim`/`ready`/`next`.

## Acceptance criteria

- `unclaim` decides based on the effective state (reuse the gathering in `src/git/elsewhere.ts` and the pure rules in `src/core/`).
- If the effective state is claimed by *you* elsewhere, `unclaim` writes a local release (assignee cleared, `unclaimStatus`, newer `updated`) that supersedes it; if claimed by someone else, it requires `--force` (`not_yours`/exit 3 otherwise), and the error/JSON includes `claimedElsewhere`.
- `claim` warns (stderr, not an error) when you claim an issue you already hold in another worktree.
- Tests with real git worktrees: release from main makes the issue ready again for others; `--force` required for someone else's claim.
- Docs (skill "Parallel Agents in Worktrees" section, spec) updated.
