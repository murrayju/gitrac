---
id: 46
title: Structured errors and consistent exit codes for agents
status: todo
priority: medium
assignee: ''
labels:
  - enhancement
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

Errors are a mix of `console.error` strings and raw uncaught stack traces (e.g. simple-git errors, ENOENT). With `-o json` agents get unparseable output on failure.

## Acceptance criteria

- A single top-level error handler: human mode prints `Error: <message>`; json/yaml mode prints `{"error": {"code": "...", "message": "..."}}` to stderr (or stdout — document it).
- Distinct exit codes for not found, invalid input, conflict (e.g. already claimed), git failure.
- No raw stack traces unless `--debug`.
- Branch warnings should go to stderr only and not corrupt JSON stdout.
