---
id: 98
title: >-
  Validate title, assignee, labels, and author against newlines and
  comment-header delimiters
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:12:44.936Z'
createdBy: Justin Murray
updated: '2026-10-16T19:28:10.908Z'
---

`validateIssueFields` (`src/core/validate.ts`) and `resolveAuthor` (`src/service/context.ts`) only check `typeof === 'string'` and `.trim()`, allowing `\r` and `\n` in `title`, `assignee`, `labels`, and `author`, as well as ` — ` (`\u2014`) in `author`:

- If `--author` (or `author` in `POST /api/issues/:id/comments`) contains a newline, `serializeComments` writes a multi-line `### ...` header that fails `COMMENT_HEADER_RE` on read-back; if it is the first comment on the issue, `findSeparator` fails and the comment is silently absorbed into `description`.
- If `author` contains ` — ` followed by text, `COMMENT_HEADER_RE` (`/^### (.+?) \u2014 (.+)$/`) splits the author name at the first ` — ` and corrupts `author` and `timestamp` on read-back.
- If `title`, `assignee`, or `labels` contain newlines, it breaks `gitrac ls` table formatting and injects extra lines into auto-generated git commit subjects.

## Acceptance criteria

- Reject `\r` and `\n` in `title`, `assignee`, `labels`, and `author` with `invalid_input` (CLI exit 2, HTTP 400).
- Reject ` — ` (`\u2014`) in `author` (or ensure comment headers round-trip unambiguous author names) so a comment can never fail to parse its header on read-back.
- Add unit, service, CLI, and web validation tests.
