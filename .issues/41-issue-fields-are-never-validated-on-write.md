---
id: 41
title: Issue fields are never validated on write
status: todo
priority: high
assignee: ''
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

`validateIssue()` exists but is never called. Both the CLI and web API accept arbitrary values:

- `gitrac edit 2 -s bogus` writes `status: bogus`
- invalid priorities, empty titles, non-array labels (API) are accepted
- the API trusts the request body types entirely

## Acceptance criteria

- All create/update paths (CLI + web) validate status, priority, title, labels and types before writing; invalid input yields a clear error (CLI exit code 1, HTTP 400) and no file change.
- Unknown labels: CLI behaves like the web (auto-register with a color in config) or warns — pick one consistently and document it.
- Tests for the rejection paths.
