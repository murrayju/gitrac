---
id: 30
title: Add hotkey to create new issue
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-04-01T17:20:22.721Z'
createdBy: web
updated: '2026-04-01T18:22:15.664Z'
---

Pressing `c` should open the new issue modal

---

### Justin Murray — 2026-04-01T18:22:15.664Z

Added global 'c' hotkey to open the create issue modal.

**Changes:**
- src/web/ui/components/Layout.tsx — Added a document-level keydown listener that opens the create issue modal when 'c' is pressed. The hotkey is suppressed when focus is in an input, textarea, select, or contentEditable element (to avoid interfering with typing). Also stabilized openCreateModal with useCallback.

The hotkey only fires when no modifier keys are held (Cmd/Ctrl/Alt) and the modal is not already open.
