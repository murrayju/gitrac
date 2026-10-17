---
id: 108
title: Web PATCH can overwrite a claim held in another worktree
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T21:58:35.182Z'
createdBy: Justin Murray
updated: '2026-10-17T13:34:17.573Z'
---

Found by #103. The web UI's status and assignee dropdowns write through `PATCH /api/issues/:id` (`updateIssue`), which skips the claim rules (`decideClaim`). Setting the active status or an assignee there can silently overwrite a claim that an agent holds in another worktree or on another branch. The new Claim / Release buttons (#103) are the safe path, but the dropdowns still allow it.

## Acceptance criteria

- A PATCH that sets a held status or the assignee on an issue that is claimed by someone else (here or elsewhere) is refused with 409 `already_claimed` (with `claimedElsewhere`), unless the request says to force it. Decide whether `gitrac edit` follows the same rule (CLI and web should match).
- The UI shows the refusal inline, with a way to take over.
- Tests.
