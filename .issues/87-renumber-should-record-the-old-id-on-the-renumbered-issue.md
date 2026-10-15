---
id: 87
title: renumber should record the old ID on the renumbered issue
status: todo
priority: low
assignee: ''
labels:
  - enhancement
created: '2026-10-15T16:07:10.107Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:10.107Z'
---

After `gitrac renumber`, old `#N` mentions in history and other issues still point at the original ID. Nothing on the moved issue records where it came from.

## Acceptance criteria

- `renumber` adds a comment to the renumbered issue (e.g. "Renumbered from #N (duplicate ID) by <author>"), in the same commit.
- JSON output unchanged apart from the issue now including the comment. Tests.
