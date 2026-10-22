---
id: 124
title: Web sync fails when remotes share push URLs
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-22T20:00:41.632Z'
createdBy: Justin Murray
updated: '2026-10-22T20:08:10.538Z'
---

Reported from the web UI: clicking Sync showed `git failed for deepthought: files './objects/tmp_objdir-incoming-.../pack-....keep' and './objects/pack/pack-....keep' differ in contents` and `origin has new commits on main that are not here, so the push was rejected`, although both pushes were accepted (both remote-tracking refs were updated by push).

Cause: in this clone both `origin` and `deepthought` have two `pushurl`s (GitHub and deepthought), so `git push <remote>` pushes to both servers. `pushAll` in `src/service/sync.ts` pushes to every remote in parallel, so each server got two concurrent pushes of the same commit: deepthought's second receive-pack collided with the first one's `.keep` file, and GitHub refused the second ref update (compare-and-swap), which `pushBranch` reported as rejected.

## Acceptance criteria

- Sync pushes one remote at a time, so overlapping push URLs see "up to date" instead of racing.
- `pushBranch` judges the result by git's porcelain status per ref and URL: a non-zero exit where every URL accepted the ref is a success; any `!` line is a rejection (naming the URL).
- Regression test with two remotes that share push URLs.

---

### Justin Murray — 2026-10-22T20:08:10.538Z

**What was wrong:** in this clone both `origin` and `deepthought` have two `pushurl`s (GitHub and deepthought), so `git push <remote>` pushes to both servers. The web sync pushed to every included remote in parallel, so each server got two concurrent pushes of the same commit:
- deepthought: the second receive-pack found the first one's `.keep` file for the identical pack ("files ... differ in contents");
- GitHub: the second ref update lost the compare-and-swap, which `pushBranch` reported as "origin has new commits on main ... rejected".
Both pushes had in fact landed (both remote-tracking refs were updated by push at 15:52:41/42), so the errors were wrong and nothing was damaged.

**What changed:**
- `pushAll` (`src/service/sync.ts`) pushes one remote at a time. With shared push URLs the later push now reports "up to date".
- `pushBranch` (`src/git/remotes.ts`) judges the result by `git push --porcelain` per URL (new pure `parsePushPorcelain` / `pushAcceptedEverywhere` in `src/core/sync.ts`): any `!` line is a rejection; a non-zero exit where every push URL of the remote (`git remote get-url --push --all`) reported the ref as accepted is a success (a server can print an error after it took the ref). It counts URLs instead of comparing them, because git hides credentials in the URLs it prints; when anything doesn't line up it falls back to the old classification. No status lines still means "pushed", as before.
- Spec: the Sync paragraph describes both rules.

**Tests:** a regression test in `src/service/sync.test.ts` gives two remotes the same two push URLs (two bare repos) and syncs five times; before the fix it failed on the first sync with exactly the reported "backup has new commits on main ... rejected" message, after it passes (3 runs). Unit tests for the porcelain parser (two `To` blocks, a rejection, empty output) and the accepted-everywhere rule (missing URL block, a `!` line, no lines). Core, git, service and web route suites pass (1109 tests).
