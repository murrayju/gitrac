---
id: 20
title: Polish new issue modal ux
status: in_progress
priority: medium
assignee: Justin Murray
labels:
  - enhancement
created: '2026-03-30T00:17:28.574Z'
createdBy: web
updated: '2026-03-30T01:20:20.087Z'
---

I'd like to give the new issue modal a more polished look and feel. Here's the Linear modal, for reference:

![image.png](/api/issues/assets/oU6loS-SP2_5R3pzXo0Q5.png)Things I like:

- Lack of border around title and description

- Pills at bottom for status, priority, assignee, labels (all optional)

- Rounded submit button

- Button for attachments (via file dialog)

- Lack of "New Issue" title on the modal

- Larger border radius on modal

- Lack of cancel button (x is sufficient)

- Same label picker as on issue page. Multiple labels collapse in the pill, are shown on hover

  ![image.png](/api/issues/assets/qu-uqmewqJBbRoIWk69dl.png)

![image.png](/api/issues/assets/EnBeimmxbO-5A3-rd_qpe.png)Here is our modal, for reference

![image.png](/api/issues/assets/IW0COsqnvKt7RMRWxzops.png)

---

### Justin Murray — 2026-03-30T01:20:20.087Z

Redesigned the CreateIssueModal with a Linear-inspired look and feel.

Changes to CreateIssueModal.tsx:
- Removed 'New Issue' header, replaced with just a close (x) SVG button in top-right
- Borderless title input (no underline/border, clean large placeholder text)
- Borderless description editor via new borderless prop on IssueEditor
- Bottom pill bar with status (StatusBadge+Dropdown), priority (PriorityBadge+Dropdown), assignee (new AssigneePill component with click-to-edit), labels (LabelPicker with smart collapse: 0 labels shows icon pill, 1 shows badge, 2+ shows count with hover tooltip)
- Paperclip attachment button opens file dialog, uploads via uploadAsset, inserts into editor
- Rounded submit button (rounded-full)
- Removed Cancel button (x is sufficient)
- Larger border radius on modal (rounded-xl)
- Removed all section labels (Priority, Assignee, etc.)
- Added status field (defaults to config.defaultStatus)

Changes to IssueEditor.tsx:
- Converted to forwardRef with IssueEditorHandle interface exposing insertImage(url, alt)
- Added borderless prop to remove border/background wrapper
- Backward-compatible with existing IssueDetail usage

Files affected: src/web/ui/components/CreateIssueModal.tsx, src/web/ui/components/IssueEditor.tsx
