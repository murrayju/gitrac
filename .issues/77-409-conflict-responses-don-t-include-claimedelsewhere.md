---
id: 77
title: 409 conflict responses don't include claimedElsewhere
status: todo
priority: low
assignee: ''
labels:
  - bug
created: '2026-10-15T16:07:01.091Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:01.091Z'
---

Since #66, `GET /api/issues/:id` and mutation responses include an optional `claimedElsewhere`. The `current` issue embedded in 409 responses (If-Match conflicts, `invalid_state`, `duplicate_issue`) doesn't, so the UI briefly drops the badge until its next refetch.

## Acceptance criteria

- Every response that embeds an issue (`current` in 409s included) uses the same decoration as GET.
- Tests.
