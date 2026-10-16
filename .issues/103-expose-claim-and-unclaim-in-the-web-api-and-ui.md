---
id: 103
title: Expose claim and unclaim in the web API and UI
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
blockedBy:
  - 93
  - 94
created: '2026-10-16T12:13:29.051Z'
createdBy: Justin Murray
updated: '2026-10-16T20:35:14.125Z'
---

The CLI provides `gitrac claim <id>` and `gitrac unclaim <id>` (backed by `claimIssue` and `unclaimIssue` in `src/service/claim.ts`), which enforce exclusive claims across worktrees and branches and register new assignees.

The web API and UI currently have no `claim` or `unclaim` endpoints or controls. Worse, setting status to `in_progress` and assigning an issue in the web UI calls `PATCH /api/issues/:id` (`updateIssue`), which bypasses `decideClaim` and can silently overwrite an active claim held by an agent in another worktree.

## Acceptance criteria

- Add `POST /api/issues/:id/claim` and `POST /api/issues/:id/unclaim` routes in `src/web/routes/issues.ts` routing through `claimIssue` / `unclaimIssue` (accepting optional `author`, `comment`, `force`, and mapping `already_claimed` / `issue_closed` to 409 with details).
- Add Claim / Unclaim actions in the web UI (`IssueDetail` / `MetadataPanel`) that respect the selected "Acting as" identity and surface claim conflicts clearly.
- Tests for the new API routes and surface parity.
