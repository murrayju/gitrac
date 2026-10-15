---
id: 66
title: Web API and UI don't show claims made on other worktrees/branches
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-15T13:15:02.044Z'
createdBy: Justin Murray
updated: '2026-10-15T14:27:48.989Z'
---

`claimedElsewhere` (#56) is exposed by the CLI (`ls`/`show`/`ready`, JSON field) but not by the web API or UI, so someone watching the board can't see what agents in other worktrees are working on.

## Acceptance criteria

- `GET /api/issues` and `GET /api/issues/:id` include the optional `claimedElsewhere` field, using the same service code as the CLI.
- The scan is not run unboundedly per request: cache results briefly (e.g. a few seconds, invalidated by the file watcher for this worktree) so list polling/SSE refetch bursts stay cheap; document the staleness bound.
- UI: list rows and the detail view show a clear indicator ("claimed by X in worktree/branch Y"), using the existing badge styling.
- Optional: periodically refresh while the page is open (other worktrees' changes are not watched).
- Tests for the API field and caching; UI build passes.

---

### Justin Murray — 2026-10-15T14:27:48.989Z

\## #66: show claims from other worktrees/branches in the web API and UI

**What was wrong**
The CLI shows `claimedElsewhere` (#56) in `ls`, `show` and `ready`. The web API and UI did not, so someone watching the board couldn't see what agents in other worktrees, or on unmerged branches, were working on.

**What changed**
- **API:** `GET /api/issues` and `GET /api/issues/:id` now add an optional `claimedElsewhere: { ref, worktree?, assignee, updated }`, the same shape as `gitrac ls -o json`. Mutation responses (via `respondWithIssue`) add it too, so they still match a later GET.
- **Shared logic:** I split the pure part out of `findClaimsElsewhere` (`src/service/list.ts`) into a new `claimsFromStates(issues, config, states)`. The CLI and the web both use it, so the claim rules exist once.
- **Caching** (new `src/web/elsewhere-cache.ts`):
  - `ElsewhereCache` scans every issue once with `issueStatesElsewhere`, so the list and single-issue routes share one result.
  - Concurrent requests share a scan that's already running.
  - A failed scan is not cached.
  - A result is reused for at most `ELSEWHERE_CACHE_TTL_MS` (5s), or until this worktree's `.issues/` changes.
  - The cache lives on `ServerContext.elsewhere` and is created on first use by `elsewhereCache(ctx)`. Mutations (claim, `next --claim`) don't use it; they still scan fresh under the repo lock.
- **Invalidation:** `IssueWatcher` has a new `generation()` counter that goes up on every raw file-system event. The cache compares against it instead of registering a change listener, so `listenerCount()` (used to count open SSE streams) is unchanged.
- **UI:**
  - New `ApiIssue` type (`Issue & { claimedElsewhere? }`).
  - New `ClaimedElsewhereBadge`, styled like the active status's badge.
  - List rows show a short badge after the title (`claimed by Bob in wt-1` / `claimed by Bob on origin/x`), with the full text on hover.
  - The detail sidebar has an "Elsewhere" row with the full sentence (`Claimed by Bob in worktree /path (branch agent-1)`), worded like the CLI.
- **Periodic refresh:** other worktrees and refs aren't watched, so no SSE event announces their changes. `useIssues` and `useIssue` now also refetch on one shared 15s timer per tab (`elsewhereRefresh()`, `lib/refresh-timer.ts`). It runs only while something is subscribed, skips ticks while the page is hidden, and refetches once when the page becomes visible again. No new `EventSource` was added.
- **How stale it can be:** up to 5s in the API, and about 20s at worst in the UI. This is written down in the spec.

**Files**
- New: `src/web/elsewhere-cache.ts`, `src/web/ui/components/ClaimedElsewhereBadge.tsx`, `src/web/ui/lib/claimed-elsewhere.ts`, `src/web/ui/lib/refresh-timer.ts`
- Changed: `src/service/list.ts`, `src/web/routes/issues.ts`, `src/web/server.ts`, `src/web/watcher.ts`, `src/web/ui/api.ts`, `src/web/ui/hooks.ts`, `src/web/ui/components/IssueRow.tsx`, `src/web/ui/components/MetadataPanel.tsx`
- Tests:
  - `src/web/elsewhere-cache.test.ts`: TTL, watcher invalidation, shared in-flight scan, failures not cached.
  - `src/web/routes/issues-elsewhere.test.ts`: real worktrees. Covers a claim in another worktree, a claim committed on a branch, a newer local version winning, one scan shared within the TTL, and the watcher invalidating the cache.
  - `src/web/ui/lib/refresh-timer.test.ts` and `src/web/ui/lib/claimed-elsewhere.test.ts`.
- Docs: `docs/specs/…-design.md` (claims section, a new "Claims elsewhere" paragraph under Server, API table, list and detail views), `skills/using-gitrac/SKILL.md`, `AGENTS.md`.

`./bun run check` passes (1033 tests) and the Vite build passes. I also checked with curl against a scratch repo: a `claim --no-commit` in another worktree shows up in both GET endpoints. I haven't looked at the UI in a browser.

**Decisions and trade-offs**
- **Full scan:** the cache scans all issues rather than only the requested IDs. A single scan can then serve both endpoints, at the cost of reading a few more blobs.
- **Watcher invalidation:** the scan's result barely depends on local working-tree files. I kept the invalidation anyway because the acceptance criteria ask for it, and it does matter for `git pull`/merge in this worktree. The local issue is always read fresh, so a local edit or claim never shows a stale claim.
- **Polling in the UI:** I put the periodic refresh in the browser rather than having the server poll and push SSE events, because it's simpler and the cache keeps it cheap.

**Follow-ups noticed**
- 409 responses (`current` in If-Match conflicts and `invalid_state`) don't include `claimedElsewhere`. The UI fixes this on its next refetch.
- #65 (unclaim across worktrees) affects what the badge shows. Once a release elsewhere is newer, the badge disappears within the stated staleness.

**Orchestrator browser verification:** with a `--no-commit` claim in a second worktree, the list row shows `claimed by Agent One in <worktree>` and the detail sidebar shows the full "Elsewhere" line; a new claim in the other worktree appeared within ~12s (shared 15s timer), and an `unclaim --force` from main cleared it within 3s (SSE + watcher-invalidated cache).
