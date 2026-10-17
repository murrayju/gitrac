---
id: 109
title: Validate assignee names and serve --author like comment authors
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T21:58:36.141Z'
createdBy: Justin Murray
updated: '2026-10-17T13:22:47.908Z'
---

Found by #98. Author names are now checked (`authorError`: no line breaks, no em dash), but two inputs that become authors are not:

- `PATCH /api/config/assignees` (`updateAssignees`) accepts names and emails with line breaks or an em dash. The web "Acting as" picker can then send such a name, and the write fails later with a 400.
- `gitrac serve --author <name>` is not checked at startup; a bad value fails on every write.

## Acceptance criteria

- `updateAssignees` rejects bad names/emails with `invalid_input` (HTTP 400), using the same helper.
- `serve --author` with a bad name fails at startup with exit 2.
- Tests.
