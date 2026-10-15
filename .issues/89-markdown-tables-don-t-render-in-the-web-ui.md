---
id: 89
title: Markdown tables don't render in the web UI
status: todo
priority: low
assignee: ''
labels:
  - enhancement
created: '2026-10-15T16:51:32.861Z'
createdBy: Justin Murray
updated: '2026-10-15T16:51:32.861Z'
---

Found by the #73 subagent. Tiptap's StarterKit has no table support, so markdown tables in descriptions and comments don't render as tables (and editing a description containing a table may mangle it on autosave).

## Acceptance criteria

- Add Tiptap's table extensions so GFM tables render in the editor, read-only markdown and comments.
- Round-trip check: a description containing a table, opened and saved in the editor without edits, produces identical markdown (or the editor doesn't save at all). Add a regression test for the markdown serializer.
- Prose table styles (from #73) apply.
