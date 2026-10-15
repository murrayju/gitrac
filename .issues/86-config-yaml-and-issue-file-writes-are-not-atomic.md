---
id: 86
title: config.yaml and issue file writes are not atomic
status: todo
priority: low
assignee: ''
labels:
  - bug
created: '2026-10-15T16:07:09.213Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:09.213Z'
---

`writeConfig` and the issue writers use plain `writeFile`. A reader without the lock (web GETs, `ls`) can observe a half-written file, and a crash mid-write corrupts it.

## Acceptance criteria

- Config and issue writes go through write-to-temp-in-same-dir + `rename`, preserving the existing rename semantics of `relocateIssue` (#63/#71).
- Temp files never match `*.md` / `config.yaml` (so they're never listed or committed) and are cleaned up on failure.
- Tests.
