---
id: 67
title: create with a closed status writes the issue into .issues/ instead of closed/
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T13:15:02.879Z'
createdBy: Justin Murray
updated: '2026-10-15T13:15:17.006Z'
---

`gitrac create -t x -s done` (and `POST /api/issues` with a closed `status`) writes the new file into `.issues/` rather than `.issues/closed/`, leaving a half-closed issue (closed status, open directory).

## Acceptance criteria

- Creating an issue with a closed status (per the configurable workflow from #57) writes it directly into `.issues/closed/` and commits that path.
- Same behavior for CLI and web (service layer).
- Tests for both surfaces.
