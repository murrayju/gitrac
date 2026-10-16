---
id: 95
title: >-
  IssueWatcher never watches .issues/closed/ if the directory did not exist at
  server startup
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:12:41.648Z'
createdBy: Justin Murray
updated: '2026-10-16T19:27:47.922Z'
---

Git does not track empty directories, so in a fresh clone/worktree or a repository with no closed issues yet, `.issues/closed/` does not exist on disk when `gitrac serve` starts (see #71).

In `src/web/watcher.ts`, `IssueWatcher.start()` loops over `[issuesDir, closedDir]` once at startup with `recursive: false` and ignores `ENOENT` when `.issues/closed/` is missing. Once the first issue is closed (`mkdir('.issues/closed', { recursive: true })`), `IssueWatcher` never attaches a watcher to `.issues/closed/` (nor re-attaches if git removes and recreates the directory across branch checkouts).

As a result, subsequent edits, comments, or deletions on closed issues never emit `issues-changed` SSE events and never bump `watcher.generation()` (leaving `ElsewhereCache` stale as well).

## Acceptance criteria

- `IssueWatcher` detects when `.issues/closed/` is created (or recreated) after `start()` and attaches a watcher to it so changes inside `.issues/closed/` always emit debounced change events and bump `generation()`.
- Tests in `src/web/` verifying that starting `IssueWatcher` when `.issues/closed/` does not exist still emits change events when `.issues/closed/` is created later and files inside it are modified.

---

### Justin Murray — 2026-10-16T19:27:47.526Z

`IssueWatcher` now watches `.issues/closed/` even if the directory is missing at startup or is removed and recreated later. Changes inside it emit debounced `issues-changed` events and bump `generation()` again. Typecheck passes, the targeted tests pass (10/10, repeated several runs), and the full suite passes (1281/0). Lint reports one warning, which is also there without my changes.

\## What was wrong
`start()` tried to watch `[.issues, .issues/closed]` once and silently skipped `closed/` if it didn't exist. Git doesn't track empty directories, so a fresh clone has no `closed/`. After the first close created it, nothing ever watched it, so later edits to closed issues sent no SSE events and left `ElsewhereCache` stale.

I also found a bug in the pinned Bun 1.3.11 on Linux: once a watched directory is deleted, a new `fs.watch` on the same path gets no events. Bun keeps a stale entry for that path and skips the new `inotify_add_watch`. Bun 1.4.0 and 1.4.3 fix this. Separately, Bun sometimes drops a second event of the same type that arrives within a millisecond, so the `.issues/` watcher can miss a `closed/` create or remove. The compiled binary ships with 1.3.11, so the fix can't rely on events alone.

\## What changed
- **`src/web/watcher.ts`**
  - **Separate watchers:** one for `.issues/`, and at most one for `.issues/closed/`.
  - **Resync on events:** any event on `.issues/` re-checks `closed/`. An event named `closed` always replaces its watcher, because a new directory can get the old one's inode.
  - **Resync from `closed/` itself:** events from the `closed/` watcher also re-check it, because Bun 1.4.x sometimes reports the removal only there.
  - **Before attaching:** the old watcher is always closed first, so watchers don't leak. On `error`, the watcher closes itself.
  - **1 s `stat` fallback** (`CLOSED_DIR_POLL_MS`, `unref`'d):
    - If `closed/` appears, goes away or gets a new inode, it attaches a new watcher and records a change.
    - If the directory's mtime changed with no watcher event, it records a change. gitrac writes issue files as temp file + rename, which changes that mtime.
  - **Other changes:**
    - `start()` can safely be called twice.
    - `stop()` also clears the poll timer.
    - A new `watchedDirCount()` lets tests count open watchers.
    - An optional `{ pollMs }` constructor option lets tests use a short interval. Existing callers are unchanged.
- **`docs/specs/2026-03-28-gitrac-design.md`:** the web-layer section now describes this behaviour.

\## Tests added
- **`src/web/watcher.test.ts`** (new):
  - `closed/` created after `start()`: events, emits and `generation()` work.
  - `closed/` present at start.
  - Removed and recreated 3 times: events still arrive. This runs on 1.3.11 thanks to the poll.
  - No more than one `closed/` watcher across recreations.
  - Calling `start()` twice opens no extra watchers.
  - `stop()` closes everything.
- **`src/web/routes/events.test.ts`:** an end-to-end SSE test. It removes `closed/`, starts the watcher and connects a client, then creates `closed/` and writes a file inside it. It expects `issues-changed` and a higher `generation()`.

All but one of the new watcher tests fail against the original code; the "`closed/` present at start" case passed before too. They also pass on Bun 1.4.3.

\## Decisions
- **Polling cost:** the fallback is one `statSync` per second per server. It's needed because 1.3.11 can't re-watch a recreated path. Once the pinned Bun reaches 1.4 or later, it only covers dropped events and could be removed.
- **Delay in the worst case:** if an event is lost, the change can show up up to about 1 s late.
- **Mtime limit:** the mtime check only sees changes that add, remove or rename files in `closed/`. An in-place edit of an existing file on 1.3.11, after the directory was recreated, is only caught by the watcher. gitrac's own writes always use rename.
