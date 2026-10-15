---
id: 82
title: Interactive prompts write to stdout
status: todo
priority: low
assignee: ''
labels:
  - bug
created: '2026-10-15T16:07:05.541Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:05.541Z'
---

`gitrac create` without `-t` prints the `Issue title: ` prompt to stdout, and does so even when stdin is not a TTY. That pollutes machine-readable output.

## Acceptance criteria

- All interactive prompts (create title, delete confirmation, renumber file choice) write to stderr.
- They only prompt when stdin is a TTY. Otherwise: create without a title fails with `invalid_input` (exit 2) and a clear message.
- Tests.
