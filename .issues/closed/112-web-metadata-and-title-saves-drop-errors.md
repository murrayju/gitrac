---
id: 112
title: Web metadata and title saves drop errors
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T21:58:39.311Z'
createdBy: Justin Murray
updated: '2026-10-17T13:33:39.930Z'
---

Found by #100. Comment saves and label toggles now show errors inline, but the status, priority and assignee dropdowns (`MetadataPanel`, `IssueRow`) and the title editor (`saveTitle` in `IssueDetail`) still drop failures as unhandled rejections. The comment conflict notice is also a `window.alert`.

## Acceptance criteria

- These saves use `trackRequest` (`src/web/ui/lib/request-state.ts`) and show a failure inline.
- The comment conflict notice is inline, like the description editor's.
- Tests for any new helper.

---

### Justin Murray — 2026-10-17T13:33:39.431Z

I've implemented #112. Typecheck and lint are clean, the 440 tests under `src/web` pass, and the Vite build succeeds.

\## What was wrong
- Changing status, priority or assignee in the sidebar (`MetadataPanel`), and status or priority in a list row (`IssueRow`), called `updateIssue` without catching errors. A failed save was silently dropped and the user saw nothing.
- `saveTitle` in `IssueDetail` closed the title input before the save started. A failure lost the typed title and showed nothing.
- A conflict when editing or deleting a comment (someone else changed the issue first) showed a `window.alert`. A failed comment delete also used an alert.

\## What changed
- **New helper `src/web/ui/lib/save-queue.ts`**: `createSaveQueue({ setBusy, setError })`. Each save runs through `trackRequest`, one at a time and in order, so a second pick made while the first is saving is not lost and the last pick wins. A failure doesn't stop later saves. The busy flag stays on until the queue is empty. Errors read `Failed to save <field>: <reason>`, using the message from `requestErrorReason`. The helper never rejects.
- **`MetadataPanel.tsx`**: status, priority and assignee share one queue and one error line (`role="alert"`) at the top of the sidebar. The error clears when you open another issue. Labels and claim controls are untouched.
- **`IssueRow.tsx`**: each row has its own queue. A failure shows as a small one-line `role="alert"` under the title, with the full text on hover.
- **`IssueDetail.tsx`**: the title input stays open while saving (read-only) and only closes once the save succeeds. On failure it keeps the typed text and shows `Failed to save title: …` below. Enter or blur retries, Escape cancels. A ref stops Enter followed by blur from saving twice. The save now uses `updateIssueVersioned` with no `If-Match` (same last-writer-wins as before) so the saved issue shows straight away.
- **`comment-write.ts` / `CommentList.tsx`**: the conflict message moved into the helper as `COMMENT_CONFLICT_MESSAGE`, and `guardedCommentWrite` now passes it to `notify(message)`. Each comment shows it as a dismissible amber `role="alert"` notice, styled like the description editor's conflict notice. The latest issue is still shown on a conflict, and an open editor keeps its draft. A failed delete now shows inline through `trackRequest`, and a second delete click is ignored while one is running.
- **Docs**: `docs/specs/2026-03-28-gitrac-design.md` now describes these inline errors and the title editing behaviour. I also corrected "Inline status/assignee quick-edit" to "status/priority", because the list row has no assignee dropdown. `SKILL.md` needed no change because it doesn't describe these UI details.

\## Tests
- `save-queue.test.ts` covers: a failure message includes the field name and doesn't throw; a second save waits for the first, and busy stays on until both finish; a failed save doesn't block the next one; a new save clears the last error.
- `comment-write.test.ts` now checks that `notify` receives `COMMENT_CONFLICT_MESSAGE`.

\## Decisions and trade-offs
- Sidebar and row values are still not changed optimistically. The dropdown keeps showing the saved value and the live update shows the new one, as before. So a failed save never leaves a wrong value on screen.
- The busy state is only exposed as `aria-busy`. I didn't disable the dropdowns, because the queue already keeps every pick.
- The conflict notice lives in the comment itself. If the latest issue no longer contains that comment (deleted elsewhere), the comment and its notice both disappear, and the missing comment is the visible result.

\## Follow-ups noticed
- Deleting an issue in `IssueDetail` still uses `window.alert` for its conflict and failure messages. I left these alone as instructed.
- `AssigneePicker` adds new assignees through `updateAssignees`. I didn't check how it handles errors, since it's outside this issue.

**Orchestrator browser verification:** with `PATCH` requests failing (a patched `fetch` returning 500), changing priority showed "Failed to save priority: Simulated failure" at the top of the sidebar while the dropdown kept the saved value, and saving a new title kept the input open with "Renamed title" and showed "Failed to save title: Simulated failure" below it. (The "error shows on the next issue" trade-off can't happen: `App` keys `IssueDetail` by ID, so the panel remounts on navigation.)
