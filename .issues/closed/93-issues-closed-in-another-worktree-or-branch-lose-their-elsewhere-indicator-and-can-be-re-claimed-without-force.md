---
id: 93
title: >-
  Issues closed in another worktree or branch lose their elsewhere indicator and
  can be re-claimed without --force
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:12:39.477Z'
createdBy: Justin Murray
updated: '2026-10-16T19:54:19.192Z'
---

When a subagent in another worktree (or on an unmerged branch) finishes an issue and closes it (`gitrac close <id>`), two problems occur in other worktrees (such as `main`):

1. **`claim` does not check if the effective state is closed elsewhere:** In `src/core/claim.ts`, `decideUnclaim` checks `if (newer && isClosedStatus(config, newer.status))` and returns `{ action: 'closed' }`, but `decideClaim` only checks the *local* copy (`options.inClosedDir || isClosedStatus(config, issue.status)`). If the issue was closed in another worktree/branch, `effective.status` is `done` (not `activeStatus`), so `decideClaim` falls through and returns `{ action: 'claim', reopen: false }`. Running `gitrac claim <id>` on `main` succeeds without `--force` or warning, writing a newer `updated` timestamp (`T3 > T2`). When the agent branch is later merged into `main`, `mergeIssueFrontmatter` picks `main`'s `in_progress` status because `T3 > T2`, silently undoing the agent's close!
2. **The elsewhere indicator disappears on `ls` / `show` / web UI:** `claimedElsewhere` (`src/core/elsewhere.ts`) only reports when `newest.status === activeStatus(config)`. As soon as an agent in a worktree closes the issue on its branch, the `[claimed in worktree …]` badge disappears on `main`, making the issue look like an untouched open `backlog` issue until the branch is merged.

## Acceptance criteria

- `decideClaim` refuses with `action: 'closed'` (CLI exit 4 `issue_closed`, including `closedElsewhere` details) when the effective state is closed in another worktree or branch, unless `--force` is passed.
- `ls`, `show`, and the web API/UI surface when an open local issue's effective state is closed in another worktree or branch (e.g. `[closed (done) in worktree …]`), so orchestrators and humans can see completed work awaiting merge.
- Tests with real git worktrees and branches in `src/core/claim.test.ts` and `src/cli/commands/worktree-claims.test.ts`.

---

### Justin Murray — 2026-10-16T19:54:18.771Z

\## Summary: claim and listings now see issues closed in another worktree or branch

`claim` now refuses an issue that was closed in another worktree or on an unmerged branch (exit 4, unless `--force`). `ls`, `show`, `-o json`, the web API and the UI now show that close. Typecheck and lint are clean (0 warnings, 0 errors). All tests in `src/core`, `src/cli`, `src/service` and `src/web` pass (1077 tests).

\### What was wrong
- **`claim` ignored closes made elsewhere.** `decideClaim` only checked whether the local copy was closed. If the issue was closed in another worktree or branch, the local copy was still open, so `claim` succeeded without `--force`. It wrote a newer `updated`, so merging the agent's branch later silently undid the agent's close.
- **The elsewhere indicator disappeared.** `claimedElsewhere` only reports an active claim. When an agent closed its claimed issue, the `[claimed …]` badge vanished on `main`, and the issue looked like an untouched open issue until the merge.

\### What changed
- **New helper in `src/core/elsewhere.ts`:** `closedElsewhere(issue, config, states)` returns `ClosedElsewhere { ref, worktree?, status, updated }`. It reports only when the local copy is open and the newest version elsewhere is newer and has a closed status (`isClosedStatus`, so custom closed statuses work). `elsewhereMarks()` combines it with `claimedElsewhere()`; at most one of the two is ever set.
- **`decideClaim`:** returns `{ action: 'closed', elsewhere }` for a close elsewhere unless `force`. With `--force` it claims as before, with no reopen.
- **`claimIssue`:** throws `issue_closed` (exit 4) with the message `Issue #N is closed (done) in worktree P (branch X).` and `details.closedElsewhere`. `unclaimIssue` uses the same shape for its existing `closedElsewhere`.
- **CLI hint:** for a close elsewhere, the `claim` hint now says "Merge that branch to get the close here, or use --force to claim it anyway." A local close keeps the `reopen` hint.
- **Shared mark computation:** `claimsFromStates` / `findClaimsElsewhere` became `marksFromStates` / `findMarksElsewhere`, and `ElsewhereCache.claims()` became `.marks()`. `ls`, `ready`, `show` and the web route's `withClaims` all use these.
- **Output:** `ls` shows `[closed (done) on branch X]` or `[closed (done) in worktree P (branch X)]`. `show` shows an `Elsewhere:` line. json and yaml add a `closedElsewhere` field.
- **Web API:** `GET /api/issues`, `GET /api/issues/:id`, mutation and DELETE responses, and the `current` issue in 409s carry `closedElsewhere`. `ApiIssue` is now `Issue & ElsewhereMarks`.
- **Web UI:** a new `ClosedElsewhereBadge` (`Done in wt-1` / `Closed (Done) in worktree …`) appears on list rows and in the detail sidebar's "Elsewhere" section. It uses the closed status's badge style and display label.
- **Docs:** updated `docs/specs/2026-03-28-gitrac-design.md` (claim rules, ls/show, Server, API table, List and Detail views) and `skills/using-gitrac/SKILL.md`.

\### Tests
- `src/core/claim.test.ts`: refusal with location, on a worktree and on a branch only; `--force` claims; an older close elsewhere is ignored; a custom closed status from the config. With the fix disabled, these new tests fail.
- `src/core/elsewhere.test.ts`: `closedElsewhere` cases (older close, newer reopen, closed locally too, a claim is not a close, custom config) and `elsewhereMarks`.
- `src/cli/commands/worktree-claims.test.ts`, with real worktrees:
  - Close in the agent's worktree, then `claim` on `main` exits 4 with the new message and JSON details. `ls` and `show` show the close in human and json output, `ready` skips the issue, and `--force` claims it.
  - A close committed on a branch is still reported after its worktree is removed.
  - A local close keeps the reopen hint.
- `src/web/routes/issues-elsewhere.test.ts`: list, detail and DELETE dry-run responses carry the field; a branch close has no `worktree`; 409 `current` carries it; a newer local PATCH supersedes it.
- `src/web/elsewhere-cache.test.ts`, `src/cli/output.test.ts`, `src/web/ui/lib/claimed-elsewhere.test.ts`: wording and field output.

\### Decisions and trade-offs
- **Small additive change to the `unclaim` error:** its `closedElsewhere` details now also include `status`, so `claim`, `unclaim`, `ls` and the API share one shape. Nothing was removed.
- **Internal renames:** `claimsFromStates` → `marksFromStates`, `ElsewhereCache.claims` → `.marks`, `ReadyListing.claimedElsewhere` → `.marks`, and `ClaimsElsewhere` → `MarksElsewhere` in `output.ts`. These are internal, not public; the `claimedElsewhere` JSON field is unchanged.
- **`ready` needed no logic change:** `isAvailableTo` already excludes issues closed in their effective state. Its output now goes through `marksFromStates` for consistency.
- **No mark when closed on both sides:** if the local copy is also closed, `closedElsewhere` is not reported.

\### Follow-ups noticed

- An issue that is closed locally but open or claimed on another branch (reopened there) is still judged only by its local copy in `decideClaim`. That is a separate question.
