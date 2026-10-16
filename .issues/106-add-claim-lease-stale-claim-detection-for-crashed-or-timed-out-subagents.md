---
id: 106
title: Add claim lease / stale-claim detection for crashed or timed-out subagents
status: backlog
priority: medium
assignee: ''
labels:
  - feature
created: '2026-10-16T12:13:32.495Z'
createdBy: Justin Murray
updated: '2026-10-16T12:13:32.495Z'
---

When orchestrating parallel subagents across worktrees, a subagent process can crash, hang, or hit a context/timeout limit after claiming an issue. Because claims have no TTL or staleness check, the issue stays `in_progress` indefinitely unless the orchestrator externally tracks agent health and runs `gitrac unclaim <id> --force`.

## Acceptance criteria

- Support detecting and reclaiming stale claims based on claim age / lease duration (e.g. `--stale <duration>` on `ls`, `ready`, `next --claim`, and `unclaim`, and/or an optional `--lease <duration>` when claiming).
- Allow an orchestrator or `next --claim` (when configured/flagged) to identify or take over claims that have exceeded the staleness threshold without activity.
- Document in `skills/using-gitrac/SKILL.md` and the design spec; add unit and CLI tests.
