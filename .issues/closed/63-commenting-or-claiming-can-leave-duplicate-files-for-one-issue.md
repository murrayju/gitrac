---
id: 63
title: Commenting or claiming can leave duplicate files for one issue
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T01:16:54.902Z'
createdBy: Justin Murray
updated: '2026-10-15T01:41:18.084Z'
---

Found during #51. `addComment` and `claimIssue` (open issue) write the issue under the filename derived from the *current* title, but never remove an existing file whose slug differs (e.g. title edited by hand in the markdown, or older slug rules). The result is two files for the same issue ID; `findIssueFile` then returns whichever comes first in `readdir`.

Close/reopen/edit already handle this via `relocateIssue` — use it everywhere an issue is rewritten (service layer).

## Acceptance criteria

- Every service write path removes the old file when the computed filename differs, and commits the deletion.
- Duplicate IDs on disk are detected: `findIssueFile` (or a `gitrac doctor` check) reports an error listing the conflicting files instead of silently picking one.
- Tests for comment/claim on a file whose name doesn't match its title.

---

### Justin Murray — 2026-10-15T01:41:18.084Z

\## #63: An issue can no longer end up as two files after a comment or claim

**What was wrong**
- `addComment`, `editComment`, `deleteComment` (through `writeInPlace`) and `claimIssue` saved the issue under the filename its current title gives. When the file on disk had a different name (title edited by hand, older slug rules), they left the old file in place. `claimIssue` only removed the old file when the issue was in `closed/`.
- After that, `findIssueFile` returned whichever file it found first, with no warning.

**What changed**
- **Every write goes through `relocateIssue`.** All writes to an existing issue (update, comment add/edit/delete, close, reopen, claim, unclaim) now call it, and they all return the old path with the new one. A deleted or renamed path in that list ends up in the commit, which the new CLI test checks.
- **`relocateIssue` renames instead of write-then-delete.** When the path changes, it writes the new contents into the old file and then `rename`s it to the new path. Before, it wrote the new file and then deleted the old one. That left a short moment with two files, which a reader without the lock (web `GET`, `show`) would now report as a duplicate error. With the rename there is exactly one file at every moment.
- **Duplicates are reported.** `findIssueFile` reads both `.issues/` and `.issues/closed/`. If more than one file has the ID, it throws a new error, `duplicate_issue`, with exit code 3 (the existing "conflict" code). The details include `id` and `files` (repo-relative paths), and the message tells the user to keep one and delete the rest. Nothing is written.
  - `loadStoredIssue` passes this error through as-is instead of wrapping it as "unreadable", so the web API doesn't turn it into a 404.
  - The web API answers 409 `{ error, code: "duplicate_issue", files }`, both for `GET /api/issues/:id` and for mutations of that issue.
  - `respondWithIssue` still falls back to the in-memory issue if reading it back fails.

**Files**
- `src/core/errors.ts`: new `duplicate_issue` code and `duplicateIssue()` helper.
- `src/fs/issue-store.ts`: duplicate check in `findIssueFile`, rename-based `relocateIssue`, `issueRelPath` helper.
- `src/service/issues.ts`, `src/service/claim.ts`, `src/service/load.ts`.
- `src/web/routes/issues.ts`.
- Tests:
  - `src/fs/issue-store.test.ts`
  - `src/service/issues.test.ts`
  - `src/service/claim.test.ts`
  - `src/web/routes/issues.test.ts`
  - `src/cli/structured-errors.test.ts`

  They cover comment/edit-comment/delete-comment/claim/claim --force/unclaim on a file whose name doesn't match its title, a misnamed file in `closed/`, duplicates rejected with nothing written, exit 3 with `files` in the JSON error, and a real git run confirming the rename is committed. Eight of these failed against the old code; the unclaim one already passed because unclaim handled renames before.
- Docs:
  - `docs/specs/…-gitrac-design.md`: File Lookup section, exit-code table, JSON error fields, API table.
  - `skills/using-gitrac/SKILL.md`: exit-code table.
  - `AGENTS.md`: rewrite existing issues with `relocateIssue`, not `writeIssue`.

**Decisions / trade-offs**
- I put the duplicate check in `findIssueFile` rather than adding a `gitrac doctor` command. Every single-issue read and write reports the problem, and nothing tries to fix it automatically, since the copies may have different content.
- A duplicate across `.issues/` and `.issues/closed/` also counts.
- `deleteIssueFile` no longer has callers outside tests; I kept it exported.

**Follow-ups noticed**
- `gitrac ls` and web `GET /api/issues` read every file, so they still show a duplicated ID twice instead of reporting it. That code belongs to #52, so I didn't touch it.
- #54 (ID allocation) also edits `src/fs/issue-store.ts`. My changes there are limited to `findIssueFile`, `relocateIssue` and the new `issueRelPath` helper; I didn't touch `allocateNextId`.

`./bun run check` passes: 726 tests, 0 failures. The first run had one failure in an AmendTracker git test (it timed out and couldn't start `git`); `src/git/` alone and the full check both passed on re-run.
