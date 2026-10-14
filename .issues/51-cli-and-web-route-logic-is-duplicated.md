---
id: 51
title: CLI and web route logic is duplicated
status: todo
priority: medium
assignee: ''
labels:
  - chore
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

Every CLI command and web route re-implements: find issue, read, mutate, compute old/new paths across `.issues/` and `closed/`, write, delete old file, collect paths, commit, push. The duplication is the root cause of several inconsistencies (reopen status, which files are committed, validation, author resolution).

## Acceptance criteria

- Introduce a service layer (e.g. `src/service/`) with operations like `createIssue`, `updateIssue`, `addComment`, `closeIssue`, `reopenIssue`, `claimIssue` that take a context (root dir, config, identity, commit options) and return the result + changed paths.
- CLI commands and web routes become thin adapters.
- Locking, validation and commit logic live in one place.

Best done after the critical bug fixes, and it will make subsequent features much simpler.
