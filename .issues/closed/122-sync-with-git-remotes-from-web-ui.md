---
id: 122
title: sync with git remotes from web ui
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-21T20:32:29.596Z'
createdBy: Justin Murray
updated: '2026-10-21T22:23:33.191Z'
---

The web UI should show an indication of how far ahead/behind the current repo is from the configured remote(s). It should also have an interface to trigger a sync.

This is important because it may not be obvious to a user of the web app that their local changes are not being synced.

Handling multiple remotes is tricky. The primary interface should be simple, with a simple sync button that does the necessary pull/push. For advanced use cases, we will need a view that lists all remotes, allows for push/pull/sync operations that target a single remote, and enables/disables remotes to include in the default/simple sync.

When a pull/push is not possible due to conflicts, the UI should go into a very apparent error state, and direct the user to resolve the conflicts manually (in their terminal).

We should also visualize a summary of *which* commits would be synced (in a tooltip).

---

### Justin Murray — 2026-10-21T22:23:33.191Z

\## Sync with git remotes from the web UI

\### What was missing
The web UI never showed whether the current branch was ahead of or behind its remotes, and it had no way to sync. A web user could build up local commits without knowing they weren't shared. Separately, `AmendTracker.canAmend` only checked whether HEAD was ahead of the upstream. A commit pushed to some other remote could therefore still be amended, which rewrites published history.

\### What changed
New files are used wherever possible. Existing files get only small mount edits, to keep the merge with #123 easy.

- **`src/core/sync.ts`** (pure rules):
  - picks fast-forward vs. merge (never rebase);
  - reads the include flag and hides credentials in remote URLs;
  - sorts git's error output into `auth`, `unreachable`, `timeout`, `rejected`, `local-changes`, `conflict`, `no-branch` and `git`;
  - builds user messages with the terminal commands to run (`git pull --no-rebase <remote> <branch>`, ...);
  - works out the overall state for the indicator.
- **`src/git/remotes.ts`** (git helpers):
  - `runGit` with a timeout that kills the process;
  - non-interactive network settings: `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never`, and `ssh -o BatchMode=yes` unless the user already set `GIT_SSH_COMMAND`, `GIT_SSH` or `core.sshCommand`;
  - listing remotes and storing the include flag in local git config;
  - ahead/behind counts, commit lists (capped at 20, plus "+N more") and last fetch time;
  - conflict prediction without touching files, via `git merge-tree --write-tree`, which uses the gitrac merge driver;
  - fetch, fast-forward, merge commit (runs `merge --abort` if it fails), fast-forward-only push, and `isPublished`.
- **`src/service/sync.ts`**: `syncStatus`, `fetchRemotes`, `pullRemotes`, `pushRemotes`, `syncRemotes`, `setSyncIncluded`.
  - Fetches run outside the repo lock; merging and pushing run under it.
  - Remotes are processed in this order: the branch's upstream remote, then `origin`, then the rest.
  - After a conflict or local-changes error, sync stops merging the remaining remotes and pushes nothing that wasn't merged.
  - Sync is refused (`invalid_state`) while a merge, rebase, cherry-pick or revert is in progress, or when HEAD is detached.
- **`src/web/routes/sync.ts`**, mounted with one line in `server.ts`:
  - `GET /api/git/sync`
  - `POST /api/git/sync/{fetch,pull,push,sync}` with an optional `{ remote }`
  - `PUT /api/git/sync/remotes/:name`
  - A sync that merges or pushes also clears the amend tracker.
- **`AmendTracker.canAmend`** now refuses to amend any commit that a remote-tracking branch contains.
- **UI:**
  - **`lib/sync.ts`**: rules for the indicator, tooltip, banner and problem tracking.
  - **`lib/sync-store.ts`**: one store for the tab. It reloads the status on SSE events and on the existing 15s timer, fetches once on page load, then every 5 minutes on a new shared `syncFetchRefresh()` timer.
  - **`sync-hooks.ts`**: the React hook for the store.
  - **`SyncStatus.tsx`**: the sidebar indicator, the commit tooltip, the Sync button and the red `SyncBanner`.
  - **`RemotesPanel.tsx`** at `/remotes`: every remote with its URL, ahead/behind, last fetch and predicted conflicts, an include checkbox, and Fetch / Pull / Push / Sync buttons for that remote (Push reads "Push to create" when the remote lacks the branch).
  - The API helpers are one block at the end of `api.ts`.
- **Docs:** spec (Server, API table, UI views, service list), README web UI section, `skills/using-gitrac/SKILL.md`, and the service list in `AGENTS.md`.

\### Tests
All checks pass: typecheck; lint (0 warnings, 0 errors); `./bun test src/git src/service src/web src/core` (1334 pass, 0 fail); and the vite build.

- **`core/sync.test.ts`**: the pure rules.
- **`git/remotes.test.ts`** and **`service/sync.test.ts`** run against temp repos with local bare remotes. They cover:
  - ahead, behind, and diverged branches that merge cleanly;
  - edits to the same issue on both sides, merged by the merge driver;
  - a conflict that is aborted with the tree left as it was;
  - local changes that would be overwritten;
  - a remote without the branch, an excluded remote, multiple remotes;
  - a rejected push, an unreachable remote, and an auth failure (a local HTTP server answering 401, no prompt);
  - a timeout, a merge in progress, a detached HEAD;
  - an amend refused after a push to a remote that isn't the upstream.
- **`web/routes/sync.test.ts`**: status codes, URL redaction, cross-origin requests rejected (403), the include toggle, and the amend window closing after a sync.
- **`ui/lib/sync.test.ts`** and **`sync-store.test.ts`**: indicator, banner, problem handling, timers (one fetch per load, timers stop with the last subscriber), and one user operation at a time.
- I also ran a real server against a diverged repo and checked it with headless Chromium. The banner, tooltip and Remotes view render as intended.

\### Decisions and trade-offs
- **Include flag key:** `remote.<name>.gitracSync` instead of the suggested `gitrac.sync.<remote>`. `git remote rename` and `git remote remove` then carry or drop it automatically.
- **Last fetch time:** gitrac records it per remote in `<git-common-dir>/gitrac/last-fetch.json`. `FETCH_HEAD`'s mtime is used only when a newer terminal fetch names that remote, because `FETCH_HEAD` can't tell remotes apart.
- **Fetch takes no lock** and has no `mutationLock`, so it never waits behind edits. Pull, push and sync take the repo lock inside the service, after fetching. The include toggle uses `mutationLock`.
- **Conflict prediction:** the status flags a diverged remote whose merge would conflict, so the red banner can appear before anyone clicks Sync. It needs git 2.38 or later; on older git `conflicts` is `null`.
- **Sync errors are a 200 with `ok: false`.** Per-remote failures go in `result.remotes`. Only state that blocks the whole operation (merge in progress, detached HEAD) returns 409.
- **Git operations in progress:** cherry-pick and revert are also detected, besides merge and rebase.

\### Follow-ups
- There is no `gitrac sync` CLI command yet. The service layer is ready for one; it needs `cliServiceContext` and output formatting.
- `useGitStatus` in `hooks.ts` still runs its own `setInterval` (30s). It predates this change and I left it alone.
- The vite bundle-size warning (over 500 kB) was already there.

**Orchestrator notes:** merged after #123; the conflicts were both features adding a route mount, a sidebar component, an `api.ts` block, a README bullet, a spec API row group and a sentence in the skill's `serve` row (both kept; the duplicated skill row was merged into one). Changed "Can not" to "Cannot" in the sync messages. Full suite after the merge: 1822 tests, 0 failures.

**Orchestrator browser verification** (scratch clone with two local bare remotes, `origin` and `mirror`, and a second clone pushing to `origin`):
- Diverged from `origin`, ahead of `mirror`: the sidebar showed `↑1 ↓1`; one click on Sync made a merge commit (no rebase), pushed to both remotes, and the indicator turned to `in sync`.
- Both clones edited the same issue description: the status predicted the conflict, Sync aborted the merge (no `MERGE_HEAD`, no conflict markers, local text intact, tree clean), did not push to `mirror`, and showed the red banner "Cannot sync with origin: merge conflicts" with the terminal commands to run.
