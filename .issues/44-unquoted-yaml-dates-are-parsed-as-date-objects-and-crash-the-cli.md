---
id: 44
title: Unquoted YAML dates are parsed as Date objects and crash the CLI
status: todo
priority: medium
assignee: ''
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

gray-matter's YAML engine converts unquoted ISO timestamps (`created: 2026-03-28T12:00:00Z` — exactly as shown in AGENTS.md and the design spec) into `Date` objects. `gitrac ls` then crashes in `shortDate` calling `.slice` on a Date, and JSON output shape changes.

Also note gray-matter caches parse results keyed by input string, so returned objects (e.g. `labels` arrays) may be shared between calls.

## Acceptance criteria

- `parseIssue` normalizes `created`/`updated` to ISO strings regardless of quoting (or uses a YAML schema without timestamp resolution).
- Normalize other fields defensively (`id` number, `labels` array of strings, `assignee` string).
- Avoid gray-matter cache aliasing (copy arrays or disable cache).
- Tests for unquoted dates.
