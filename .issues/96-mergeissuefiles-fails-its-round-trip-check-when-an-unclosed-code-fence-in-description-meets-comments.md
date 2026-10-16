---
id: 96
title: >-
  mergeIssueFiles fails its round-trip check when an unclosed code fence in
  description meets comments
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:12:42.686Z'
createdBy: Justin Murray
updated: '2026-10-16T14:13:07.317Z'
---

In `src/git/conflict.ts`, `mergeIssueFiles` merges frontmatter, description, and comments into `issue`, calls `serializeIssue(issue)`, and then checks `if (!same(parseIssue(content), issue))` (`throw new Error('the merged issue does not round-trip')`).

Two cases cause valid merges to fail this check and fall back to a raw line-based merge:

1. **Unclosed code fence + comment:** If `ours` edits `description` to end with an unclosed code fence (while `ours.comments` is empty, so `serializeIssue` did not auto-close the fence on `ours`), and `theirs` adds a comment (without changing `description`), the merged `issue` has `ours.description` and `theirs.comments`. `serializeIssue(issue)` (`src/core/issue.ts:297`) then appends a closing fence to `body` because `issue.comments.length > 0`. `parseIssue(content).description` now contains the closing fence while `issue.description` does not, so `same(parseIssue(content), issue)` returns `false`.
2. **Untrimmed merged description:** When both sides edit `description`, `description = merged.text.replace(/\n$/, '')` is not `.trim()`med, whereas `parseIssue(content).description` is trimmed. If the 3-way text merge leaves leading or trailing blank lines/whitespace, the round-trip check fails.

## Acceptance criteria

- Normalize the merged `issue.description` (trim surrounding whitespace, and close an unclosed code fence when `comments.length > 0`, matching what `serializeIssue` writes) before checking round-trip equality.
- Regression tests in `src/git/conflict.test.ts` covering both cases.
