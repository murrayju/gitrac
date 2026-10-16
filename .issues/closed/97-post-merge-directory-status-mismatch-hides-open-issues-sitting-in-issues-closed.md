---
id: 97
title: >-
  Post-merge directory/status mismatch hides open issues sitting in
  .issues/closed/
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:12:43.845Z'
createdBy: Justin Murray
updated: '2026-10-16T20:01:56.766Z'
---

When branch A closes an issue at `T1` (moving `.issues/1-foo.md` to `.issues/closed/1-foo.md`) and branch B updates it at `T2 > T1` with an open status (keeping it in `.issues/1-foo.md`), `git merge` resolves the rename to `.issues/closed/1-foo.md` and invokes `gitrac merge-driver`. `mergeIssueFrontmatter` picks branch B's open status (`T2 > T1`), leaving an issue with an open status inside `.issues/closed/` (or, in the inverse case, a closed status inside `.issues/`).

Because `listIssues` (`src/service/list.ts:62`) only reads `.issues/closed/` when `includesClosed(query, config)` is true, an open-status issue sitting in `.issues/closed/` is completely hidden from `gitrac ls` (default open filter) and `GET /api/issues`.

## Acceptance criteria

- Ensure `listIssues` does not hide an open-status issue whose file is in `.issues/closed/` (or relocate/surface mismatched files consistently).
- Add regression tests in `src/service/` and `src/cli/commands/list.test.ts` for open-status issues in `.issues/closed/` and closed-status issues in `.issues/`.

---

### Justin Murray — 2026-10-16T20:01:56.360Z

Open issues sitting in `.issues/closed/` now show up in `gitrac ls` and `GET /api/issues`, and comment or link writes move a misplaced file to the right directory. Typecheck and lint are clean (0 warnings, 0 errors), and all 1131 tests in `src/core`, `src/fs`, `src/service`, `src/cli` and `src/web` pass. The new tests fail without the fix: 6 of 8 in the service file and 3 of 4 in the CLI file.

\## What was wrong
- **Hidden issues:** `listIssues` only read `.issues/closed/` when the query could match a closed status. So an open-status file in `closed/` (after a merge, as the issue describes) was missing from `gitrac ls` and `GET /api/issues`. Both call `listIssues`, so they were equally affected.
- **"Repaired on the next write" was only partly true:** that was true for `update`, `close`, `reopen` and `claim`. But comment add/edit/delete, `link`/`unlink`, the link cleanup done by `delete`, and `renumber` all wrote the file back to whichever directory it was already in. A misplaced file stayed misplaced after those writes.

\## What changed
- **`src/service/list.ts`:** `listIssues` now always loads both directories, using the same loader as `loadAllIssues`. Filtering is by status only. It also returns `misplaced`: the paths of files whose directory doesn't match their status.
- **`src/cli/commands/list.ts`:** `ls` prints one stderr line per misplaced file: `Warning: issue file <path> is in the wrong directory for its status; the next change to the issue moves it`. stdout and JSON output are unchanged. The web API ignores `misplaced`.
- **Write paths:** `writeInPlace` (comments), `writeLinks`, the delete link cleanup (including its planned `paths`, via `rewritePaths(stored, config)`) and `renumber` now choose the directory with `isClosedStatus(config, issue.status)`. No status names are hard-coded, and no new repair command.
- **`src/core/query.ts`:** removed `includesClosed` and its tests. It was only used for the old skip and encoded the folder-based rule.
- **Docs:** the `ls` filtering rules and the merge "Renames" paragraph in `docs/specs/2026-03-28-gitrac-design.md`, plus a new bullet under "Merging Branches" in `skills/using-gitrac/SKILL.md`.

\## Tests
- **`src/service/list.test.ts` (new):**
  - An open issue in `closed/` is listed by default and with its status.
  - A closed issue in `.issues/` is listed only with `done` or `all`.
  - `misplaced` is reported.
  - `update`, `comment`, `link` and the link cleanup done by `delete` each move the file.
  - Nothing is misplaced after repair.
- **`src/cli/commands/list.test.ts`:**
  - `ls` filters by status, not folder.
  - The stderr warning appears and stdout stays clean.
  - The CLI and `GET /api/issues` return the same IDs.
  - `edit` and `comment` relocate the files, after which the warning is gone.
- **`src/service/issues.test.ts`:** one existing test ("a comment on a closed issue stays in closed/") used an open-status file in `closed/` and expected it to stay there. That is exactly the bug, so its fixture now has `status: done`.

\## Decisions and trade-offs
- **Speed:** a default `ls` now reads all closed files. On this repo (15 open, 95 closed) `listIssues` went from about 4–8 ms to about 40–45 ms, and the whole `ls` from about 0.37 s to about 0.45 s. Process startup and git dominate. With roughly 950 closed issues the default list took about 300 ms, the same cost `--status all` already had; most of it is YAML parsing. I think that's acceptable for correctness. If big repos ever need it, the alternative is to parse only the frontmatter of `closed/` files to decide open or closed before parsing them fully. I did not build that.
- **The warning:** cheap, because the loader already knows each file's directory. It's on `ls` only.

\## Follow-ups noticed (not changed)
- **Claim on a misplaced file:** `decideClaim` and `decideUnclaim` (`src/core/claim.ts`, given `inClosedDir`) still treat a file in `closed/` as closed even when its status is open. So `claim` on such an issue fails with "Issue #N is closed (todo)" unless you use `--force`.
- **`next --claim` on a misplaced file:** `ready` lists such an issue, so `next --claim` can pick it and then fail with the same error. A quick fix is to judge by status only there. The docs only promise repair on edit, comment, link, close and reopen.

**Orchestrator addition (fixes the first two follow-ups above):** `decideClaim` and `decideUnclaim` (`src/core/claim.ts`) now judge closed by status only, like the listing. The `inClosedDir` option is removed. Before, `ready` would list an open-status issue left in `closed/`, then `next --claim` picked it and failed with exit 4 every time, which could stall an agent loop. `claim`/`unclaim` already write the file to `.issues/`, so they also move a misplaced file. New tests in `src/service/list.test.ts` (`next --claim` and `unclaim` on an open issue in `closed/`) fail without this change; the `decideClaim` unit test now expects a claim.
