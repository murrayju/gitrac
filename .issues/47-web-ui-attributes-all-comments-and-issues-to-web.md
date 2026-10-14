---
id: 47
title: Web UI attributes all comments and issues to "web"
status: todo
priority: medium
assignee: ''
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

The web server hard-codes `createdBy: 'web'` and defaults comment `author` to `'web'`; the UI never sends an author. Issue history loses who did what.

## Acceptance criteria

- Server resolves the default identity from `git config user.name`/`user.email` at startup (refresh when config changes), and uses it for `createdBy` and comment authors.
- Optionally allow choosing an identity from `config.assignees` in the UI.
