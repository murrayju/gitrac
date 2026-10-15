---
id: 59
title: Add a delete command
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T02:23:21.915Z'
---

There's no way to delete an issue (e.g. duplicates or test issues) besides `git rm`. Add `gitrac delete <id>` (with confirmation unless `--yes`) and a corresponding API route + UI action. Consider also cleaning up assets only referenced by the deleted issue.

---

### Justin Murray — 2026-10-15T02:23:21.915Z

Added a `gitrac delete` command, a `DELETE /api/issues/:id` route and a "Delete issue" action in the web UI. All three use one new service operation. `./bun run check` passes (789 tests). I also tried the command by hand in a scratch repo.

**What was wrong**
The only way to delete an issue (duplicates, test issues) was `git rm` by hand. That skips the repo lock and the commit conventions, and leaves behind the images (assets) the issue used.

**What changed**
- **Service (`src/service/delete.ts`)**: new `deleteIssue(ctx, id, { precondition?, dryRun? })`.
  - It runs under `withRepoLock` and loads the issue with `loadStoredIssue`, so not-found, several-files-for-one-ID and `If-Match` checks behave like other mutations.
  - It removes the issue file, open or closed, plus any image in `.issues/assets/` that only this issue used.
  - It commits through `commitChange` with the message `issue: delete #N <title>`, so `--no-commit`, `autoCommit` and push settings all apply.
  - It returns `{ issue, paths, assets, config, commit }`. `dryRun` reports what would be deleted without touching disk.
- **Which images get deleted**: an image is a candidate if the issue references it, the file exists, and its name is a plain filename. The new `isAssetFilename` in `src/core/assets.ts` rejects names containing `/`, `\` or `..`, so a reference like `/.issues/assets/../config.yaml` can never delete anything outside the folder. The image is kept if its filename appears anywhere in another issue (open or closed) or a web draft (`.issues/drafts/*.json`). If any of those files can't be read, all images are kept.
- **Web commits (`src/service/commit.ts`)**: the web normally folds quick follow-up edits into the issue's previous commit. A delete is now always a new commit and ends that chain. Folding it into the create commit would leave an empty commit.
- **CLI (`src/cli/commands/delete.ts`, alias `rm`)**:
  - `-y/--yes` deletes without asking; `--dry-run` prints the plan and exits 0.
  - Without `--yes` on a terminal, it prints what would be deleted and asks `Delete issue #N? [y/N]`.
  - Without `--yes` when stdin is not a terminal (agents, scripts), it prints the plan to stdout and exits 2 with a new error code, `confirmation_required`.
  - The prompt happens outside the lock. If the issue changes while the prompt is open, the delete is refused with `invalid_state` (exit 3) and nothing is removed.
  - `-o json`/`yaml` prints `{ deleted, issue, paths, assets }`, before the commit as other commands do.
- **Web**:
  - `DELETE /api/issues/:id` honors `If-Match`: a stale version gets 409 with the current issue and its ETag. Missing issue is 404, bad ID is 400; success is 200 `{ deleted: true, issue, paths, assets }`.
  - The UI has a "Delete issue" button at the bottom of the detail sidebar. It asks for confirmation, sends the version on screen, goes back to the list on success, and on a 409 shows the latest version with an alert.
- **Docs**: `AGENTS.md`, `skills/using-gitrac/SKILL.md` (quick reference, exit-code table, and a note to use `close --cancelled` for real work you've dropped) and `docs/specs` (commands table, new "Deleting" section, `--no-commit` list, exit codes, API routes, If-Match list, detail view).

**Files affected**
- New: `src/service/delete.ts`, `src/cli/commands/delete.ts`, plus tests `src/service/delete.test.ts`, `src/cli/commands/delete.test.ts`, `src/web/routes/issues-delete.test.ts`.
- Modified:
  - Source: `src/core/assets.ts`, `src/core/errors.ts`, `src/service/context.ts` (adds `'delete'` to the operation type), `src/service/commit.ts`, `src/cli/index.ts`, `src/web/routes/issues.ts`, `src/web/ui/api.ts`, `src/web/ui/components/IssueDetail.tsx`.
  - Tests: `src/core/assets.test.ts`, `src/service/commit.test.ts`.
  - Docs: `AGENTS.md`, `skills/using-gitrac/SKILL.md`, `docs/specs/2026-03-28-gitrac-design.md`.
- Shared files only got small, contained additions: one command registration in `index.ts`, one error code in `errors.ts`, one operation name in `context.ts`.

**Decisions and trade-offs**
- **Exit code**: I used a new code, `confirmation_required`, on exit 2 rather than reusing `invalid_input`, so agents can tell "needs `--yes`" apart from bad input. Existing exit codes are unchanged.
- **Image matching is loose**: any mention of the filename elsewhere keeps the image. This can leave an orphan behind but never deletes a shared one.
- **Other branches**: images used only by issues on other branches can't be seen and may be deleted. They remain in git history.
- **Images are always committed on delete**: the removal is committed from the CLI too, even though the CLI normally doesn't commit asset files.
- **IDs aren't reused**: new IDs come from the shared high-water mark in the git dir, which already counted the deleted one. A test covers this.

**Follow-ups noticed**
- If #53's merge driver or conflict handling assumes issue files only get modified or renamed, it may need to handle a delete on one branch and an edit on the other.
- The CLI tests are slow, about 1.8s each, because each test runs several CLI processes during setup.
