---
id: 102
title: Include resolved dependencies in gitrac show -o json|yaml
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-16T12:13:28.014Z'
createdBy: Justin Murray
updated: '2026-10-16T20:05:02.222Z'
---

In `src/cli/commands/show.ts:31-35`, `describeDependencies` (`parent`, `children`/sub-issues, `blockedBy` with each blocker's title/status/`resolved`, `blocks`, and `blocked`) is only computed when `globalOpts.output === 'human'`.

When an orchestrator or subagent runs `gitrac show <id> -o json` (or `-o yaml`), it only receives raw `parent?: number` and `blockedBy?: number[]`. It cannot see sub-issues (`children`), what issues `<id>` blocks (`blocks`), or whether each blocker is resolved (`done`/`cancelled`) or still open without making separate CLI calls.

## Acceptance criteria

- `gitrac show <id> -o json` and `-o yaml` include resolved dependency information (e.g. `dependencies: { parent, children, blockedBy, blocks, blocked }` from `describeDependencies`), while keeping `parent` and `blockedBy` on the issue itself unchanged for backward compatibility.
- Update `src/cli/output.test.ts`, `docs/specs/2026-03-28-gitrac-design.md`, and `skills/using-gitrac/SKILL.md`.

---

### Justin Murray — 2026-10-16T20:05:01.784Z

\## Summary

\### What was wrong
`gitrac show <id>` only worked out the linked issues (`describeDependencies`) for human output. With `-o json` and `-o yaml` you got just the raw `parent` and `blockedBy` IDs. Callers couldn't see sub-issues, which issues this one blocks, or whether each blocker is closed without running more commands.

\### What changed
- **`src/cli/commands/show.ts`**: `describeDependencies` now runs for every output format, not just human.
- **`src/cli/output.ts`**: when `formatIssueDetail` is given the resolved links, json and yaml get a `dependencies: { parent, children, blockedBy, blocks, blocked }` field. This is the same shape as `GET /api/issues/:id/dependencies`.
  - The issue's own `parent` and `blockedBy` fields are unchanged.
  - `claimedElsewhere` and `closedElsewhere` still appear.
  - `ls`, `ready`, `next` and the mutation commands don't pass the resolved links, so their output is the same as before.
- **`docs/specs/2026-03-28-gitrac-design.md`**: updated the `show` row in the command table and added a "Showing" paragraph under Dependencies.
- **`skills/using-gitrac/SKILL.md`**: documented the `dependencies` field in the Dependencies paragraph and the structured-output examples. `.agents/skills` is a symlink to this directory, so both copies stay the same.

\### Tests
- **`src/cli/output.test.ts`**: json and yaml include `dependencies`, keep `parent`/`blockedBy`, and keep `claimedElsewhere`. Without the resolved links there is no `dependencies` field.
- **`src/cli/commands/ready.test.ts`**: a test that runs the real CLI. It links #3 as blocked by #1 and #2 with parent #1, then closes #1. It checks:
  - `show 3 -o json` lists one closed blocker and one open blocker, and `blocked: true`.
  - `show 1 -o yaml` lists #3 under both `children` and `blocks`.
  - The test reads the closed status name from the issue file instead of hard-coding it.

\### Decisions and trade-offs
- I extended `formatIssueDetail` rather than adding a new formatter. That way mutation commands, which call it without the resolved links, can't start including the field by accident.
- `show -o json/yaml` now reads every issue file, as human `show` already did. That costs a little more time, but it matches the web dependencies route.

\### Follow-ups noticed
- The CLI and the web dependencies route each look up the linked issues the same way: `loadAllIssues`, then `indexIssues`, then `describeDependencies`. A small shared helper could replace both, but I left it alone to keep this change small.
