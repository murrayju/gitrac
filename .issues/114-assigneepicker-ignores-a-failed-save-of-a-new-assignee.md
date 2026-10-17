---
id: 114
title: AssigneePicker ignores a failed save of a new assignee
status: backlog
priority: low
assignee: ''
labels:
  - bug
created: '2026-10-17T13:46:17.070Z'
createdBy: Justin Murray
updated: '2026-10-17T13:46:17.070Z'
---

Found by #109. `handleCreate` in `src/web/ui/components/AssigneePicker.tsx` swallows an `updateAssignees` failure (e.g. the 400 for a name with an em dash, added in #109) and still sets the new email as the assignee. The user gets no feedback, and the issue gets an assignee that is not in the config.

## Acceptance criteria

- On failure, show the server's message inline in the new-assignee form, keep the form open with the typed values, and do not change the issue's assignee.
