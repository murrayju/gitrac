---
id: 107
title: Surface issues created in other worktrees or on unmerged branches
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - feature
blockedBy:
  - 93
created: '2026-10-16T12:13:33.538Z'
createdBy: Justin Murray
updated: '2026-10-16T20:32:39.883Z'
---

`listIssues` and `listReadyIssues` only load `.issues/*.md` files present in the current worktree's filesystem, then overlay `issueStatesElsewhere` for those IDs.

When a subagent running in another worktree discovers a bug or decomposes work by creating new issues (`gitrac create`) on its branch, those issues are invisible to `gitrac ls` / `gitrac show` / the web UI in the `main` worktree (and other worktrees) until the branch is merged (even though `allocateIssueId` already scans all refs to avoid ID collisions).

## Acceptance criteria

- Extend the cross-worktree / cross-branch scan (or add an option / section in `ls`, `show`, and the web API/UI) so issues that exist only in another worktree or on an unmerged branch can be inspected from `main` before their branch is merged.
- Tests with real git worktrees and branches.

---

### Justin Murray — 2026-10-16T20:32:39.468Z

I've implemented #107. Issues that exist only in another worktree or on an unmerged branch now show up from `main` with `ls --elsewhere`, `show <id>` and `GET /api/issues?elsewhere=1`. Typecheck and lint are clean (0 warnings, 0 errors), and all 1333 tests in `src/core`, `src/git`, `src/service`, `src/cli` and `src/web` pass.

\## What was wrong
`listIssues` and `show` only read `.issues/` in the current working tree. `issueStatesElsewhere` already read every issue file on other refs and in other worktrees, but only kept status, assignee and `updated`, and only for IDs that have a local file. So an issue that an agent created on its branch or in its worktree could not be seen from `main` until the branch was merged.

\## What changed
- **`src/git/elsewhere.ts`**: new option `issueStatesElsewhere(dir, { withIssues: true })`. Each version then also carries its full parsed `issue`, taken from the same reads, so there are no extra git processes.
- **`src/core/elsewhere.ts`**:
  - New field `IssueStateElsewhere.issue?`, new types `FoundElsewhere` and `IssueOnlyElsewhere`, and a new `ElsewhereMarks.foundElsewhere`.
  - New pure function `issuesOnlyElsewhere(localIds, states)`: for each ID with no local file, it picks the newest version by `updated`. Ties go to the earlier state, so a worktree wins over a local branch, which wins over a remote-tracking one.
- **`src/service/list.ts`**:
  - `listIssues` takes an optional `elsewhere` (a states map or a promise of one) and returns `elsewhere: IssueOnlyElsewhere[]`, filtered and sorted with the same query as the local issues.
  - A local file that can't be parsed still counts as local, so its ID is not reported as "only elsewhere".
  - New helpers: `scanElsewhere(dir)` and `findIssueElsewhere(dir, id)`.
- **CLI**:
  - **`ls --elsewhere`**: lists these issues after the local ones, marked `[only in worktree P (branch X)]` or `[only on branch X]`, with `foundElsewhere: { ref, worktree? }` in json/yaml. It runs one scan that serves both these issues and the existing marks. Without the flag, `ls` is unchanged.
  - **`show <id>`**: if there is no local file but a version exists elsewhere, it shows that version (exit 0). The detail view gets an `Elsewhere:  only …` line, json/yaml get `foundElsewhere`, and stderr gets `Note: issue #N is not in this working tree; showing the version …`. With no version anywhere it is still `not_found` (exit 5).
  - **Mutations** (edit, claim, close, ...) are untouched and still fail with `not_found`.
- **Web**:
  - `GET /api/issues?elsewhere=1` adds the same items with `foundElsewhere`, from `elsewhereCache(ctx).states()` (cached, not a fresh scan per request).
  - The `ElsewhereCache` default scan is now `scanElsewhere`, so the cache always holds the parsed issues.
- **Docs**: the design spec (`ls` and `show` rows, a new "Issues that exist only elsewhere" section, the `GET /api/issues` row), `skills/using-gitrac/SKILL.md` (new step 5 in Parallel Agents in Worktrees, and an `ls --elsewhere` row) and the README command table.

\## Tests
- **`src/core/elsewhere.test.ts`**: `issuesOnlyElsewhere` picks the newest version, applies the tie rule, skips local IDs and versions without a parsed issue, and sorts by ID.
- **`src/git/elsewhere.test.ts`**: with a real worktree, `withIssues` keeps the parsed issue for both the worktree copy and the branch copy; without it, nothing changes.
- **`src/cli/commands/worktree-claims.test.ts`** (real worktrees and branches, CLI processes):
  - An uncommitted issue in an agent worktree, and one committed on a branch whose worktree was removed, both appear in `ls --elsewhere` (human and json) and in `show` (note on stderr, json `foundElsewhere`).
  - `--label` and `--search` filters apply to them.
  - `ls` without the flag is unchanged, a missing ID still exits 5, and `claim`/`close` still exit 5.
  - An issue that also exists locally (newer claim in a worktree) is listed once, keeps its `claimedElsewhere` mark, and `show` prints no note.
- **`src/web/routes/issues-elsewhere.test.ts`**: `?elsewhere=1` returns worktree-only and branch-only issues, filters apply, a local issue with a newer branch version is not duplicated, and the whole request uses one cached scan. The test's custom scan now calls `scanElsewhere`.

\## Decisions and trade-offs
- I added an option to the existing scan rather than a second function, so it is the same git processes and blob reads.
- `foundElsewhere` holds only `{ ref, worktree? }`, as the design guidance asked; the issue's own `updated` already says when.
- The web cache now holds full parsed issues for every version elsewhere. That costs some memory per server, but the parsing already happened; before, its result was thrown away.
- In `show`, dependencies of an issue found elsewhere are resolved against local issues only. A sub-issue that also exists only elsewhere shows as `(missing)`.


\## Follow-ups noticed
- **Web UI**: the UI doesn't use `?elsewhere=1` yet. It could show these issues in the list with a "only in worktree …" badge.
- **`GET /api/issues/:id`** still returns 404 for an issue that exists only elsewhere. `show` and this route now behave differently; it could fall back to the cached scan the same way.
- **`ready --elsewhere`** is not added. These issues can't be claimed from `main` anyway.
