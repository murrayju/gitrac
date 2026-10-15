---
id: 81
title: init does not gitignore web UI drafts
status: todo
priority: medium
assignee: ''
labels:
  - bug
created: '2026-10-15T16:07:04.696Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:04.696Z'
---

The web UI saves new-issue drafts to `.issues/drafts/*.json` (untracked). This repo's own `.gitignore` excludes them, but `gitrac init` doesn't set that up for other projects. The documented `git add -A && git commit` workflow then commits drafts.

## Acceptance criteria

- `gitrac init` writes `.issues/.gitignore` containing `drafts/` and commits it. `install-merge-driver` or another idempotent path ensures existing projects get it (or document a one-time step; prefer automatic).
- Lock/temp files gitrac might create under `.issues/` are also covered if any.
- This repo's `.issues/` gets the file too (orchestrator will commit it).
- Tests.
