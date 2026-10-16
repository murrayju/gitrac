---
id: 96
title: >-
  mergeIssueFiles fails its round-trip check when an unclosed code fence in
  description meets comments
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:12:42.686Z'
createdBy: Justin Murray
updated: '2026-10-16T19:10:05.019Z'
---

In `src/git/conflict.ts`, `mergeIssueFiles` merges frontmatter, description, and comments into `issue`, calls `serializeIssue(issue)`, and then checks `if (!same(parseIssue(content), issue))` (`throw new Error('the merged issue does not round-trip')`).

Two cases cause valid merges to fail this check and fall back to a raw line-based merge:

1. **Unclosed code fence + comment:** If `ours` edits `description` to end with an unclosed code fence (while `ours.comments` is empty, so `serializeIssue` did not auto-close the fence on `ours`), and `theirs` adds a comment (without changing `description`), the merged `issue` has `ours.description` and `theirs.comments`. `serializeIssue(issue)` (`src/core/issue.ts:297`) then appends a closing fence to `body` because `issue.comments.length > 0`. `parseIssue(content).description` now contains the closing fence while `issue.description` does not, so `same(parseIssue(content), issue)` returns `false`.
2. **Untrimmed merged description:** When both sides edit `description`, `description = merged.text.replace(/\n$/, '')` is not `.trim()`med, whereas `parseIssue(content).description` is trimmed. If the 3-way text merge leaves leading or trailing blank lines/whitespace, the round-trip check fails.

## Acceptance criteria

- Normalize the merged `issue.description` (trim surrounding whitespace, and close an unclosed code fence when `comments.length > 0`, matching what `serializeIssue` writes) before checking round-trip equality.
- Regression tests in `src/git/conflict.test.ts` covering both cases.

---

### Justin Murray — 2026-10-16T19:10:04.679Z

I fixed issue #96. Valid issue merges no longer fail the round-trip check in `mergeIssueFiles` and fall back to the raw line-based merge. The new tests, the full test suite (1277 tests), typecheck and lint all pass.

\## What was wrong
`mergeIssueFiles` (`src/git/conflict.ts`) builds the merged `issue`, writes it with `serializeIssue`, then throws if `parseIssue(content)` doesn't give back the same issue. Two valid cases failed this check:
1. **Open code fence plus a comment.** `ours` changed the description to end inside an open code fence and had no comments, so nothing closed the fence. `theirs` added a comment. The merged issue has comments, so `serializeIssue` adds a closing fence. The description read back from the file then has that extra fence line, but the in-memory `issue.description` does not.
2. **Untrimmed merged description.** When both sides change the description, the text merger's output only had its last newline removed. `parseIssue` trims the description, so blank lines or whitespace at either end failed the check.

\## What changed
- **`src/core/issue.ts`**
  - New exported `closeOpenFence(text)`: adds a closing fence line if `text` ends inside a code fence. `serializeIssue` now uses this helper instead of its own inline copy, so the two paths can't drift apart.
  - New exported `storedDescription(description, hasComments)`: returns the description as `parseIssue` reads it back after `serializeIssue`. It trims the text and, when there are comments, closes an open fence.
- **`src/git/conflict.ts`**: the merged comments are now computed first, so the description can be normalized based on whether there are comments. The round-trip check now compares like with like.

\## Tests added (`src/git/conflict.test.ts`)
- `ours` ends the description inside an open backtick fence and `theirs` adds a comment. The merge succeeds, the fence is closed, the comment is kept, and serializing the result gives the same file again.
- The text merger leaves an open `~~~~` fence while comments exist. The fence is closed with a matching `~~~~`.
- The text merger leaves blank lines and spaces around the result. The description comes back trimmed.

All three new tests fail without the source changes and pass with them. `src/git/merge-driver.test.ts` and the `src/core/` tests also pass.

\## Decisions
- The normalization helper is in `core/issue.ts`, next to the serializer and parser it copies, rather than being a re-implementation in `conflict.ts`.
- The fence is closed on the description before the serializer's escaping step rather than after. This gives the same result, because the escaping only adds a backslash to comment-header-like lines, and those are never fences.
- `./bun run lint` reports one warning, in `src/npm-package.test.ts`, a file I did not change.

**Orchestrator note:** renamed `normalizeDescription` to `storedDescription` (a function named `normalizeDescription` already exists in `src/core/description.ts`), and made `closeOpenFence` split lines with `splitLines` from #92 so it handles CRLF too.
