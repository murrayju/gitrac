---
id: 126
title: 'Web UI: detect and resolve duplicate issue IDs'
status: backlog
priority: medium
assignee: ''
labels:
  - feature
created: '2026-11-02T01:41:28.374Z'
createdBy: Justin Murray
updated: '2026-11-02T01:41:28.374Z'
---

Opening an issue whose ID has several files (e.g. two clones created the same ID) shows only a raw `API error 409 ... duplicate_issue` message in the web UI.

The web UI should make it easy to resolve this:

- Detect every duplicated ID when the UI loads (and again on each issue change); the server also warns at startup.
- Show the suggested renumbering: the oldest file (by `created`) keeps the ID, every other file gets the next free ID.
- A button applies it (`renumberIssue` per file, one commit each).
- A manual override: pick which file keeps the ID.
