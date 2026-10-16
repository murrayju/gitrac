---
id: 102
title: Include resolved dependencies in gitrac show -o json|yaml
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-16T12:13:28.014Z'
createdBy: Justin Murray
updated: '2026-10-16T19:54:47.203Z'
---

In `src/cli/commands/show.ts:31-35`, `describeDependencies` (`parent`, `children`/sub-issues, `blockedBy` with each blocker's title/status/`resolved`, `blocks`, and `blocked`) is only computed when `globalOpts.output === 'human'`.

When an orchestrator or subagent runs `gitrac show <id> -o json` (or `-o yaml`), it only receives raw `parent?: number` and `blockedBy?: number[]`. It cannot see sub-issues (`children`), what issues `<id>` blocks (`blocks`), or whether each blocker is resolved (`done`/`cancelled`) or still open without making separate CLI calls.

## Acceptance criteria

- `gitrac show <id> -o json` and `-o yaml` include resolved dependency information (e.g. `dependencies: { parent, children, blockedBy, blocks, blocked }` from `describeDependencies`), while keeping `parent` and `blockedBy` on the issue itself unchanged for backward compatibility.
- Update `src/cli/output.test.ts`, `docs/specs/2026-03-28-gitrac-design.md`, and `skills/using-gitrac/SKILL.md`.
