---
id: 74
title: 'Linkify #N issue references in the web UI'
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-15T16:06:58.415Z'
createdBy: Justin Murray
updated: '2026-10-15T16:51:50.561Z'
---

The spec says cross-references use `#N` syntax, but the web UI renders `#3` as plain text in descriptions and comments.

## Acceptance criteria

- `#N` (word-boundary, not inside code spans/blocks or URLs/headings anchors) renders as a link to `/issues/N` in read-only markdown and comments. Show the issue title on hover if cheaply available from loaded data.
- The stored markdown is unchanged (rendering only). In the Tiptap editor, linkification must not alter the saved markdown.
- Unit tests for the matching rules.
