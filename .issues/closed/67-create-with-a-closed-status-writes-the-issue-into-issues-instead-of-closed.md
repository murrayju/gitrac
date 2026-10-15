---
id: 67
title: create with a closed status writes the issue into .issues/ instead of closed/
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T13:15:02.879Z'
createdBy: Justin Murray
updated: '2026-10-15T13:39:39.756Z'
---

`gitrac create -t x -s done` (and `POST /api/issues` with a closed `status`) writes the new file into `.issues/` rather than `.issues/closed/`, leaving a half-closed issue (closed status, open directory).

## Acceptance criteria

- Creating an issue with a closed status (per the configurable workflow from #57) writes it directly into `.issues/closed/` and commits that path.
- Same behavior for CLI and web (service layer).
- Tests for both surfaces.

---

### Justin Murray — 2026-10-15T13:39:39.756Z

\## #67: creating an issue with a closed status now writes it to `.issues/closed/`

**What was wrong.** `createIssue` (`src/service/issues.ts`) always wrote the new file into `.issues/` and committed `.issues/<file>`, whatever the status. So `gitrac create -s done` or `POST /api/issues {status: "done"}` left an issue that had a closed status but sat in the open directory.

**What changed**
- **`src/service/issues.ts`:** `createIssue` now checks the assembled status with `isClosedStatus(config, …)`, using the configured workflow rather than fixed names. It writes the file with `writeIssue(…, { closed })` and commits `issuePath(filename, closed)`. CLI and web both use this one code path.
- **`src/fs/issue-store.ts`:** `writeIssue` now creates its target directory if it's missing. Git doesn't keep empty directories, so a fresh clone can lack `.issues/closed/`, and creating the first issue there failed with ENOENT. This also helps every other write that goes through `writeIssue`/`relocateIssue`, such as `close` in a fresh clone.

**Tests** (each of the five new tests fails without the fix; the missing-directory one fails without the `mkdir`):
- `src/service/issues.test.ts`:
  - `done` → file and commit path are in `closed/`, and an open status still goes to `.issues/`.
  - Creating into a missing `closed/` works.
- `src/service/workflow.test.ts`: a custom closed status (`wontfix`) goes to `closed/`, and a custom open one (`review`) stays open.
- `src/cli/commands/close.test.ts`: `create -s done` writes and commits `.issues/closed/2-…md` with a clean tree. After that, `close` returns exit 3 and `reopen` works.
- `src/web/surface-parity.test.ts`: in a real git repo, `POST /api/issues` with `status: done` commits only `.issues/closed/1-…md`, uses the CLI's commit message, and leaves a clean tree.

**Docs:** the `create` row and the "always exactly one file" paragraph in `docs/specs/2026-03-28-gitrac-design.md`, and the statuses paragraph in `skills/using-gitrac/SKILL.md`.

`./bun run check` passes (999 tests).

**Decisions and trade-offs**
- The `mkdir` lives in `writeIssue` rather than the create path, so every surface and operation gets it in one place. It's a two-line change to a shared file. #69 (renumber) may also touch `issue-store.ts`, but the edit is small and local.
- There's no other `defaultStatus` handling: a closed `defaultStatus` is already rejected as `invalid_config` (#57), so only an explicit status can create a closed issue.

**Noticed, not changed**
- An untracked `download` file was already in the worktree before I started; I didn't touch it.
