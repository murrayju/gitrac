---
id: 83
title: init assumes the default branch is main
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-15T16:07:06.399Z'
createdBy: Justin Murray
updated: '2026-10-15T16:51:52.304Z'
---

`gitrac init` always writes `git.defaultBranch: main`. Repos on `master` (or anything else) then get a "not on the default branch" warning on every `ls`/`show`/`ready`/`next` until the user edits config.

## Acceptance criteria

- `init` detects the default branch: `origin/HEAD` if set, else the current branch, else `init.defaultBranch` from git config, else `main`.
- Tests for each source.
