---
id: 33
title: Global --no-commit and --no-push flags are ignored
status: todo
priority: urgent
assignee: ''
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

Commander stores negated options under the positive name: `--no-commit` sets `opts().commit === false` and `--no-push` sets `opts().push === false`. Every command reads `globalOpts.noCommit` / `globalOpts.noPush`, which are never set.

As a result `gitrac close <id> --no-commit` still commits, which breaks the core "close the issue in the same commit as the fix" workflow documented in AGENTS.md and the skill. Project history shows this (e.g. `issue: close #32` committed separately before the feature commit).

`--no-push` only works by accident (`push: false` is passed through and `flags.push ?? autoPush` evaluates false).

## Repro

```bash
gitrac create -t First
gitrac close 1 --no-commit
git log --oneline   # shows "issue: close #1 First"
```

## Acceptance criteria

- `--no-commit` prevents commits for all mutating commands (create, edit, comment, close, reopen, claim, init)
- `--push` / `--no-push` behave per the spec (flag overrides `config.git.autoPush`)
- Option handling is centralized (one helper to read global opts) rather than repeated per command
- Tests that exercise the real Commander parsing (not just the helper functions)
