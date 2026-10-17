---
id: 112
title: Web metadata and title saves drop errors
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T21:58:39.311Z'
createdBy: Justin Murray
updated: '2026-10-17T13:22:50.900Z'
---

Found by #100. Comment saves and label toggles now show errors inline, but the status, priority and assignee dropdowns (`MetadataPanel`, `IssueRow`) and the title editor (`saveTitle` in `IssueDetail`) still drop failures as unhandled rejections. The comment conflict notice is also a `window.alert`.

## Acceptance criteria

- These saves use `trackRequest` (`src/web/ui/lib/request-state.ts`) and show a failure inline.
- The comment conflict notice is inline, like the description editor's.
- Tests for any new helper.
