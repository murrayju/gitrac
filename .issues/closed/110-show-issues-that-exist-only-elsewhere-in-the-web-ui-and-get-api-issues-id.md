---
id: 110
title: 'Show issues that exist only elsewhere in the web UI and GET /api/issues/:id'
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-16T21:58:37.177Z'
createdBy: Justin Murray
updated: '2026-10-17T13:44:56.300Z'
---

Follow-up from #107. `gitrac ls --elsewhere`, `gitrac show <id>` and `GET /api/issues?elsewhere=1` can see issues that exist only in another worktree or on an unmerged branch, but:

- The web UI doesn't use `?elsewhere=1`, so the board can't show what agents filed.
- `GET /api/issues/:id` returns 404 for such an issue, while `gitrac show` shows it.

## Acceptance criteria

- The issue list can include these issues (e.g. a toggle), each with an "only in worktree ..." / "only on branch ..." badge; their detail view is read-only.
- `GET /api/issues/:id` falls back to the cached scan like `show`, with `foundElsewhere`; mutations still 404.
- Tests.

---

### Justin Murray — 2026-10-17T13:44:55.907Z

The web UI can now list issues that exist only in another worktree or on another branch, and opens them in a read-only view. `GET /api/issues/:id` returns such an issue instead of a 404. Typecheck, lint (0 warnings), `./bun test src/web src/service` (626 pass, 0 fail) and the Vite build all pass. The only build message is the existing chunk-size warning.

\## What was wrong
Since #107, `gitrac ls --elsewhere`, `gitrac show <id>` and `GET /api/issues?elsewhere=1` could see issues that have no file in this working tree (for example, ones an agent filed in its worktree). But:
- The UI never sent `elsewhere=1`, so the board couldn't show them.
- `GET /api/issues/:id` and `GET /api/issues/:id/dependencies` answered 404 for them, while `gitrac show` displayed them.

\## What changed
**API (`src/web/routes/issues.ts`)**
- When no local file has the ID, `GET /api/issues/:id` falls back to the server's cached scan (`elsewhereCache(ctx).states()` with `issuesOnlyElsewhere`). It returns the newest version found, with `foundElsewhere: { ref, worktree? }` and **no `ETag`**. With no ETag the UI can't send `If-Match`, so it can't edit the issue.
- `GET /api/issues/:id/dependencies` uses the same lookup and resolves the links against the local issues, as `gitrac show` does.
- A local file that exists but can't be read still gives 404, with no fallback. This matches how `listIssues` treats unreadable files as local.
- Mutations needed no code change. They all go through `loadStoredIssue`, so they still return 404.

**UI**
- **Filter state:** `filterStore` has a new `elsewhereFilter`. `listFilters` and `issueListQuery` turn it into `elsewhere=1`.
- **List:** `IssueList.tsx` has an "Other worktrees/branches" checkbox. Those issues appear after the local ones, sorted among themselves by the chosen column (`localFirst`).
- **New `ElsewhereIssueRow.tsx`:** status and priority are plain badges, not dropdowns.
- **New `FoundElsewhereBadge.tsx`:** a dashed `only in wt-1` / `only on agent-1` badge, with the full location on hover.
- **Wording helpers** (`shortFoundText`, `fullFoundText`, `foundElsewhereNotice`) are in `lib/claimed-elsewhere.ts` and reuse `describeLocation`.
- **Detail:** `IssueDetail.tsx` gets only an early branch that renders the new `ElsewhereIssueView.tsx`. That view shows:
  - the notice "This issue exists only in worktree P (branch X). Merge that branch to edit it here."
  - the title, and the description and comments rendered with `MarkdownContent`
  - status, priority, assignee and labels as plain badges
  - the issue's links, with no editing controls
- `IssueRow.tsx` is untouched. In `DependenciesPanel.tsx` the only change is that `RefList` is now exported, so the read-only view can reuse it.

**Docs:** the API table, the "issues only elsewhere" section, List View and Detail View in `docs/specs/2026-03-28-gitrac-design.md`.

\## Tests
- **Route tests** (`issues-elsewhere.test.ts`), 3 of 4 fail without the route change (the 404 test passes either way):
  - fallback from another worktree: `foundElsewhere`, no ETag, description, dependencies resolved locally, one cached scan for all requests
  - fallback from a branch: no `worktree` field
  - a local file wins over a version elsewhere, and an ID found nowhere is still 404 (issue and dependencies)
  - all 12 mutation routes return 404 for such an ID and write or commit nothing
- **UI helper tests:**
  - badge and notice wording for a worktree, a branch and a detached HEAD
  - `localFirst` ordering
  - `elsewhere=1` in the query string

\## Decisions and trade-offs
- **Listed after the local issues, not mixed in:** this matches `ls --elsewhere` and the API order, and keeps read-only rows from looking like editable local ones.
- **No ETag rather than a different one:** a missing ETag shows the issue has no editable version. With a different ETag, an `If-Match` sent later would only get a confusing 404.
- **Detached HEAD notice:** for a detached worktree there is no branch to merge, so the notice says to commit the issue on a branch first.
- **Live updates:** the read-only view uses `useIssue`, so it switches to the normal editable view once the branch is merged.
- **Filter not persisted:** the toggle lives in `filterStore` like the other filters, so it lasts only for the session, not across reloads.

\## Follow-ups noticed
- Links from a local issue to an ID that exists only elsewhere still show as "(missing)" in the dependencies panel, because links are resolved against local issues only.
- The read-only view shows the comments with its own small markup. It could reuse `CommentList` once that component can render without its edit and delete controls.

**Orchestrator notes:** merged after #112 and #113 (the only conflict was the spec's List View / Detail View paragraph; both sides' text is kept). Browser check on a scratch repo: an issue created with `--no-commit` in an agent worktree was hidden from the list until "Other worktrees/branches" was checked, then listed last with "only in gitrac-demo-wt1"; its detail page showed the "exists only in worktree ... Merge that branch to edit it here." notice and no editing controls. `GET /api/issues/3` returned `foundElsewhere` and no ETag.
