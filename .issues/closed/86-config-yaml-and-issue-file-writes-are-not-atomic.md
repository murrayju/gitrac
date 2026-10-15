---
id: 86
title: config.yaml and issue file writes are not atomic
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:09.213Z'
createdBy: Justin Murray
updated: '2026-10-15T18:28:54.423Z'
---

`writeConfig` and the issue writers use plain `writeFile`. A reader without the lock (web GETs, `ls`) can observe a half-written file, and a crash mid-write corrupts it.

## Acceptance criteria

- Config and issue writes go through write-to-temp-in-same-dir + `rename`, preserving the existing rename semantics of `relocateIssue` (#63/#71).
- Temp files never match `*.md` / `config.yaml` (so they're never listed or committed) and are cleaned up on failure.
- Tests.

---

### Justin Murray — 2026-10-15T18:28:54.423Z

Config and issue file writes are now atomic: each write goes to a temp file in the same directory, which is then renamed over the real file. `./bun run check` passes (1150 tests).

**What was wrong**
`writeConfig`, `writeIssue` and `relocateIssue` (in `src/fs/issue-store.ts`) used plain `writeFile`, which empties the file and then rewrites it. Readers that don't take the lock (web GETs, `ls`, scans from other worktrees) could see an empty or half-written file. A crash mid-write could corrupt `config.yaml` or an issue.

**What changed**
- **New `src/fs/atomic-write.ts`:**
  - `atomicWriteFile(path, content)` writes a temp file next to the target, fsyncs it, then renames it over the target, so readers see either the old file or the whole new one.
  - The temp file is created exclusively (`wx`). If anything fails it is deleted and the target is left alone.
  - It keeps the existing file's permission bits.
  - If the target is a symlink, it writes the file the link points to instead of replacing the link.
  - `atomicTempPath` builds the temp name: hidden, same directory (so the rename is atomic), unique per call: `.<name>.<pid>.<uuid>.tmp`. It never ends in `.md` and is never `config.yaml`, so these never pick it up:
    - `listIssueFiles` and the scans in `elsewhere.ts` and `ids.ts`, which all filter on `.md`;
    - the merge driver, which only routes `*.md` and `config.yaml`;
    - commits, which stage explicit paths.
  - The file watcher still fires on the temp file and the rename, but the refetch it triggers only lists `.md` files, so it causes no errors.
- **`src/fs/issue-store.ts`:**
  - `writeConfig` and `writeIssue` use `atomicWriteFile`.
  - `relocateIssue` keeps its rename behaviour (#63/#71), including the `mkdir` of the target directory before the move. It replaces the old file atomically, then renames it to the new path. I didn't write the temp file straight to the new path, because that would briefly leave two copies of the issue.
- **Docs:** added an "Atomic file writes" bullet under Concurrency in `docs/specs/2026-03-28-gitrac-design.md`, and corrected the note there and in the `src/fs/gitignore.ts` header that said gitrac never puts temp files under `.issues/`.

**Tests**
- `src/fs/atomic-write.test.ts` (new) covers: the temp name rules, a new file, replacement by rename (new inode), keeping permissions, writing through a symlink, clean-up when the rename fails, a missing directory, and a reader running alongside 1 MB rewrites that never sees a partial file.
- `src/fs/issue-store.test.ts` checks that `writeConfig`, `writeIssue` and `relocateIssue` (rewrite in place and move) replace the file by rename and leave no temp file, and that a failed write leaves no temp file behind.
- With the helper swapped back to plain `writeFile`, 5 of these tests fail.

**Trade-offs**
- The fsync adds almost nothing: `src/service/issues.test.ts` took 1.70s with it and 1.56s without.
- A process killed between writing the temp file and the rename can leave a stray `.*.tmp` file under `.issues/`. It's never listed or committed by gitrac, but a user's `git add -A` would pick it up. I didn't add `.*.tmp` to the managed `.issues/.gitignore`: that changes what `install-merge-driver` and `init` write, and it would touch this repo's `.issues/`.

**Follow-ups noticed (not changed)**
- Possible follow-up: add `.*.tmp` to the `ISSUES_GITIGNORE_LINES` list in `src/fs/gitignore.ts`.
- Other writes still use plain `writeFile`: `.issues/.gitignore` (`gitignore.ts`), `.issues/.gitattributes` (`merge-driver.ts`, `ensureGitattributes`), and drafts (`Bun.write` in `web/routes/drafts.ts`). They could move to `atomicWriteFile` if needed.
- #84 (keeping unknown frontmatter keys) works with the same write paths, but only changes what gets serialized, so it shouldn't conflict with this.

**Orchestrator addition:** added `.*.tmp` to the managed `.issues/.gitignore` lines (`ISSUES_GITIGNORE_LINES`), so a temp file left by a process killed mid-write is ignored by `git add -A`; existing projects pick it up on the next `install-merge-driver`/draft save (idempotent append). Tests updated, plus a `git check-ignore` check for an `atomicTempPath` name.
