---
id: 56
title: Cross-worktree claim visibility for parallel agents
status: todo
priority: medium
assignee: ''
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

Subagents typically work in separate git worktrees. Each worktree has its own checkout of `.issues/`, so a claim made in one worktree is invisible to the others until merged — defeating the purpose of claims.

## Options (needs a decision)

1. **Single writer**: orchestrator in the main worktree owns all `.issues/` mutations; subagents only write code. Document this pattern in the skill / work-backlog command. (No code change, but no protection either.)
2. **Shared claim registry** in the git common dir (`$(git rev-parse --git-common-dir)/gitrac/claims.json`) that `claim`/`ready`/`ls` consult in addition to the file, so all local worktrees see claims instantly. The file-level assignee/status still lands in the branch commit.
3. Store issue state on a dedicated ref (e.g. `refs/gitrac/`) like git-bug — larger redesign; conflicts with "close in the same commit as the fix".

Recommendation: 2, plus documenting 1.
