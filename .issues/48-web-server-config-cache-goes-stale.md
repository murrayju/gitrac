---
id: 48
title: Web server config cache goes stale
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T00:21:38.477Z'
---

`ctx.config` is read once at startup. CLI changes to `config.yaml` (new assignees from `claim`, label colors, git settings like `autoCommit`) are not seen by the server until restart; `GET /api/config` returns stale data and routes use stale git settings.

## Acceptance criteria

- Reload config when `config.yaml` changes (the watcher already watches `.issues/`), or read fresh per request.
- Emit an SSE event so the UI refreshes config.
