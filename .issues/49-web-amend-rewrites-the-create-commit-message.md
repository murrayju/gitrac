---
id: 49
title: Web amend rewrites the create commit message
status: todo
priority: low
assignee: ''
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

After creating an issue in the web UI, subsequent edits amend the create commit and replace its message with `update #N ...`, so history no longer shows the issue being created. Same for comment → update sequences.

## Acceptance criteria

- When amending, keep the first operation's message (or combine, e.g. `create #N title (+ edits)`).
- Test the message after create + update.
