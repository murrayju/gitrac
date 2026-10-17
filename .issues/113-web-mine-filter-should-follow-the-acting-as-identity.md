---
id: 113
title: Web "Mine" filter should follow the Acting as identity
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-16T21:58:40.487Z'
createdBy: Justin Murray
updated: '2026-10-17T13:22:52.088Z'
---

Found by #104. The list's "Mine" checkbox sends `mine=1`, which the server resolves to its own git identity, not the identity picked in the sidebar's "Acting as" picker.

## Acceptance criteria

- `GET /api/issues` accepts an explicit identity for `mine` (e.g. `mine=<configured assignee name>`, validated against `config.assignees`), and the UI sends the acting identity.
- Tests.
