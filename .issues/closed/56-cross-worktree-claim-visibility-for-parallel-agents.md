---
id: 56
title: Cross-worktree claim visibility for parallel agents
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T03:48:20.388Z'
---

Subagents typically work in separate git worktrees. Each worktree has its own checkout of `.issues/`, so a claim made in one worktree is invisible to the others until merged — defeating the purpose of claims.

## Options (needs a decision)

1. **Single writer**: orchestrator in the main worktree owns all `.issues/` mutations; subagents only write code. Document this pattern in the skill / work-backlog command. (No code change, but no protection either.)
2. **Shared claim registry** in the git common dir (`$(git rev-parse --git-common-dir)/gitrac/claims.json`) that `claim`/`ready`/`ls` consult in addition to the file, so all local worktrees see claims instantly. The file-level assignee/status still lands in the branch commit.
3. Store issue state on a dedicated ref (e.g. `refs/gitrac/`) like git-bug — larger redesign; conflicts with "close in the same commit as the fix".

Recommendation: 2, plus documenting 1.

---

### Justin Murray — 2026-10-15T03:48:20.388Z

I implemented #56: a claim made in one worktree or on an unmerged branch is now visible to `claim`, `ready`, `next`, `ls` and `show` everywhere. `./bun run check` passes (945 tests). Nothing is committed and no issue state was touched.

\## What was wrong
Each worktree has its own copy of `.issues/`, so a claim made in another worktree, or committed on a branch that isn't merged yet, wasn't seen. Two agents could claim the same issue, and `ready`/`next` offered issues already being worked on.

\## What changed and why
I used the chosen design, with no new shared state. An issue's **effective state** is its version with the latest `updated` across:
- this working tree's file,
- every other worktree's working tree (from `git worktree list --porcelain`, so uncommitted `--no-commit` claims count),
- every local and remote-tracking branch except the one checked out here.

Ties go to this working tree first, then other worktrees, then local branches, then remote ones.

- **`claim`**: refuses with `already_claimed` (exit 3) if the effective state is `in_progress` and assigned to someone else. The message says where, e.g. `… claimed by Bob (in_progress) in worktree /p (branch agent-1)` or `… on branch origin/x`. The JSON error includes `claimedElsewhere: { ref, worktree?, assignee, updated }`. `--force` takes it over. A newer unclaim anywhere supersedes an older claim. The scan runs under the repo lock, which all worktrees share, so a claim from another worktree can't land between the check and the write.
- **`ready`/`next`**: `isAvailableTo` now judges the effective state. Issues claimed elsewhere, or closed on an unmerged branch, are skipped. `next` also skips your own claims in other worktrees, so agents sharing one identity get different issues.
- **`ls`/`show`/`ready` output**: the list appends `[claimed … by Y]`, `show` adds an `Elsewhere:` line, and JSON/YAML get an optional `claimedElsewhere` field.
- **Cost**: five git processes per scan, however many refs there are, plus plain reads of the other worktrees' files. Branch versions identical to this worktree's `HEAD` are skipped.

\## Files
- **New:** `src/git/objects.ts` (the batch `cat-file` helpers, moved out of `ids.ts`, which now uses them), `src/git/elsewhere.ts` (the scan), `src/core/elsewhere.ts` (pure rules).
- **Changed:** `src/core/claim.ts`, `src/core/ready.ts`, `src/service/{claim,ready,list}.ts`, `src/cli/output.ts`, `src/cli/commands/{list,show,ready}.ts`.
- **Tests:** `src/core/elsewhere.test.ts` and `src/git/elsewhere.test.ts` (new), additions to `src/core/{claim,ready}.test.ts`, and `src/cli/commands/worktree-claims.test.ts` (new; uses real git worktrees).
- **Docs:**
  - `docs/specs` has a new "Claims on other branches and worktrees" section.
  - The skill doc has claim notes and a new "Parallel Agents in Worktrees" section.
  - `AGENTS.md` has a convention bullet and an updated `claim` line.

\## Decisions and trade-offs
- **Newest version wins, whatever it is.** Any newer edit elsewhere, even just a comment on `main`, hides an older claim on a branch.
- **Your own claim elsewhere doesn't block you.** `claim` proceeds and writes a local claim instead of doing nothing.
- **A closed issue here is still refused as closed (exit 4)**, even if a newer version elsewhere is open.
- **Closed on an unmerged branch:** `ready`/`next` skip the issue (to cover the gap between an agent's close and the merge), but an explicit `claim` is allowed.
- **Blockers are judged by their local state only.**
- **Stale claims:** a claim left on an abandoned branch stays visible until the branch is deleted (`git branch -D`, or `git fetch --prune` for remote ones) or someone uses `claim --force`. This is documented.

\## Follow-ups noticed
- The web API and UI don't show `claimedElsewhere`; I left them out to avoid scanning on every request.
- `unclaim` still looks only at the local file, so you can't release someone's claim in another worktree from `main`. You'd have to `claim --force`, delete the branch, or unclaim inside that worktree.
- When the same identity claims an issue it already holds in another worktree, `claim` doesn't warn.
- `next --claim` scans twice (once to pick, once inside `claim`), which is cheap but redundant.
- Repos with many diverged remote branches mean more file versions to read on every `ls`.
