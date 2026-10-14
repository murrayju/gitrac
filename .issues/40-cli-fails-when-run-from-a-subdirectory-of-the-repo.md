---
id: 40
title: CLI fails when run from a subdirectory of the repo
status: todo
priority: high
assignee: ''
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

Commands call `getGitRoot(dir)` but discard the result, then build paths from `process.cwd()`. Running `gitrac ls` in any subdirectory crashes with a raw ENOENT stack trace.

## Acceptance criteria

- The project root is resolved via `git rev-parse --show-toplevel` (honoring `--dir` when given) once, in a shared helper used by every command and the server.
- Friendly error when not in a git repo or when `.issues/` isn't initialized ("run gitrac init").
- Tests running commands from a nested directory.
