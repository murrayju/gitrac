---
id: 84
title: Unknown frontmatter keys are dropped on write
status: todo
priority: medium
assignee: ''
labels:
  - enhancement
created: '2026-10-15T16:07:07.351Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:07.351Z'
---

`serializeIssue` only writes known fields, so any custom frontmatter (`estimate:`, `externalId:`, `sprint:`) added by hand or by another tool silently disappears on the next gitrac write. The design spec lists custom fields / external sync IDs as future work, and dropping data is the opposite of that.

## Acceptance criteria

- Unknown frontmatter keys are preserved verbatim (values and order, written after the known keys) through every read/modify/write, including the merge driver (merge them per key, three-way).
- Exposed in `-o json` / the API under a separate `extra` (or similar) object so they don't collide with known fields. Not editable through the CLI/UI yet.
- The round-trip-every-issue-file test still passes; new tests for preservation.
