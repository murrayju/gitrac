---
id: 65
title: unclaim cannot release a claim held in another worktree or branch
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T13:15:01.159Z'
createdBy: Justin Murray
updated: '2026-10-15T14:17:10.391Z'
---

Since #56, `claim`/`ready`/`next`/`ls` judge an issue by its *effective* state (newest `updated` across this working tree, other worktrees' working trees, and all local/remote-tracking refs). `unclaim` still only looks at the local file, so from `main` you can't release a claim made in an agent's worktree: the local file is unassigned, so `unclaim` is a no-op, and the claim keeps blocking `claim`/`ready`/`next`.

## Acceptance criteria

- `unclaim` decides based on the effective state (reuse the gathering in `src/git/elsewhere.ts` and the pure rules in `src/core/`).
- If the effective state is claimed by *you* elsewhere, `unclaim` writes a local release (assignee cleared, `unclaimStatus`, newer `updated`) that supersedes it; if claimed by someone else, it requires `--force` (`not_yours`/exit 3 otherwise), and the error/JSON includes `claimedElsewhere`.
- `claim` warns (stderr, not an error) when you claim an issue you already hold in another worktree.
- Tests with real git worktrees: release from main makes the issue ready again for others; `--force` required for someone else's claim.
- Docs (skill "Parallel Agents in Worktrees" section, spec) updated.

---

### Justin Murray — 2026-10-15T14:17:10.391Z

**#65: `unclaim` now judges by the effective state, so it can release a claim held in another worktree or on another branch**

`./bun run check` passes (1025 tests). The new tests fail without the fix: the old `unclaim` only read the local file and did nothing.

**What was wrong**
Since #56, `claim`/`ready`/`next`/`ls` judge an issue by its effective state: the newest version by `updated` across this working tree, other worktrees, and all branches. `unclaim` only read the local file. So from `main` you couldn't release an agent's claim made in its worktree: the local file was unassigned, `unclaim` did nothing, and the claim kept blocking everyone else.

**What changed**
- **The rule (`src/core/claim.ts`, `src/core/elsewhere.ts`):** `decideUnclaim` now takes the versions of the issue found elsewhere and decides on the newest one. Core stays pure.
  - Closed here, or closed in a newer version elsewhere: refused with exit 4 (`issue_closed`). Releasing it would reopen it.
  - Unassigned in the effective state: does nothing.
  - Someone else's claim: needs `--force`, otherwise exit 3.
  - Otherwise it is released: assignee cleared, `in_progress` moved to `unclaimStatus`, other statuses kept.
  - The decision now also returns the status to write and where the claim was found.
  - `decideClaim` now reports when the effective state is your own claim elsewhere. A new helper, `toClaimedElsewhere`, builds the "where" details for both.
- **Service (`src/service/claim.ts`):** `unclaimIssue` looks up the other versions under the repo lock, the same way `claimIssue` does. A release writes a new local version with a newer `updated`, which wins over the claim everywhere. The other worktree's file and the branch are left as they are.
  - Errors say where the issue is held and include `claimedElsewhere` (or `closedElsewhere` for the closed case) in the JSON.
  - The result has a new optional `elsewhere` field.
- **CLI:**
  - `src/cli/commands/claim.ts`: `claim` prints a warning to stderr, not an error, when you already hold the issue elsewhere: `Warning: you already hold issue #N in worktree … (branch …); claimed it here too.`
  - `src/cli/commands/unclaim.ts`: `unclaim` prints `Released the claim by X in worktree …` to stderr, and its help text mentions this.
- **Docs:** the spec's Claiming section, the skill's claim/unclaim text and its "Parallel Agents in Worktrees" section (new step 4: release a stuck agent's claim from `main`), and the `unclaim` line in `AGENTS.md`.

**Tests**
- `src/core/claim.test.ts`: unit tests for the new rules.
- `src/cli/commands/worktree-claims.test.ts`: tests with real git worktrees:
  - releasing from `main` makes the issue ready and claimable again in another worktree;
  - someone else's claim needs `--force` (exit 3, JSON has `claimedElsewhere`);
  - a committed claim on a branch can be released after its worktree is removed;
  - an issue closed elsewhere gives exit 4;
  - the `claim` warning appears.

**Decisions**
- **Error code:** the issue text says "`not_yours`/exit 3", but I kept the existing `already_claimed` code (exit 3). The exit codes are a documented public contract, and `unclaim` already uses `already_claimed`, so renaming it would break scripts.
- **Newer release elsewhere:** if a newer version elsewhere is already unassigned, `unclaim` does nothing, even if the local file is still assigned.
- **Status on release:** it keeps the effective version's status (if this config knows it), except that `in_progress` becomes `unclaimStatus`.
- **Unassigned issue closed elsewhere:** an unassigned issue that was closed in a newer version elsewhere now gives exit 4 instead of doing nothing. This matches how a local closed issue is treated.

**Follow-ups noticed (not fixed; out of scope)**
- **Bug:** `close` fails with `ENOENT … rename …/.issues/1-x.md -> …/.issues/closed/1-x.md` in a fresh worktree or clone where `.issues/closed/` doesn't exist. git doesn't track the empty directory, and `relocateIssue` in `src/fs/issue-store.ts` renames into it without creating it first (`writeIssue` does create it). This breaks step 3 of the documented worktree workflow (an agent closes its issue in its worktree) in any repo with no closed issues yet. My test creates the directory as a workaround. It should be filed.
- **Web and `next --claim`:** the result's new `elsewhere` field is optional, so the web routes (#66) and `next --claim` are unaffected. The web doesn't show the new warning or release note yet.
