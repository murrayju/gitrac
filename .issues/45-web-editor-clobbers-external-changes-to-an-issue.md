---
id: 45
title: Web editor clobbers external changes to an issue
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T23:11:56.703Z'
---

The Tiptap editor's `content` is only used at mount. When the file changes externally (CLI, agent, git pull) the SSE refetch updates `issue`, but the editor still shows old text, and the next debounced autosave PATCHes the stale description back — silently reverting the external change.

The API has no optimistic concurrency at all: PATCH is last-writer-wins.

## Acceptance criteria

- PATCH accepts a base version (e.g. `updated` timestamp or content hash / ETag via `If-Match`) and returns 409 on mismatch.
- UI: when an external change arrives and the editor isn't dirty, update editor content; if dirty, show a conflict notice rather than overwriting.
- Tests for the 409 path.
