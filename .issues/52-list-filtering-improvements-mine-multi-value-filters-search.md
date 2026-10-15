---
id: 52
title: 'List filtering improvements: --mine, multi-value filters, search'
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T01:17:13.478Z'
---

- `ls --assignee` requires an exact match on the stored value (usually an email); allow matching by name or email (case-insensitive).
- Add `--mine` (current git identity).
- Support comma-separated values for `--status`, `--priority`, `--label` as shown in the spec (`--priority urgent,high`).
- Add `--search <text>` over title/description.
- Show labels in the human list output.
- Keep CLI and web API filter semantics identical (ideally shared code).
