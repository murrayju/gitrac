---
id: 50
title: CLI reopen hard-codes backlog instead of config.defaultStatus
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T00:43:26.283Z'
---

`src/cli/commands/reopen.ts` sets `status = 'backlog'` while the web route uses `config.defaultStatus`. Make them consistent (use `defaultStatus`), and consider `reopen -s <status>`.

Also: remove the leftover test label `foo` from `.issues/config.yaml`.

---

### Justin Murray — 2026-10-15T00:43:26.283Z

\## #50: close and reopen now set the same statuses in the CLI and web, and refuse no-op transitions

`./bun run check` passes (655 tests). Nothing is committed.

\### What was wrong
- **Reopen status:** `gitrac reopen` always set `status: backlog`. The web reopen route used `config.defaultStatus`.
- **Closing a closed issue:** in both the CLI and the web, this rewrote the issue instead of failing. The code wrote a fresh copy into `.issues/` and then moved it over the closed file. The status changed, `updated` was bumped, any `-c` comment was added, and a commit was made. The web route returned 200.
- **Moving the file:** close and reopen both wrote the file under the name built from the title, then moved whatever file `findIssueFile` found first. If the title had been edited by hand so the filename no longer matched, this could leave two files for one issue.

\### What changed
- **New `src/core/lifecycle.ts`:** pure rules that the CLI and web routes now share.
  - `assertCanClose` and `assertCanReopen` throw `invalid_state` (exit 3) when an issue is already fully closed (file in `.issues/closed/` and status `done`/`cancelled`) or already fully open.
  - `reopenStatus(config, requested?)` returns the requested status if it is a configured non-closed status (otherwise `invalid_input`, exit 2). With no request it returns `config.defaultStatus`.
- **New `relocateIssue` in `src/fs/issue-store.ts`:** writes the issue into the target directory, deletes the file it was read from if that path is different, and returns both paths for the commit.
- **CLI (`src/cli/commands/close.ts`, `reopen.ts`):** both now read the issue and its location, run the check, then relocate, all before writing anything. `reopen` uses `defaultStatus` and has a new `-s, --status <status>` option.
- **Web (`src/web/routes/issues.ts`):**
  - The close and reopen routes run the same checks. A failed check returns **409** `{ error, code: "invalid_state", current }` with an `ETag`, the same shape as the `If-Match` conflict response.
  - Reopen accepts an optional body `{ status }`, which returns 400 if invalid.
  - Both routes use `relocateIssue`.
- **Docs:** the command table, exit-code table and API table in `docs/specs/2026-03-28-gitrac-design.md`, plus `skills/using-gitrac/SKILL.md`.

\### Tests
- `src/core/lifecycle.test.ts`: unit tests for the new rules.
- `src/cli/commands/close.test.ts` (new): runs the real CLI in a scratch repo. It checks that closing a closed issue exits 3 with `invalid_state` and leaves the file and commit count unchanged. It also covers reopen using `defaultStatus`, `-s` accepting and rejecting statuses, and reopen of an open issue exiting 3.
- `src/web/routes/issues.test.ts`: the close and reopen 409 cases, reopen with `defaultStatus` and with a body status, 400 for a bad status, and the repair and stale-filename cases.

All but the reopen-of-an-open-issue checks fail without the fix. The old CLI already failed that case: it exited 3, after its config read and before writing.

\### Decisions and trade-offs
- **Half-way states can be repaired:** a `done` issue left in `.issues/`, or an open-status issue sitting in `closed/`, can be either closed or reopened, which puts it right. Only fully closed or fully open issues are rejected. This differs from `claim`, which treats either signal alone as closed.
- **Misconfigured default:** if `defaultStatus` is itself a closed status, reopen falls back to the first open configured status, so a reopened issue is never left closed.
- **Web close status:** it still always sets `done`; there is no "cancelled" option, as before.
- **Not done:** `.issues/config.yaml` (the `foo` label) is untouched, as you asked.

\### Things that touch other issues
- **#48:** the web reopen route still calls `readConfig(dir)` for `defaultStatus`, while it reads `autoCommit` and `commitPrefix` from `ctx.config`. The new web test for `defaultStatus` writes `config.yaml` to disk, so if #48 switches this route to `ctx.config`, reloading must pick that up or the test needs adjusting.
- **#49:** close and reopen now pass the paths from `relocateIssue` to `amendTracker.commitOrAmend`, usually two paths and no longer a fixed open-plus-closed pair.
- **Unused functions:** `moveToClose` and `moveToReopen` are no longer called outside their own tests. I left them in place.
- **UI:** `src/web/ui/api.ts` would turn the new 409 into a `ConflictError`, because the body includes `current`. The UI doesn't call `closeIssue` or `reopenIssue` today.

**Orchestrator notes:** removed the leftover test label `foo` from `.issues/config.yaml` (no issues used it). Adjusted the new web `defaultStatus` reopen test to also write `git.autoCommit: false`, since #48 now reloads config from disk on every request.
