---
id: 104
title: 'Web UI: add search, label filter, mine filter, and dependency editing'
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-16T12:13:30.127Z'
createdBy: Justin Murray
updated: '2026-10-16T20:02:27.733Z'
---

The backend (`GET /api/issues`, `POST /api/issues/:id/link`, `POST /api/issues/:id/unlink`) and `src/web/ui/api.ts` already support `search`, `label`, and `mine` filters and link mutations, but the web UI does not expose them:

- `IssueList.tsx` and `filterStore.ts` only provide Status, Priority, and Assignee dropdowns (no search input, label filter, or "Mine" toggle).
- `DependenciesPanel.tsx` is read-only ("Edit links with `gitrac link` / `gitrac unlink`"), with no way to add or remove `blockedBy` or `parent` links in the browser.

## Acceptance criteria

- Add search input, label filter, and "Mine" filter to `IssueList.tsx` (persisted in `filterStore.ts`).
- Add UI controls in `DependenciesPanel.tsx` (or `MetadataPanel.tsx`) to add and remove `blockedBy` and `parent` links via `POST /api/issues/:id/link` and `/unlink`, surfacing validation/cycle errors cleanly.
- Tests.
