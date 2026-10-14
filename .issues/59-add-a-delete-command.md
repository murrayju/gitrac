---
id: 59
title: Add a delete command
status: todo
priority: low
assignee: ''
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

There's no way to delete an issue (e.g. duplicates or test issues) besides `git rm`. Add `gitrac delete <id>` (with confirmation unless `--yes`) and a corresponding API route + UI action. Consider also cleaning up assets only referenced by the deleted issue.
