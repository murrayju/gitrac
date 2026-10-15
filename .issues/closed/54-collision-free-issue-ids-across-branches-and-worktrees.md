---
id: 54
title: Collision-free issue IDs across branches and worktrees
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T01:45:40.508Z'
---

IDs come from `nextId` in `config.yaml`. Two branches/worktrees that each create an issue will (a) conflict on `config.yaml` and (b) produce duplicate IDs. This is guaranteed when multiple agents work in parallel worktrees.

## Options (needs a decision)

1. Allocate from shared state in the git common dir (`$(git rev-parse --git-common-dir)/gitrac/next-id`) under a lock — fixes local worktrees, not separate clones.
2. Hash/random short IDs (like beads' `bd-a1b2`), optionally with a sequential display alias.
3. Keep sequential IDs but renumber on merge via the merge driver (rewrites references — fragile).

Recommendation: option 1 now (cheap, solves the multi-agent-on-one-machine case), and revisit option 2 if multi-clone use matters.

---

### Justin Murray — 2026-10-15T01:45:40.508Z

Issue #54: issue IDs no longer collide across worktrees and branches, and creating an issue no longer writes `config.yaml`. `./bun run check` passes (717 tests). I didn't run the new tests against the old code; they test ID sources the old code never looked at, so they should fail without the fix.

**What was wrong**
IDs came from the `nextId` counter in `.issues/config.yaml`. Every create bumped it and committed `config.yaml`, so two branches or worktrees that each created an issue got the same ID and also conflicted on `config.yaml` when merged. Checking the highest issue file ID only helped within one checkout.

**What changed**
- **New `src/git/ids.ts` with `allocateIssueId`**, which runs under the repo lock that create already holds. The new ID is one higher than the largest of:
  1. a shared counter in `$(git rev-parse --git-common-dir)/gitrac/next-id`, used by every worktree. It stores the next free ID and is written atomically (temp file, then rename).
  2. the issue files in `.issues/` and `.issues/closed/` in the working tree.
  3. the issue files on every ref (local branches, remote-tracking branches, tags) and `HEAD`. This always takes three git processes however many refs there are, about 30 ms on this repo. It works in SHA-1 and SHA-256 repos and returns 0 if git fails.
  4. the old `nextId` in `config.yaml`, if present. It is read but never written.
- **Create no longer commits `config.yaml`** (`src/service/issues.ts`) unless new labels had to be added to it.
- **Config** (`src/core/types.ts`, `src/core/config.ts`): `nextId` is now optional (it must still be a number if present), and `init` no longer writes it.
- `allocateNextId` is removed from `src/fs/issue-store.ts`, and `gitCommonDir` is now exported from `src/git/lock.ts`.

**Decisions and trade-offs**
- **An existing `nextId` is kept, not removed, on later config writes.** Nothing bumps it any more, so it can't cause merge conflicts. Removing it could let other clones that still depend on it reuse IDs; users can delete it by hand.
- **The shared counter means an ID is never reused on this machine**, even if its issue file was deleted. As before, an ID can be used up if something fails after allocation.
- **Outside a git repo, only the working-tree files and the old `nextId` are used.** So deleting the newest issue file there lets its ID be reused.
- **I read the git output with `arrayBuffer()` instead of `bytes()`**, because Bun 1.3's `Response.bytes()` sometimes returned an `ArrayBuffer`, which made the ID scan silently return 0.

**Known limitation (documented):** work in another clone that hasn't been fetched yet can still get the same ID. This is left to the merge driver in #53.

**Tests**
- New `src/git/ids.test.ts`:
  - two worktrees plus the main checkout creating issues through the CLI, partly in parallel, get distinct IDs; `config.yaml` doesn't change and the branches merge without conflicts
  - a higher ID on a branch that isn't checked out (open or closed) is respected, and so is one on a remote-tracking branch
  - an old `nextId` sets the floor and is not bumped
  - a deleted issue's ID is not reused
  - a corrupt counter file is ignored; SHA-256 repos and directories outside git work
- Service tests: create leaves `config.yaml` alone unless new labels are added; old `nextId` is respected.
- Config tests: `nextId` is optional but must be a number.
- The CLI and web concurrency tests now check the shared counter instead of `nextId`.

**Docs:** in `docs/specs/2026-03-28-gitrac-design.md`, the "Issue ID Scheme" section is rewritten and the `config.yaml` example and write-validation text are updated. `skills/using-gitrac/SKILL.md` now explains how IDs are allocated across worktrees and branches, and recommends `git fetch` when others work in separate clones.

**Overlap with other issues**
- **#63:** I only removed `allocateNextId` from `src/fs/issue-store.ts`; it doesn't touch `findIssueFile`.
- **#53 (merge driver):** it should treat `.git/gitrac/next-id` as local, uncommitted state, and handle renumbering when two clones collide.

**Files:** `src/git/ids.ts` (new), `src/git/ids.test.ts` (new), `src/git/lock.ts`, `src/fs/issue-store.ts`, `src/service/issues.ts`, `src/core/config.ts`, `src/core/types.ts`, the updated tests listed above, `docs/specs/2026-03-28-gitrac-design.md`, `skills/using-gitrac/SKILL.md`.
