---
id: 38
title: 'Concurrent mutations race: duplicate IDs and git lock failures'
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:42:33.551Z'
---

Nothing serializes gitrac writes.

- `allocateNextId` is an unlocked read-modify-write of `config.yaml`.
- Every CLI invocation and every web request runs `git add`/`git commit` independently.
- The web server handles overlapping autosave/comment requests concurrently.

Running 5 `gitrac create` in parallel produced two issues numbered #5 and four `fatal: cannot lock ref 'HEAD'` failures.

This blocks using gitrac with parallel agents.

## Acceptance criteria

- A cross-process lock (e.g. a lockfile under `$(git rev-parse --git-common-dir)/gitrac.lock` with stale-lock detection) wraps the read-modify-write + commit of every mutation, in both CLI and web server.
- Within the web server, mutations are additionally serialized through an in-process queue.
- ID allocation also checks existing filenames so a duplicate ID is never produced even if `nextId` is stale.
- Test: N parallel creates produce N distinct IDs and N commits with no errors.

---

### Justin Murray — 2026-10-14T22:42:33.551Z

I added a repo-wide lock that now covers every CLI and web mutation. Parallel creates and comments no longer produce duplicate IDs, lost updates, or `cannot lock ref 'HEAD'` failures. `./bun run check` passes (338 tests), and the new stress tests passed on 3 repeated runs.

\## What was wrong
Nothing serialized gitrac writes. `allocateNextId` read, bumped and rewrote `config.yaml` with no lock. Every CLI process and every web request ran its own read-modify-write plus `git add`/`commit` at the same time as the others. The result was duplicate IDs, lost comments and git ref-lock failures.

\## What changed
- **`withLock` (`src/fs/lock.ts`)**: a reusable lock primitive, built so #51 can call it directly.
  - **Across processes:** a lockfile created atomically (temp file + hard link). It records the holder's pid, hostname and a token.
  - **Within a process:** callers queue first-in-first-out per lock path before competing for the file. This is how the web server serializes its own requests.
  - **Stale locks:** a lock counts as stale if its holder on the same host has died, or if it hasn't been touched for 60s. A live holder refreshes the timestamp every 15s, so a long push isn't mistaken for a dead lock. Stale locks are only removed under a secondary `.break` lock after re-checking the contents, so a freshly taken lock is never deleted.
  - **Other behaviour:** nested calls inside a held lock don't deadlock, and the lockfile is removed even if the process calls `process.exit()` while holding it.
  - **Waiting:** waiters back off with jitter and give up after 120s with a `LockTimeoutError` that names the holder.
- **`withRepoLock` (`src/git/lock.ts`)**: puts the lock at `$(git rev-parse --git-common-dir)/gitrac.lock`, so all worktrees share it. Outside a git repo it falls back to a per-directory lock in the temp dir. `commitPaths`, `commitOrAmend`, push and pull also take the lock themselves as a safety net; this costs nothing when the caller already holds it.
- **CLI**: a new `withMutationLock` in `global-options.ts` wraps the whole sequence of `init`/`create`/`edit`/`comment`/`claim`/`close`/`reopen`: reading config, ID allocation, file writes, commit and push. It applies with `--no-commit` too. Prompts, stdin reading and author lookup stay outside the lock. A lock timeout prints an error and exits 1.
- **Web**: a `mutationLock` middleware (`src/web/lock.ts`) is on every route that writes issue or config files. A lock timeout returns HTTP 503.
- **ID allocation** (`allocateNextId`) now uses the larger of `nextId` and the highest existing open or closed filename ID + 1, so a stale `nextId` can't produce a duplicate.
- **Docs**: a new Concurrency section and an updated ID scheme in `docs/specs/…-design.md`, a note on parallel safety in `skills/using-gitrac/SKILL.md`, and a rule in `AGENTS.md` that new mutations must hold the lock.

\## Tests
- `src/fs/lock.test.ts` (+ child-process helper `lock.fixture.ts`):
  - in-process order and exclusivity, release when the callback throws, nesting;
  - not deleting a lock someone else took over;
  - breaking locks left by a dead pid or a too-old file, but never by pid for another host; timeouts;
  - a 4-process counter test where any overlap would lose updates;
  - the timestamp refresh, which I confirmed fails when the refresh is disabled;
  - cleanup after `process.exit`, and recovery after SIGKILL.
- `src/git/lock.test.ts`: the lock path from the repo root, a subdirectory and a linked worktree, plus the non-git fallback.
- `src/cli/concurrency.test.ts`:
  - 8 parallel `create` processes give IDs 1–8, 8 commits (one issue file each), a clean tree and `nextId` 9;
  - 8 parallel `--no-commit` creates get distinct IDs;
  - 8 parallel comments on one issue are all kept;
  - 8 concurrent creates within one process.
- `src/web/routes/issues-concurrency.test.ts`: 8 concurrent web creates; 8 concurrent comments, all kept and committed via amend; 4 web requests racing 4 CLI processes.
- `allocateNextId` tests for a stale `nextId`.

With the lock turned into a pass-through, all 7 new CLI and web stress tests fail. The files take about 15s together.

\## Decisions and trade-offs
- Push happens inside the lock. That's safer (concurrent pushes fight over the remote-tracking ref), but other writers wait while a push is slow. The timestamp refresh keeps such a holder from looking dead.
- Asset uploads and drafts don't take the lock. Uploads write new uniquely named files, drafts aren't tracked in git, and a slow upload shouldn't block other writers.
- The lockfile mechanism was chosen because Bun has no `flock`.
- Nesting is tracked per async context, so background work started inside a lock is also treated as holding it. This is documented in the code.

\## Follow-ups and interactions
- **#51**: the shared service layer should call `withRepoLock` once per operation.
- **#42**: claim is now an atomic read-and-write under the lock, so an exclusivity check can go inside it.
- **#48**: web routes still read `ctx.config` (cached) for defaults and `autoCommit`. The lock doesn't refresh that cache.
- **#54 / #56**: the filename check only covers the current checkout. Worktrees share the lock but each has its own `.issues/`, so IDs can still collide across worktrees and branches.
- **#45**: the lock serializes web saves but doesn't detect an editor working from stale content.
- **#53**: `pullRebase` now takes the lock, but it still isn't used anywhere.
