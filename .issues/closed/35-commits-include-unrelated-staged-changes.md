---
id: 35
title: Commits include unrelated staged changes
status: done
priority: urgent
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:12:30.109Z'
---

`commitIssueChange` (`src/git/operations.ts`) and `AmendTracker.amend` do `git add <files>` followed by a plain `git commit`, which commits the **entire index**. Anything the user (or another agent) had staged gets swept into the `issue:` commit.

## Repro

```bash
echo secret > code.txt && git add code.txt
gitrac comment 2 "hi"
git show --stat HEAD   # includes code.txt
```

## Acceptance criteria

- gitrac commits contain only the paths gitrac passed (use `git commit -- <paths>` / `--only` semantics, including for amend).
- Deleted/renamed paths (close, reopen, title change) still work — paths that no longer exist on disk must be handled (e.g. `git add -A -- <paths>` or `git rm --cached` as needed).
- Pre-existing staged changes remain staged and uncommitted afterwards.
- Regression tests for commit and amend.

---

### Justin Murray — 2026-10-14T22:12:30.109Z

\## Summary: issue commits now contain only the paths gitrac wrote (#35)

\### What was wrong
`commitIssueChange` (`src/git/operations.ts`) and `AmendTracker.amend` (`src/git/amend-tracker.ts`) ran `git add <files>` and then a plain `git commit` / `git commit --amend`. That commits the whole index, so anything the user or another agent had staged ended up in the `issue:` commit. The bug hit every CLI mutation, since they all go through `commitAndMaybePush`, and every web UI commit and amend.

\### What changed
- **New `commitPaths(dir, files, message, { amend? })` in `src/git/operations.ts`.** This is now the only place gitrac creates or amends a commit. `commitIssueChange` and `AmendTracker.amend` both call it.
  1. **Stage only gitrac's paths.** Paths that exist on disk are staged with `git add -A -- :(literal)<path>`.
  2. **Keep deletions and renames.** Paths missing from disk (old filename after close, reopen or a title change) are kept if git still knows them, checked with `git ls-files --error-unmatch --with-tree=HEAD`. That covers files still in the index and files already removed with `git rm`, so `--only` records the deletion.
  3. **Skip unknown paths.** Paths that don't exist and that git has never seen are dropped, so a stray path no longer makes the commit fail.
  4. **Commit just those paths.** The commit runs `git commit [--amend] --only <pathspecs>`, which builds the commit from HEAD plus only those paths. Other staged changes stay staged and are not committed.
  5. **Never fall back to a whole-index commit.** If no paths are left and this isn't an amend, it returns `null` without running `git commit` (a commit with no paths would take the whole index). An amend with no paths uses a bare `--only`, which rewrites only the message.
- **No other callers needed changes.** `AmendTracker.amend` now calls `commitPaths(..., { amend: true })`, so `commitAndMaybePush`, `commitOrAmend` and the web routes pick up the fix automatically.

\### Files
- `src/git/operations.ts`
- `src/git/amend-tracker.ts`
- `src/git/operations.test.ts` — 7 new regression tests: unrelated staged changes are left alone, rename/close with the old path deleted on disk, deletion already staged with `git rm`, unknown missing paths, the no-change case not committing the index, glob characters in paths, and the first commit in an empty repo.
- `src/git/amend-tracker.test.ts` — 2 new amend regression tests: unrelated staged changes are excluded, and a rename where the old path came from the commit being amended.
- `docs/specs/2026-03-28-gitrac-design.md`, `skills/using-gitrac/SKILL.md` — document the path-limited commit behaviour.

\### Decisions and trade-offs
- **Path handling:** pathspecs use `:(literal)` so glob characters in filenames are matched exactly.
- **Commit call:** I kept simple-git's `commit()` so the existing hash parsing and "nothing to commit → `null`" behaviour stay the same. simple-git puts the pathspecs before the flags and has no `--` separator. That is safe here because every pathspec starts with `:(literal)`.
- **Hooks:** with `--only`, pre-commit hooks see git's temporary partial index rather than the user's full index.
- **Changed `dropIfNoOp` test:** "does NOT drop when the commit touches a file gitrac did not manage" got its unrelated file into the commit by relying on the old sweep-the-index bug. It now amends that file in directly with git, so it still tests `dropIfNoOp`'s guard. All of `dropIfNoOp`'s #34 tests pass.

\### Verification
- All 9 new tests fail against the old `operations.ts` and `amend-tracker.ts`, and pass with the fix.
- `./bun run check` passes (267 tests).
- I ran init → create → stage `code.txt` → comment → edit title → close → reopen through the CLI in a scratch repo. Each commit held only its issue files (deletions and adds recorded correctly), and `code.txt` was still staged and uncommitted at the end.

\### Follow-ups noticed
- If a user has staged changes to the same issue file gitrac rewrites, those changes still go into the commit. That's expected, since it's gitrac's path.
