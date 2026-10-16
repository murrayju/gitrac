---
id: 100
title: 'Web UI: fix comment edit/conflict handling and rapid label toggle race'
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:13:25.851Z'
createdBy: Justin Murray
updated: '2026-10-16T20:02:26.580Z'
---

Several UI state and concurrency bugs in `CommentList.tsx` and `MetadataPanel.tsx`:

1. **`InlineCommentEditor.handleSave` (`src/web/ui/components/CommentList.tsx:161`):** calls `onSave(md)` without `await` (and types `onSave` as `(body: string) => void`), so `setSaving(false)` runs immediately before the request completes and non-`ConflictError` rejections go unhandled.
2. **`CommentItem` conflict handling (`src/web/ui/components/CommentList.tsx:215, 225`):** when `updateComment` or `deleteComment` throws `ConflictError`, it alerts *"This issue was changed elsewhere since it was loaded. The latest version is now shown; please try again."* without calling `applyIssue(e.current, e.version)` or `refetch()`. Also, the React key `${comment.author}-${comment.timestamp}` can collide if two comments by the same author have the same timestamp; include the index.
3. **Rapid label toggle race (`src/web/ui/components/MetadataPanel.tsx:32-44`):** `handleToggleLabel` and `handleCreateLabel` compute `newLabels` from `issue.labels` props without optimistic state or `If-Match`. Clicking two checkboxes in `LabelPicker` before the first SSE refetch arrives causes the second `PATCH` to overwrite the first toggle.

## Acceptance criteria

- `InlineCommentEditor` awaits `onSave(md)`, keeps `saving` true until completion, and surfaces save errors instead of dropping them.
- `CommentList` updates the issue state (`applyIssue(e.current, e.version)`) when a `ConflictError` occurs on comment edit/delete.
- `MetadataPanel` avoids losing rapid label toggles (and/or guards metadata updates against stale props).
- Tests.
