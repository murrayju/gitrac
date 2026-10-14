---
id: 43
title: CLI cannot set an issue description
status: todo
priority: high
assignee: ''
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

Neither `create` nor `edit` accepts a description. Agents therefore can't create well-specified issues without editing the markdown file directly, which the skill explicitly says not to do.

## Acceptance criteria

- `create` and `edit` accept `-d, --description <text>`, `--description-file <path>` (`-` for stdin).
- `comment` accepts `--body-file <path|->` too (currently only positional or implicit stdin).
- Update AGENTS.md / skill docs.
