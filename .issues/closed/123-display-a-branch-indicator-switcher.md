---
id: 123
title: display a branch indicator/switcher
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-21T20:43:33.860Z'
createdBy: Justin Murray
updated: '2026-10-21T21:53:47.150Z'
---

The web interface is normally expected to work out of the `main` branch, and edit the tickets there. There is already a warning banner when on a different branch. We should show a small indicator with the branch name, and allow switching branches (when clean) via a picker.

---

### Justin Murray — 2026-10-21T21:53:47.150Z

\## Branch indicator and switcher for the web UI (#123)

The sidebar now always shows the checked-out branch, or `detached at <sha>`, and has a picker to switch to another local branch. typecheck, lint (0 warnings, 0 errors), the Vite build and all tests in `src/core`, `src/git`, `src/service`, `src/web` and `src/cli` pass.

\### What was wrong or missing
- The web UI only showed the "not on the default branch" banner. It didn't show the branch name, and there was no way to switch branches from the browser.
- With a detached HEAD, `getBranchWarning` said `You are on branch "HEAD"`. The banner said the same thing.

\### What changed
New files, as the orchestrator asked:
- **`src/core/branches.ts`** (pure rules, no git):
  - It parses `for-each-ref` output and `status --porcelain -z` output.
  - `branchNameError` refuses empty names, non-strings, names starting with `-` and control characters.
  - `decideSwitch` returns `noop` for the current branch. It throws `invalid_input` for a name that isn't a local branch. It throws `invalid_state` for:
    - a branch checked out in another worktree,
    - a branch with no gitrac config,
    - a merge, rebase, `am`, cherry-pick, revert or bisect in progress,
    - modified or staged tracked files. The message names up to 5 of the paths.
- **`src/git/branches.ts`**:
  - `readBranchState` returns the state that `GET /api/git/branches` serves.
  - `operationInProgress` finds a merge, rebase etc. by checking the marker files git leaves in its git dir.
  - `gitSwitch` runs `git switch --no-guess -- <branch>`. If git refuses, the error carries git's own message.
- **`src/service/branches.ts`**: `switchBranch` checks the name first, then reads the state and switches under `withRepoLock`.
- **`src/web/routes/branches.ts`**:
  - `GET /api/git/branches` returns the branch state.
  - `POST /api/git/switch` runs behind `mutationLock`. After a real switch it calls `ctx.amendTracker.clear()` and `ctx.elsewhere?.invalidate()`, and re-reads the config.
  - Errors: 400 for bad input, 409 for `invalid_state` or `git_error`.
  - It is mounted with one line in `server.ts`.
- **UI**:
  - `BranchSwitcher.tsx` is mounted above "Acting as" with one edit in `Layout.tsx`.
  - Its display logic is in `lib/branch-picker.ts`. The picker uses a native `<select>` with `select-caret` and `pl-1.5`.
  - Picking a branch asks for confirmation first. A refusal shows the server's message below the picker.
  - The API helpers are one block at the end of `api.ts`.

Small edits to existing files:
- **`getBranchWarning`** now says `HEAD is detached at abc1234, not on the default branch "main".` `BranchWarning.tsx` uses matching wording.
- **`hooks.ts`**: I added an exported `refetchGitStatus()`, so the banner updates right after a switch. `useGitStatus` is otherwise unchanged.
- **Docs**: the design spec (Server, API table, UI views), the README web UI section and the skill's `serve` row are updated.

\### Tests
- **Core**: list and status parsing, name checks, the switch decision, and the message wording.
- **Git and service, against real temp repos**:
  - a clean switch, and a switch to the current branch (no-op);
  - modified files and staged files refused;
  - untracked files kept across a switch;
  - git refusing to overwrite an untracked file, with git's message;
  - a branch checked out in another worktree refused;
  - a branch without gitrac refused;
  - unknown, option-like and remote-only names rejected;
  - a merge in progress refused;
  - switching from a detached HEAD;
  - the switch waiting for the repo lock.
- **Routes, through `createApp`**: the GET shape, 200/400/409 responses, 403 for cross-origin requests, the `mutationLock` wait, and the amend tracker, scan cache and config being reset after a switch.
- **Other**: the detached-HEAD warning wording, and `branch-picker` (what the picker lists, marks and disables).

\### Decisions and trade-offs
- **Branches with no `.issues/config.yaml` are listed but can't be picked** (marked `(no gitrac)`). This rule wasn't in your spec. A switch to such a branch (e.g. `gh-pages`) would remove the issues the server works on. The API reports these branches as `uninitialized` and refuses them with 409.
- **Extra API fields**: `dirtyPaths` and `dirtyCount` let the tooltip name the dirty files. `operation` can also be `am`, `revert` or `bisect`, not only merge, rebase and cherry-pick.
- **`git switch --no-guess`**: git never creates a branch from a remote-tracking one, even if the name check were bypassed.
- **When the branch list refreshes**: it is one shared query, refetched on `issues-changed`, on the shared 15s tick and when the tab regains focus. So a `git switch` run in a terminal shows up too, even when the issue files are the same on both branches.
- **`useGitStatus` still uses its own 30s timer.** I left it alone as instructed and only added the refetch hook.

\### Follow-ups noticed
- `GET /api/git/status` still reports a detached HEAD as `branch: "HEAD"`, so `BranchWarning` checks for that string. Returning `branch: null` there would be cleaner, but that file belongs to #122.
- The CLI has no `gitrac switch` command. It isn't needed, since plain `git switch` works there.

**Orchestrator browser verification** (scratch repo with `main`, `feature` and an orphan `gh-pages`): the sidebar shows "Branch: main" and the picker lists `feature`, `gh-pages (no gitrac)` (disabled) and `main`. Picking `feature` asks for confirmation, then switches the worktree: the list shows the feature-only issue and the "not on the default branch" banner appears at once. With a modified tracked file the picker is disabled with the reason as its tooltip, and `POST /api/git/switch` answers 409 naming the file; an option-like name is 400 and a cross-origin request is 403.
