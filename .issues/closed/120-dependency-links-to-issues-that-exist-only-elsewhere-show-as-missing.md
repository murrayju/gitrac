---
id: 120
title: Dependency links to issues that exist only elsewhere show as missing
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-17T14:25:27.667Z'
createdBy: Justin Murray
updated: '2026-10-20T22:17:00.110Z'
---

Found by #110. When a local issue links (`blockedBy` / `parent`) to an ID that exists only in another worktree or on an unmerged branch (for example a sub-issue an agent filed), `gitrac show`, `GET /api/issues/:id/dependencies` and the web dependencies panel show it as `(missing)`, because links are resolved against local issues only. `ready` also treats such a blocker as resolved (missing).

## Acceptance criteria

- Resolve links against the issues found elsewhere too (the cached scan on the web, the `withIssues` scan in the CLI), showing their title/status and where they are.
- Decide and document whether an open blocker that exists only elsewhere blocks `ready` / `next`.
- Tests.

---

### Justin Murray — 2026-10-20T21:14:05.595Z

Renumbered from #116 (duplicate ID).

### Justin Murray — 2026-10-20T22:16:59.711Z

I implemented the decided rule: links to issues that exist only in another worktree or on another branch now show their title, status and location. Such a blocker now blocks `ready` / `next`. Typecheck and lint pass, all 1619 tests pass and the Vite build succeeds.

\## What was wrong
Links (`parent` / `blockedBy`, and the derived sub-issues / "blocks") were only checked against issues in this working tree. If a linked ID had no local file but existed elsewhere (for example a sub-issue an agent filed in its worktree), it had two problems:
- `gitrac show`, `GET /api/issues/:id/dependencies` and the web dependencies panel showed it as `#N (missing)`.
- `ready` / `next` treated it as a deleted blocker, so its dependent was offered as ready.

\## What changed
**Core (no I/O; the elsewhere issues are passed in as data)**
- `describeDependencies` (`src/core/dependencies.ts`) takes an optional list of issues found only elsewhere:
  - A linked ID with no local file gets that issue's title and status, `resolved: false`, and `foundElsewhere: { ref, worktree? }` on the `IssueRef`.
  - Issues found only elsewhere that point at this issue (as `parent` or in `blockedBy`) now appear under sub-issues and "blocks".
  - A local file always wins over a copy found elsewhere.
- `isBlockerResolved` / `openBlockers` take an optional `onlyElsewhere` set of IDs. Those blockers are never resolved. A blocker found nowhere (deleted) still counts as resolved.
- `ReadyOptions` (`src/core/ready.ts`) has a new `onlyElsewhere` option, used by `isReady`.

**Service layer**
- `dependenciesWithElsewhere` (`src/service/list.ts`) resolves an issue's links against the local issues plus the elsewhere scan. `gitrac show` and the web route both use it.
- `issueOnlyElsewhereIn` replaces the scanning `findIssueElsewhere`: it does the same lookup but uses a scan the caller already has. `localIds` is now exported.
- `listReadyIssues` (`src/service/ready.ts`) reuses its one existing scan (now with the parsed issues) to work out the blocker IDs that exist only elsewhere.

**CLI**
- `show` runs one scan with the parsed issues. That scan covers the fallback for an issue that exists only elsewhere, its claim/close marks, and its links. Before, it ran two scans.
- Human output reads like `#3 Sub task (todo, only in worktree /p (branch agent-1))`.
- JSON includes `foundElsewhere` on each such linked issue.

**Web**
- `GET /api/issues/:id/dependencies` uses the cached scan (`elsewhereCache(ctx).states()`), never a fresh scan per request.
- In the dependencies panel, such a linked issue gets the `FoundElsewhereBadge`, hover text with its full location, and a link to its read-only view.
- When only such blockers block, the panel's notice says so: "Blocked by an issue that is only in another worktree or on another branch".
- The two new wording helpers, `refHoverText` and `blockedNotice`, are in `src/web/ui/lib/claimed-elsewhere.ts`.

**Docs**
- The spec's Dependencies section covers resolved blockers, showing and ready. The claims-elsewhere rule, the API table entry and the Detail View text are updated too.
- The skill's Dependencies paragraph, the README dependencies section and the AGENTS.md conventions describe the new rule.

\## Tests
- **Core:** `describeDependencies` with issues found only elsewhere (parent, a sub-issue, a blocker that is open there, one that is closed there, a deleted one, and a local file winning). `openBlockers` with `onlyElsewhere`. `ready` / `next` blocked by an open or closed blocker found only elsewhere, while a deleted one still counts as resolved.
- **CLI with real worktrees** (`worktree-claims.test.ts`): an agent files a sub-issue in its worktree.
  - On main, `show` lists it with its location, in both human and JSON output.
  - `ready` / `next` skip the dependent, even after the blocker is closed in the worktree.
  - After the worktree and branch are deleted, the blocker counts as resolved.
- **CLI output:** the human format of linked issues that exist only elsewhere.
- **Web route:** the dependencies endpoint returns `foundElsewhere`, reports the issue as blocked while the blocker is open or closed there, and shares the cached scan.
- **UI helpers:** `refHoverText` and `blockedNotice`.

\## Decisions / trade-offs
- A blocker that exists only elsewhere blocks in any status, even closed there, because its work is not here yet. This fits the existing rule that blockers are judged by their local state.
- `ready` / `next` now keep the parsed issues from their scan (`withIssues`). It's the same file reads and git processes, just more memory.
- `show` now scans before reading the local file. It's one full scan instead of up to two scans limited to specific IDs.
- `ls`, `ready`, `next` and mutation output still carry only the issue's own `parent` / `blockedBy`, as before.

\## Follow-ups noticed
- `validateLinks` (used by `link`) still rejects a target that exists only elsewhere ("not found"). Linking to an agent's unmerged sub-issue is still refused; that would be a separate decision.
- `findMarksElsewhere` is now only used by `ls`. It could move to the same shared-scan pattern.

**Orchestrator browser verification and fix:** on a scratch repo, an agent filed a sub-issue of #1 in its worktree (`--no-commit`); main's `gitrac show 1`, `GET /api/issues/1/dependencies` and the detail sidebar listed it with its status and location, linking to `/issues/2`. In the 224px sidebar the location badge (`shrink-0`) squeezed the title link down to "#.", so the badge now sits on its own line below the title (`flex-wrap`, the link is `min-w-0 flex-1`); local rows with a remove button look as before. The `link` follow-up (a target that exists only elsewhere is still "not found") is left for a separate decision.
