---
id: 124
title: Web sync fails when remotes share push URLs
status: backlog
priority: high
assignee: ''
labels:
  - bug
created: '2026-10-22T20:00:41.632Z'
createdBy: Justin Murray
updated: '2026-10-22T20:00:41.632Z'
---

Reported from the web UI: clicking Sync showed `git failed for deepthought: files './objects/tmp_objdir-incoming-.../pack-....keep' and './objects/pack/pack-....keep' differ in contents` and `origin has new commits on main that are not here, so the push was rejected`, although both pushes were accepted (both remote-tracking refs were updated by push).

Cause: in this clone both `origin` and `deepthought` have two `pushurl`s (GitHub and deepthought), so `git push <remote>` pushes to both servers. `pushAll` in `src/service/sync.ts` pushes to every remote in parallel, so each server got two concurrent pushes of the same commit: deepthought's second receive-pack collided with the first one's `.keep` file, and GitHub refused the second ref update (compare-and-swap), which `pushBranch` reported as rejected.

## Acceptance criteria

- Sync pushes one remote at a time, so overlapping push URLs see "up to date" instead of racing.
- `pushBranch` judges the result by git's porcelain status per ref and URL: a non-zero exit where every URL accepted the ref is a success; any `!` line is a rejection (naming the URL).
- Regression test with two remotes that share push URLs.
