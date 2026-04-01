---
id: 29
title: cmd+enter should submit
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-04-01T17:13:17.734Z'
createdBy: web
updated: '2026-04-01T18:20:03.057Z'
---

When creating a new issue or writing a comment, pressing cmd+enter should submit.

---

### Justin Murray — 2026-04-01T18:19:43.904Z

Added Cmd+Enter (Ctrl+Enter on non-Mac) keyboard shortcut to submit in all editor contexts.

**Changes:**
- src/web/ui/components/CommentEditor.tsx — Added Tiptap SubmitShortcut extension that triggers comment submission on Mod+Enter
- src/web/ui/components/CommentList.tsx — Added same SubmitShortcut to InlineCommentEditor (for editing existing comments)
- src/web/ui/components/CreateIssueModal.tsx — Extended keydown handler to submit the form on Cmd+Enter, added formRef

Uses Tiptap's Mod-Enter shortcut (Cmd on Mac, Ctrl on Windows/Linux) for editors, and a document-level keydown listener for the create modal.
