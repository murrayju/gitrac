---
id: 87
title: renumber should record the old ID on the renumbered issue
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-15T16:07:10.107Z'
createdBy: Justin Murray
updated: '2026-10-15T19:33:33.996Z'
---

After `gitrac renumber`, old `#N` mentions in history and other issues still point at the original ID. Nothing on the moved issue records where it came from.

## Acceptance criteria

- `renumber` adds a comment to the renumbered issue (e.g. "Renumbered from #N (duplicate ID) by <author>"), in the same commit.
- JSON output unchanged apart from the issue now including the comment. Tests.

---

### Justin Murray — 2026-10-15T19:33:33.996Z

**What was wrong**

After `gitrac renumber`, the moved issue kept no record of its old ID. Old `#N` mentions in git history and in other issues still point at the original ID, so nothing linked them to the moved issue.

**What changed**

- `renumberIssue` in `src/service/renumber.ts` now adds a comment to the renumbered issue when it rewrites its `id` and bumps `updated`.
  - The comment uses the context's identity as author (`--author`/git `user.name` on the CLI, the server identity on the web).
  - Its timestamp equals the new `updated`.
  - Text: `Renumbered from #<old> (duplicate ID).`, or `Renumbered from #<old>.` when a non-duplicated ID is renumbered with `--force`.
- The comment is in the same file write and the same `issue: renumber #<old> -> #<new> <title>` commit. No other paths are added.
- The returned/JSON `issue` now includes the comment. The rest of the JSON output is unchanged.
- I exported a small helper, `renumberedComment(oldId, duplicated)`, which builds the comment text.

**Tests** (both fail without the fix)

- `src/service/renumber.test.ts`:
  - The renumbered file and `result.issue` carry the comment, with author `Ada` and timestamp equal to `updated`.
  - Existing comments are kept and the new one goes last.
  - With `force` on a non-duplicate, the comment leaves out "(duplicate ID)".
- `src/cli/commands/renumber.test.ts`:
  - The `-o json` `issue.comments` includes the comment (author `Alice`).
  - The file on disk has it and the working tree is clean, which shows it was in the renumber commit.

`./bun run check` passes. One earlier run had a single simple-git failure, most likely from load caused by the other agents running at the same time; the next full run passed with 1189 tests and 0 failures.

**Docs**

- `docs/specs/2026-03-28-gitrac-design.md` (Renumbering): describes the comment.
- `skills/using-gitrac/SKILL.md` (command table): mentions the comment.

**Decisions / trade-offs**

- The comment has no "by <author>" in its text, because the comment header already shows the author.
- The "(duplicate ID)" wording appears only when the ID really was duplicated, so a `--force` renumber isn't described wrongly.
- The comment body contains `#<old>`. If the remaining copy of the old ID is renumbered later, the reference scan will list this issue under "mentions #<old>". That is accurate, since it is related to the old ID, but it is a new source of mentions.

**Follow-ups noticed:** none.
