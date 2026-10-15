---
id: 68
title: Deleting an issue leaves dangling dependency references
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T13:15:03.763Z'
createdBy: Justin Murray
updated: '2026-10-15T13:46:02.346Z'
---

`gitrac delete` / `DELETE /api/issues/:id` (#59) removes the issue file but other issues may still reference it in `blockedBy` or `parent` (#55). They're treated as resolved/missing, but the references linger forever.

## Acceptance criteria

- `deleteIssue` removes the deleted ID from every other issue's `blockedBy` and clears `parent` where it pointed to the deleted issue, under the same lock, in the same commit (bumping `updated` on the touched issues).
- `--dry-run` / the confirmation plan lists the issues whose links will be removed; JSON output includes them.
- Tests (service, CLI, web).

---

### Justin Murray — 2026-10-15T13:46:02.346Z

Deleting an issue now also removes the links other issues had to it. The removal happens under the same lock and goes into the same commit. `./bun run check` passes (typecheck, lint, 1005 tests).

**What was wrong**
`deleteIssue` removed only the issue file and the images only it used. Other issues kept the deleted ID in their `blockedBy` or `parent` for good. They were read as resolved or missing, but never cleaned up.

**What changed**
- **Service (`src/service/delete.ts`):** under the repo lock, `deleteIssue` loads every open and closed issue and finds the ones that point at the deleted ID. For each, it:
  - removes the ID from `blockedBy`, and drops the field if nothing is left;
  - clears `parent` if it pointed at the deleted issue;
  - bumps `updated` and rewrites the file through `relocateIssue`, so a stale filename gets renamed and both paths are committed.

  Those files, plus any images they reference (same rule as `link`/`unlink`), go into the single `issue: delete #N` commit. The result has a new field, `unlinked: [{ id, title, blockedBy, parent, paths }]`, which a dry run fills in too.
- **New `onDeleted` option:** it reports the result after the files are written and before the commit. The CLI used to work out the image list from the commit paths (`paths.slice(1)`), which breaks now that the commit also holds rewritten files, so it uses `onDeleted` instead.
- **CLI (`src/cli/commands/delete.ts`):** the plan and the result add a `Would remove links to #N from:` / `Removed links to #N from:` section, one `#M: <title> (blockedBy, parent)` line per issue. JSON and YAML output include `unlinked`. This applies to `--dry-run`, to the plan printed before the confirmation prompt, and to the refusal when there's no terminal.
- **Web:** `DELETE /api/issues/:id` returns `unlinked`. The UI's `IssueDeletion` type gains the field, and the confirmation dialog text now says links are removed.
- **Docs:** updated the Deleting section, the API table and the "resolved blockers" note in `docs/specs`, the delete row in `skills/using-gitrac/SKILL.md`, and the `delete` line in `AGENTS.md`.

**Files:** `src/service/delete.ts` and its test, `src/cli/commands/delete.ts` and its test, `src/web/routes/issues.ts`, `src/web/routes/issues-delete.test.ts`, `src/web/ui/api.ts`, `src/web/ui/components/IssueDetail.tsx`, `docs/specs/2026-03-28-gitrac-design.md`, `skills/using-gitrac/SKILL.md`, `AGENTS.md`.

**Decisions and trade-offs**
- **`paths` meaning unchanged:** it still lists only what is removed (the issue file, then the images). The rewritten files are in `unlinked[].paths`, and the commit covers both. This keeps the existing JSON and HTTP output compatible.
- **Files that can't be read** are skipped during the scan. But if an issue that links to the deleted one has two files or a malformed file, the delete stops with `duplicate_issue` / `invalid_issue` before anything is written. I chose that over a partial cleanup.
- **The prompt check doesn't cover linked issues:** while the confirmation prompt is open, `If-Match` and the "changed while asking" check still only watch the deleted issue. The set of issues to unlink is worked out again under the lock when the delete runs, so it can differ slightly from the plan that was shown.
- **The web UI has no preview step:** the confirm dialog says links will be removed but doesn't list the issues.

**Tests added**
- **Service:** removing from `blockedBy` (fully and partly), clearing `parent` on a closed issue, untouched issues, one commit with the right files, the dry-run plan, the stale-filename rename, committing the images those issues reference, `onDeleted` running before the commit, and a failing precondition changing nothing.
- **CLI:** `--dry-run` output in human and JSON form, and `--yes` producing one commit with a clean tree.
- **Web:** the `unlinked` response and the rewritten files.

**Follow-ups / interactions**
- Links on other branches or in other worktrees aren't touched (now noted in the spec). They still read as resolved or missing.
- **#69 (renumber):** if it rewrites references to a renumbered ID, the "find issues that point at an ID" scan in `referencingIssues` could be shared.
- **#67:** that change is in `issues.ts` and doesn't overlap with this one.
