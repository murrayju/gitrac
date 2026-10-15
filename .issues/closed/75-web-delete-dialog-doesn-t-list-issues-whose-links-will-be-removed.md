---
id: 75
title: Web delete dialog doesn't list issues whose links will be removed
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-15T16:06:59.362Z'
createdBy: Justin Murray
updated: '2026-10-15T19:44:31.048Z'
---

Since #68, deleting an issue also strips `blockedBy`/`parent` references from other issues. The CLI shows them in its plan and `--dry-run`, but the web confirmation dialog only says links will be removed.

## Acceptance criteria

- Dry-run support on the API (e.g. `DELETE /api/issues/:id?dryRun=1`, or a `GET .../delete-plan`) returning the same plan as the CLI `--dry-run`: the issue, assets, and `unlinked` issues. No writes.
- The UI confirmation dialog lists the assets and linked issues that will change before the user confirms.
- Tests for the dry-run route.

---

### Justin Murray — 2026-10-15T19:44:31.048Z

\## #75: The web delete dialog now lists what will be removed and unlinked

**What was wrong.** Since #68, deleting an issue also removes `blockedBy`/`parent` links from other issues. The CLI lists those issues in its plan and in `--dry-run`. The web UI had no way to get that plan: its `window.confirm` only said that links "will be removed", without naming the issues or the assets.

`./bun run check` passes (1192 tests) and `./bun run vite build --config vite.config.ts` succeeds. I haven't tried the dialog in a browser yet.

**What changed**
- **API dry run:** `DELETE /api/issues/:id?dryRun=1` (or `true`) calls `deleteIssue(..., { dryRun: true })` from the service layer and writes nothing. It returns the same plan as `gitrac delete --dry-run -o json`: `{ deleted: false, issue, paths, assets, unlinked }`.
  - The response carries the issue's `ETag`, taken from the version the plan was built from. The client sends it back as `If-Match` when confirming, so a change in between gets a 409 instead of a deletion the user didn't see. This works like the CLI's check that the issue didn't change while the prompt was open.
  - It honors `If-Match`, returns 404 for a missing issue and 400 for a bad ID, like a real delete. `dryRun=0`, `false` or `no` means a real delete.
- **UI:** clicking "Delete issue" now fetches the plan (the button reads "Checking…" meanwhile). A new modal, `DeleteIssueDialog`, lists:
  - the issue file;
  - the assets used only by this issue (or "No images are only used by this issue.");
  - each linked issue as `#id title (blocked by, parent)` (or "No other issues link to #N.").

  It has Cancel/Delete buttons and closes on Escape or a backdrop click (not while a delete is running). Confirming deletes with the plan's version. A 409 at either step shows the latest version and alerts, as before.
- **Docs:** the spec's API table and Detail View description cover the dry-run route and the new dialog. The skill and `AGENTS.md` don't mention the delete API, so I left them alone.

**Files**
- `src/web/routes/issues.ts` (small change, only in the DELETE route)
- `src/web/routes/issues-delete.test.ts` (4 new tests)
- `src/web/ui/api.ts`: `fetchDeletePlan`, and `IssueDeletion.deleted` is now `boolean`
- `src/web/ui/components/DeleteIssueDialog.tsx` (new)
- `src/web/ui/components/IssueDetail.tsx`
- `docs/specs/2026-03-28-gitrac-design.md`

**Decisions and trade-offs**
- I used a query parameter on `DELETE` rather than a separate `GET .../delete-plan`. It reuses the route's same-origin guard, lock, `If-Match` handling and error mapping, and it parallels the CLI's `--dry-run`. The cost is that the dry run waits in the mutation lock queue.
- Linked issues in the dialog are plain text, not links, because following one would leave the dialog open on another page.

**Tests:** the new tests fail without the fix. A real delete ignores `dryRun`, so the "writes nothing" test fails. They check:
- the full plan, including assets and both kinds of links, with no commit, no file changes and the links still in place;
- that `dryRun=true` previews and `dryRun=0` deletes;
- that the plan's ETag confirms the delete, and a change made after the plan gets a 409;
- `If-Match`, 404 and 400 on the dry-run route.

**Follow-ups noticed:** none that affect #85, #87 or #90.

**Orchestrator browser verification:** on the demo repo, "Delete issue" on #2 opens a dialog listing the issue file, "No images are only used by this issue.", and the two issues whose `blockedBy` links will be removed (#3, #5). Cancel leaves everything untouched (no commit).
