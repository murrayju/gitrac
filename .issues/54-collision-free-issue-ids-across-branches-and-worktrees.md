---
id: 54
title: Collision-free issue IDs across branches and worktrees
status: todo
priority: medium
assignee: ''
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

IDs come from `nextId` in `config.yaml`. Two branches/worktrees that each create an issue will (a) conflict on `config.yaml` and (b) produce duplicate IDs. This is guaranteed when multiple agents work in parallel worktrees.

## Options (needs a decision)

1. Allocate from shared state in the git common dir (`$(git rev-parse --git-common-dir)/gitrac/next-id`) under a lock — fixes local worktrees, not separate clones.
2. Hash/random short IDs (like beads' `bd-a1b2`), optionally with a sequential display alias.
3. Keep sequential IDs but renumber on merge via the merge driver (rewrites references — fragile).

Recommendation: option 1 now (cheap, solves the multi-agent-on-one-machine case), and revisit option 2 if multi-clone use matters.
