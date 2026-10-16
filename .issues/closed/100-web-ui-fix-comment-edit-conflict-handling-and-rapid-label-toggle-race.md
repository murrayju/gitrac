---
id: 100
title: 'Web UI: fix comment edit/conflict handling and rapid label toggle race'
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:13:25.851Z'
createdBy: Justin Murray
updated: '2026-10-16T20:34:46.453Z'
---

Several UI state and concurrency bugs in `CommentList.tsx` and `MetadataPanel.tsx`:

1. **`InlineCommentEditor.handleSave` (`src/web/ui/components/CommentList.tsx:161`):** calls `onSave(md)` without `await` (and types `onSave` as `(body: string) => void`), so `setSaving(false)` runs immediately before the request completes and non-`ConflictError` rejections go unhandled.
2. **`CommentItem` conflict handling (`src/web/ui/components/CommentList.tsx:215, 225`):** when `updateComment` or `deleteComment` throws `ConflictError`, it alerts *"This issue was changed elsewhere since it was loaded. The latest version is now shown; please try again."* without calling `applyIssue(e.current, e.version)` or `refetch()`. Also, the React key `${comment.author}-${comment.timestamp}` can collide if two comments by the same author have the same timestamp; include the index.
3. **Rapid label toggle race (`src/web/ui/components/MetadataPanel.tsx:32-44`):** `handleToggleLabel` and `handleCreateLabel` compute `newLabels` from `issue.labels` props without optimistic state or `If-Match`. Clicking two checkboxes in `LabelPicker` before the first SSE refetch arrives causes the second `PATCH` to overwrite the first toggle.

## Acceptance criteria

- `InlineCommentEditor` awaits `onSave(md)`, keeps `saving` true until completion, and surfaces save errors instead of dropping them.
- `CommentList` updates the issue state (`applyIssue(e.current, e.version)`) when a `ConflictError` occurs on comment edit/delete.
- `MetadataPanel` avoids losing rapid label toggles (and/or guards metadata updates against stale props).
- Tests.

---

### Justin Murray — 2026-10-16T20:34:46.071Z

I've fixed all three bugs from #100. Typecheck and lint are clean, `./bun test src/web --only-failures` passes (385 tests, 0 failures), and the Vite build succeeds with only its usual large-chunk warning.

\## What was wrong
- **Inline comment save:** `InlineCommentEditor` called `onSave(md)` without `await`. "Saving..." went away straight away, and any error other than a conflict was an unhandled rejection. Posting a new comment in `CommentEditor` had the same problem.
- **Comment conflicts:** when editing or deleting a comment got a 409, the UI said "the latest version is now shown" but never loaded it. Also, the React key `${author}-${timestamp}` could be the same for two comments.
- **Label toggles:** each toggle built the new label list from `issue.labels` in the props. Two clicks before the refresh arrived both started from the same old list, so the second PATCH undid the first.

\## What changed
- **New `src/web/ui/lib/request-state.ts`:** `trackRequest(action, { setBusy, setError })` keeps the busy state until the request finishes and turns any failure into a message. Both comment editors use it and show the error inline, the same way `DescriptionEditor` shows `saveError`. The text is kept on failure, and a second submit while one is running is ignored.
- **New `src/web/ui/lib/comment-write.ts`:**
  - `guardedCommentWrite` loads the latest issue and version on a 409, then shows the alert.
  - `commentKeys` builds the React keys (see trade-offs).
- **Wiring:** `IssueDetail` passes its existing `applyIssue` to `CommentList` as `onConflict`, so there is no new fetching. After a conflict the edit stays open with the draft. A delete that fails for another reason now gets an alert instead of an unhandled rejection.
- **New `src/web/ui/lib/label-updates.ts`:**
  - `toggleLabel` / `addLabel` / `sameLabels` are small helpers for label lists.
  - `createLabelUpdater` keeps a list of labels not yet saved and applies each toggle to it. It sends the PATCHes one at a time, and edits made before a queued PATCH starts go out together in one request.
  - When the queue empties, the last response goes to `IssueDetail` (`applyIssue` then `refetch`, renamed from `handleDescriptionSaved` to `handleIssueSaved`).
  - A failed save drops the unsaved labels and shows an inline error.
  - No `If-Match`, as you asked.
- **`upload-error.ts`:** the existing `reason()` is now exported as `requestErrorReason`, so every error message uses the server's error text the same way.
- **Docs:** the Detail View section of `docs/specs/2026-03-28-gitrac-design.md` now describes all of this.

\## Tests
- **`label-updates.test.ts`:** the #100 case (two toggles from the same stale props keep both), one request at a time, edits merged into one request, toggling a label on then off, a toggle that changes nothing, and a failure.
- **`comment-write.test.ts`:** keys stay unique for duplicates and stay the same when a comment above is removed; a 409 loads the latest issue before the alert; other errors are passed to the caller.
- **`request-state.test.ts`:** busy stays on until the request finishes, failures become a message and are never thrown, and network errors get their own message.
- These are unit tests of the helpers. No test renders the React components themselves.

\## Decisions and trade-offs
- **Comment keys:** I didn't put the list index in the key, which differs from your guidance. Each key is `author-timestamp-n`, where n counts earlier comments with the same author and timestamp. Duplicates still can't collide, and a key doesn't change when a comment above it is deleted, so an open inline editor isn't remounted and doesn't lose its draft. An index-based key would remount it on every shift.
- **Shared queue:** toggles and "create label" go through the same queue, so a new label can't overwrite a toggle either.
- **Labels on screen:** while saves are pending the panel shows the unsaved list, even if an SSE refresh changes the props. It goes back to the props when the queue empties, once `applyIssue` and `refetch` have run.
- **Status, priority and assignee:** these still send last-writer-wins PATCHes with no inline error, as before. They're single values, so they can't race the way labels did.

\## Follow-ups noticed
- Status, priority, assignee and the title `saveTitle` in `IssueDetail` still drop errors (unhandled rejections). They could use `trackRequest` too.
- The comment conflict notice is still a `window.alert`. An inline notice like the description editor's would fit better.

**Orchestrator browser verification:** on a scratch repo, clicking the `feature` and `docs` checkboxes in the label picker in the same tick saved both (`gitrac show 1 -o json` labels: `bug, feature, docs`). Merged with #104, which made the same `requestErrorReason` export; the spec's Detail View now describes both changes.
