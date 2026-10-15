---
id: 76
title: Rejected image uploads are not surfaced in the web UI
status: todo
priority: low
assignee: ''
labels:
  - bug
created: '2026-10-15T16:07:00.243Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:00.243Z'
---

Since #39, uploads reject SVG and files over 10 MiB (400/413), but the editor's image paste/drop handler only logs the failure to the console. The user sees nothing happen.

## Acceptance criteria

- Upload failures (unsupported type, too large, network/server error) show a visible, dismissible message near the editor with the server's error text.
- No placeholder or broken image is left in the document.
- Unit-test the error mapping where practical; UI build passes.
