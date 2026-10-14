---
id: 34
title: >-
  Web UI no-op amend detection runs git reset --hard and destroys uncommitted
  work
status: done
priority: urgent
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:01:06.227Z'
---

`AmendTracker.dropIfNoOp` (`src/git/amend-tracker.ts`) runs `git reset --hard HEAD~1` when an amended commit's net diff is only the `updated:` timestamp. `--hard` resets the **entire working tree and index**, discarding any uncommitted work in the repo, not just the issue file.

Verified: with an unrelated dirty `code.txt`, two web edits that net to a no-op reverted `code.txt` to its committed contents.

## Additional problems in the same function

- The diff check is over the entire commit; the "only updated: lines" heuristic would also match an `updated:` line inside a description or a code file.
- After dropping, the issue file on disk still has the newer timestamp and is now an uncommitted modification (or, with --hard, it gets reverted — either way state should be deliberate).

## Acceptance criteria

- Never use `reset --hard`. Use `reset --soft HEAD~1` (then unstage / restore only the issue files) or equivalent that only touches the files gitrac committed.
- Uncommitted and staged changes to unrelated files survive a drop.
- Only consider issue-frontmatter `updated:` lines in gitrac-managed files when deciding no-op.
- Regression test reproducing the data loss.

---

### Justin Murray — 2026-10-14T22:01:06.227Z

\## Fix #34: no-op amend detection no longer runs `git reset --hard`

**What was wrong**
In the web UI, every edit to an issue amends the same commit. If several edits cancelled each other out, `AmendTracker.dropIfNoOp` dropped the commit with `git reset --hard HEAD~1`. That reset the whole working tree and index, so any uncommitted or staged work anywhere in the repo was lost. The check for "nothing really changed" was also too loose. It diffed the entire commit and treated any `+/-updated:` line as harmless, wherever it appeared: in a description, in a code file, or in a file gitrac didn't commit.

**What changed**
- **Safer drop:** it now uses `git reset --soft HEAD~1`, which only moves HEAD. Then it runs `git restore --source=HEAD --staged --worktree` on just the files the dropped commit touched, putting them back to the parent's version. Other staged or unstaged changes, and untracked files, are left alone.
- **Stricter check:** `dropIfNoOp(dir, files)` now takes the list of files gitrac committed. A commit counts as a no-op only if:
  - every changed file is a modified (not added or deleted) `.md` file from that list, and
  - the old and new versions differ only in the top-level frontmatter `updated:` key.
- **New helper:** `differsOnlyInUpdated(before, after)` in `src/core/issue.ts` does that comparison. It ignores `updated:` lines in the body, indented YAML keys, and files without frontmatter. It's a pure function in core, in line with the layering rules.
- **Root commit:** dropping a root commit is refused instead of failing.
- **Resulting state:** after a drop, the issue file on disk matches HEAD (the older timestamp) and the tree is clean for that file. Before, it was either reverted by `--hard` or left as a stray change.

**Files**
- `src/git/amend-tracker.ts`: new drop logic; `commitOrAmend` passes `files` through.
- `src/core/issue.ts`: adds `differsOnlyInUpdated`.
- `src/git/amend-tracker.test.ts`: existing tests updated for the new signature, plus regression tests:
  - unstaged and untracked work survives a drop through `commitOrAmend` (this reproduces the data loss)
  - staged unrelated work stays staged
  - an `updated:` line in the description is not treated as a no-op
  - an `updated:`-only change in a file gitrac didn't manage blocks the drop
  - a root commit is not dropped
  - the issue file is restored after a drop

  Five of the new tests fail on the old code.
- `src/core/issue.test.ts`: unit tests for the helper.
- `docs/specs/2026-03-28-gitrac-design.md`: describes the no-op drop behaviour.

`./bun run check` passes (258 tests).

**Decisions and trade-offs**
- Paths are converted to repo-root-relative form with `realpath`, and restore uses `:(literal)` pathspecs, so unusual file names behave.
- `dropIfNoOp` already works on a per-file basis, so it stays compatible with path-limited commits (#35).
- Because `amend` still sweeps the whole index (#35), anything the user had staged before an amend lands in that commit. The drop is then correctly refused rather than losing that work. Once #35 lands, those staged changes will stay out of the commit and survive a drop as staged changes; a test already covers that case.

**Follow-ups noticed (not fixed)**
- After a drop, the route's JSON response still carries the newer `updated` value while the file on disk has the older one. The UI will resync through the file watcher, but the two briefly disagree. This is related to #45.
- `amend` (`git commit --amend`) commits the whole index, the same problem as #35; it needs the same path-limited fix there.
- Paths are worked out from `dir`, which assumes the server's `dir` is inside the repo. The subdirectory handling in #40 may affect this.
