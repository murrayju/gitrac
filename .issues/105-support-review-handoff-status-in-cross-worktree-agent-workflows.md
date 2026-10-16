---
id: 105
title: Support review / handoff status in cross-worktree agent workflows
status: backlog
priority: medium
assignee: ''
labels:
  - feature
blockedBy:
  - 93
  - 94
created: '2026-10-16T12:13:31.379Z'
createdBy: Justin Murray
updated: '2026-10-16T12:14:09.084Z'
---

In an orchestrator-subagent workflow (such as `.opencode/commands/work-backlog.md`), a subagent claims an issue (`in_progress`), implements the fix on its worktree branch, and hands it off for review before the orchestrator verifies, merges, and closes it (`done`).

Currently, cross-worktree claim protection (`decideClaim` in `src/core/claim.ts` and `claimedElsewhere` in `src/core/elsewhere.ts`) is hard-coupled to a single `activeStatus` (default `in_progress`). If a project configures a `review` status and a subagent moves an issue from `in_progress` to `review`, `gitrac` stops treating the issue as claimed on that branch/worktree — the elsewhere badge disappears and another agent can claim it.

## Acceptance criteria

- Allow cross-worktree claim visibility and protection to cover in-review / multi-stage active work (e.g. an optional `reviewStatus` workflow hook in `config.yaml`, or treating any open status after `todo` / any configured active status with an assignee as held).
- Provide a clean way in the CLI/API to transition an issue to review (or preserve cross-worktree claim protection when an assigned issue moves to a review status) until it is closed or unclaimed.
- Update workflow docs, spec, and skill; add tests.
