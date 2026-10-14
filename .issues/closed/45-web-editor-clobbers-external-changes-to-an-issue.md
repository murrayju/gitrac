---
id: 45
title: Web editor clobbers external changes to an issue
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T23:35:47.336Z'
---

The Tiptap editor's `content` is only used at mount. When the file changes externally (CLI, agent, git pull) the SSE refetch updates `issue`, but the editor still shows old text, and the next debounced autosave PATCHes the stale description back — silently reverting the external change.

The API has no optimistic concurrency at all: PATCH is last-writer-wins.

## Acceptance criteria

- PATCH accepts a base version (e.g. `updated` timestamp or content hash / ETag via `If-Match`) and returns 409 on mismatch.
- UI: when an external change arrives and the editor isn't dirty, update editor content; if dirty, show a conflict notice rather than overwriting.
- Tests for the 409 path.

---

### Justin Murray — 2026-10-14T23:35:47.336Z

I added optimistic concurrency to the issue API and a conflict-aware description editor. A stale save now gets a 409 instead of silently reverting someone else's change. `./bun run check` passes (512 tests) and the Vite UI build succeeds. I couldn't run a browser, so the UI flow has only been type-checked and built; its decision logic is unit-tested separately. I did check the server against a real `gitrac serve` in a scratch repo: after a CLI comment, a PATCH with the old `If-Match` got 409, and with the fresh one got 200.

\## What was wrong
The Tiptap editor only reads its `content` when it first loads. When the file changed outside the browser (CLI, agent, `git pull`), the SSE refetch updated `issue`, but the editor kept showing the old text. The next debounced autosave then sent that old description back. The API had no concurrency check at all (whoever wrote last won), and nothing stopped out-of-order refetches from overwriting newer data.

\## What changed
**Server**
- **Version tag:** each issue gets an `ETag`, which is a SHA-1 of the file's raw bytes. Any change to the file, from any source, produces a new tag.
- **409 on mismatch:** `PATCH /issues/:id` and the comment add/edit/delete, close and reopen routes accept `If-Match: <etag>` (or `*`). The check runs inside the existing repo lock. On a mismatch they return **409** `{ error, current }` with the current issue and its `ETag`, and write and commit nothing.
- **No header = old behaviour:** requests without `If-Match` still overwrite as before, so curl, scripts and the metadata dropdowns are unaffected.
- **Responses match GET:** the GET route and every mutation return the issue as re-read from disk, plus its `ETag`. The response body and tag are exactly what a later GET returns, so a save never looks like an external change.

**UI**
- **`api.ts`:** adds `ApiError` and `ConflictError` (which carries `current` and `version`), plus `fetchIssueVersioned` and `updateIssueVersioned`. `updateComment` and `deleteComment` can now send a base version.
- **`useIssue`:** now returns `version` and an `applyIssue` function. It ignores fetch responses older than data it has already applied.
- **New `DescriptionEditor`:** autosaves one request at a time, each sent with `If-Match` set to the version its content is based on. When a newer version arrives (refetch or 409):
  - Only comments or metadata changed: it adopts the new version and retries a save that got a 409.
  - The description changed and there are no unsaved edits: it loads the new text into the editor.
  - The description changed and there are unsaved edits: autosave pauses and a notice offers "Discard mine, load theirs" or "Keep mine, overwrite theirs", with a preview of the other version.
- **Comment edit/delete:** comments are addressed by position in the list, so these now send the version too. On a 409 they show an alert instead of editing the wrong comment.

\## Files
- **New:** `src/web/etag.ts` (+ test), `src/web/routes/issues-conflict.test.ts`, `src/web/ui/lib/description-sync.ts` (+ test), `src/web/ui/components/DescriptionEditor.tsx`
- **Server:** `src/web/routes/issues.ts`, `src/fs/issue-store.ts` (new `readIssueContent`; `readIssue` uses it)
- **UI:** `src/web/ui/api.ts`, `hooks.ts`, `components/IssueDetail.tsx`, `IssueEditor.tsx` (handle gains `setContent`/`getMarkdown`, new `onEdit` prop), `CommentList.tsx`, `CreateIssueModal.tsx` (ref now uses the exported `IssueEditorHandle` type)
- **Docs:** `docs/specs/2026-03-28-gitrac-design.md` (Concurrency section, API table, Detail View), `AGENTS.md` (convention), `skills/using-gitrac/SKILL.md` (one sentence)

\## Decisions and trade-offs
- **Whole-file tag, not `updated`:** it catches hand edits and pulls, and doesn't depend on clocks. The downside is that unrelated changes also cause a 409; the editor handles that by adopting the new version and retrying, so the user sees no notice.
- **409 rather than 412:** the issue's acceptance criteria call for 409.
- **"Unsaved edits" is tracked by counting edits,** not by comparing markdown, because Tiptap's markdown output doesn't match the stored text exactly.
- **Title stays last-writer-wins:** it's an explicit, single-field edit.
- **Refetch after each save:** after a successful save the UI fetches the issue again, so an external change made while the save was in flight isn't missed.

\## Follow-ups noticed (not fixed)
- The inline comment editor also only reads its body when it opens. It can overwrite a comment that was edited elsewhere while it's open; the version check only catches changes the UI hasn't loaded yet.
- An edit still waiting on the autosave delay is lost if you navigate away from the issue (this was already the case).
- `InlineCommentEditor` calls `onSave` without awaiting it, so its "Saving..." state is meaningless (also already the case).
- The new `--description` options from #43 will make CLI edits a common source of these conflicts. This change handles that case.
