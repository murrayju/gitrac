---
id: 92
title: CRLF line endings in issue files swallow comments into the description
status: backlog
priority: high
assignee: ''
labels:
  - bug
created: '2026-10-16T12:12:37.943Z'
createdBy: Justin Murray
updated: '2026-10-16T12:12:37.943Z'
---

While frontmatter helpers (`topLevelBlocks`, `parseIssueFile`, `stripFrontmatterUpdated`, `parseIssueForMerge`) split on `/\r?\n/`, the body and comment parsers split on `'\n'`:

- `splitContent` and `transformAfterRules` in `src/core/issue.ts`
- `parseComments` and `transformLines` in `src/core/comments.ts`
- `scanFences` callers in `src/core/issue.ts`

When an issue file has CRLF (`\r\n`) line endings (e.g. on Windows, `core.autocrlf=true`, or edited by an external tool), every line retains a trailing `\r`. Because `.` in `COMMENT_HEADER_RE = /^### (.+?) \u2014 (.+)$/` (`src/core/comments.ts`) does not match `\r`, `COMMENT_HEADER_RE.test(line)` returns `false` and `findSeparator` returns `-1`.

As a result, `parseIssue` silently absorbs the `---` separator and all comments (including raw `\##` escaped headings) into `issue.description` and returns `comments: []`. Any subsequent write permanently bakes the comments into the description.

## Acceptance criteria

- `parseIssue`, `parseComments`, `unescapeDescription`, `unescapeCommentHeadings`, and `scanFences` handle CRLF (`\r\n`) input cleanly, producing the exact same parsed `Issue` (with LF-normalized `description` and `comments`) as LF input.
- Regression tests in `src/core/issue.test.ts` and `src/core/comments.test.ts` covering CRLF issue files with descriptions, horizontal rules, code fences, and comments.
