---
id: 92
title: CRLF line endings in issue files swallow comments into the description
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:12:37.943Z'
createdBy: Justin Murray
updated: '2026-10-16T19:09:11.759Z'
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

---

### Justin Murray — 2026-10-16T19:09:11.238Z

Issue #92 is fixed: an issue file with CRLF line endings now parses to exactly the same `Issue` as the LF version. Description and comment text come back with LF endings, and comments stay separate from the description. All checks pass: `./bun test src/core/` (315 tests), the full suite (1284 tests), `./bun run typecheck` and `./bun run lint`. Lint shows one warning, but it was already there in `src/npm-package.test.ts`, which I didn't touch.

\## What was wrong
The frontmatter helpers already split lines on `/\r?\n/`, but the body and comment parsers split on `'\n'`. With CRLF input, every line kept a trailing `\r`. The `.` in `COMMENT_HEADER_RE` doesn't match `\r`, so no line was seen as a comment header and no separator was found. `parseIssue` then returned the whole body, including the `---`, the comment headers and the escaped `\##` headings, as the description, with `comments: []`.

There was a second problem in the same area: `openFence` didn't recognize a fence opener like ` ```\r` (its `(.*)$` doesn't match `\r`). That would have broken fence detection for any caller passing lines that still end in `\r`.

\## What changed
- **New `src/core/lines.ts`**: a `splitLines(text)` helper that splits on `/\r?\n/`. Every line-based parser in core now uses it, so CRLF handling is the same everywhere.
- **`src/core/issue.ts`**: `splitContent`, `transformAfterRules` (and so `escapeDescription` / `unescapeDescription`), the `scanFences` call in `serializeIssue`, `topLevelBlocks` and `stripFrontmatterUpdated` all use `splitLines`. When there is no comment separator, `splitContent` now joins the split lines back with `\n` instead of trimming the raw content, so that path returns LF text too.
- **`src/core/comments.ts`**: `parseComments` and `transformLines` (and so `escapeCommentHeadings` / `unescapeCommentHeadings`) use `splitLines`.
- **`src/core/fences.ts`**: `openFence` ignores a trailing `\r`. `closesFence` already handled it.

\## Tests added
- **`src/core/issue.test.ts`**, new `CRLF line endings` block. Each case parses the CRLF form of a file and checks it matches the LF parse exactly, with no `\r` left in the description or comment bodies. Cases:
  - a full issue with comments
  - issues with no comments, and with an empty description
  - horizontal rules, including an escaped header-like line after a rule
  - code fences (backtick, tilde, indented) that hide separator-like text
  - an unclosed fence that gets closed before the comments
  - frontmatter with `parent`, `blockedBy` and an unknown key, where rewriting the parsed issue gives LF output
  - `scanFences` on lines ending in `\r`

  The existing round-trip test, which runs 3000 seeded random issues, now also checks that the CRLF version of each one parses to the same `Issue`.
- **`src/core/comments.test.ts`**, new `CRLF line endings` block: `parseComments` on CRLF input with escaped headings, rules and fenced header-like lines; serialize then CRLF then parse; and `unescapeCommentHeadings` turning CRLF into LF.

\## Notable decisions
- **Writes stay LF.** Parsing normalizes to LF and `serializeIssue` writes LF, so rewriting a CRLF file turns it into an LF file. Git's own `core.autocrlf` handling can still convert endings on checkout.
- **Defensive fence check.** The `openFence` change isn't needed for the CRLF path anymore, since lines are split cleanly first. I kept it so that callers passing raw lines can't hit the same failure.
