---
id: 50
title: CLI reopen hard-codes backlog instead of config.defaultStatus
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T00:21:40.272Z'
---

`src/cli/commands/reopen.ts` sets `status = 'backlog'` while the web route uses `config.defaultStatus`. Make them consistent (use `defaultStatus`), and consider `reopen -s <status>`.

Also: remove the leftover test label `foo` from `.issues/config.yaml`.
