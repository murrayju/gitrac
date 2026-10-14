---
id: 34
title: >-
  Web UI no-op amend detection runs git reset --hard and destroys uncommitted
  work
status: in_progress
priority: urgent
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:50:40.207Z'
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
