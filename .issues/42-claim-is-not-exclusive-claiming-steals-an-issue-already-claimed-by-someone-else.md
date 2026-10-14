---
id: 42
title: >-
  Claim is not exclusive — claiming steals an issue already claimed by someone
  else
status: in_progress
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:56:47.137Z'
---

`gitrac claim` unconditionally overwrites `assignee`. If alice claims #2 and then bob claims #2, bob silently wins. The skill claims "Other agents will see the issue is taken", which is false.

This is the main blocker for using gitrac to coordinate multiple agents.

## Acceptance criteria

- `claim` fails (non-zero exit, clear message) if the issue is already `in_progress` and assigned to someone else.
- `--force` overrides.
- Claiming an issue you already own is idempotent (no-op, no new commit).
- Claiming a closed issue requires `--force` (or explicit reopen) instead of silently reopening.
- Claim check + write happens under the mutation lock (depends on the concurrency fix).
- Add an `unclaim` (or `release`) command to give an issue back.
