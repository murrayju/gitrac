---
id: 76
title: Rejected image uploads are not surfaced in the web UI
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:00.243Z'
createdBy: Justin Murray
updated: '2026-10-15T18:47:56.768Z'
---

Since #39, uploads reject SVG and files over 10 MiB (400/413), but the editor's image paste/drop handler only logs the failure to the console. The user sees nothing happen.

## Acceptance criteria

- Upload failures (unsupported type, too large, network/server error) show a visible, dismissible message near the editor with the server's error text.
- No placeholder or broken image is left in the document.
- Unit-test the error mapping where practical; UI build passes.

---

### Justin Murray — 2026-10-15T18:47:56.768Z

Rejected or failed image uploads now show up in the web UI. A dismissible red message appears beside the editor with the server's error text, and nothing is inserted into the document. `./bun run check` passes (1153 tests) and the Vite build succeeds. I haven't tried it in a browser yet.

**What was wrong**
- Since #39 the server rejects SVG (400) and files over 10 MiB (413), but the editor's paste/drop handler only logged failures to the console.
- The attach button in the new-issue form swallowed failures entirely.
- `uploadAsset` threw a plain `Error` with the raw response body, so the server's `{"error": "..."}` text never reached the user.

**What changed**
- **Error mapping** (`src/web/ui/lib/upload-error.ts`): `uploadErrorMessage(err, fileName)` builds messages like `Couldn't upload "logo.svg": Unsupported file type: .svg`.
  - It prefers the server's `error` field (plain or `{message}` form), then a short plain-text body.
  - An HTML or empty 413 becomes "File is too large"; any other unusable body becomes "Server error (HTTP n)".
  - A fetch `TypeError` becomes "Network error: could not reach the server"; other errors use their message.
- **API** (`src/web/ui/api.ts`): `uploadAsset` now throws `ApiError(status, body)`, the same as other requests.
- **Upload plugin** (`src/web/ui/lib/image-upload-plugin.ts`):
  - `ImageUpload` now takes `onError` / `onStart` options.
  - The upload logic is exported as `uploadImage(view, file, opts)`. It inserts the image only after the upload succeeds, so a failure leaves no placeholder or broken image.
  - Two small fixes: it skips insertion if the editor was closed during the upload, and keeps a stale drop position within the document's current length.
- **UI** (`src/web/ui/components/UploadError.tsx`, new): a `useUploadError()` hook and an `UploadError` banner (`role="alert"`, × to dismiss). Starting a new upload clears the old message.
  - The banner is wired into `IssueEditor` (description and new-issue form), `CommentEditor` and the inline comment editor in `CommentList`.
- **New-issue attach button** (`CreateIssueModal.tsx`): now calls a new `IssueEditorHandle.uploadImage(file)`, so it uses the same path and error display as paste/drop.
- **Docs**: one sentence added to the Uploads section of `docs/specs/2026-03-28-gitrac-design.md`.

**Tests**
- `src/web/ui/lib/upload-error.test.ts`: covers each case of the error mapping.
- `src/web/ui/lib/image-upload-plugin.test.ts`: runs a real Tiptap editor (happy-dom) with a mocked `fetch`. It checks a successful insert, then 400 SVG, 413, 502 HTML and network failure: each must call `onError` with the expected text and leave the document unchanged. It also checks the position clamp. These fail without the fix.

**Decisions and trade-offs**
- The banner shows only the most recent failure; if several dropped files fail, the last message wins.
- There is no client-side check on file type or size, so the server stays the single source of truth for upload limits and their wording.
- `IssueEditorHandle.insertImage` is now unused but I left it in place.
- The editor callbacks come from a stable `useMemo`/`setState`, because Tiptap reads extension options only when the editor is created.

**Follow-ups noticed**
- The attach button's file picker still uses `accept="image/*"`, which lets users choose SVG. They now get a clear error, but limiting the picker to the allowed types would be better.
- `DescriptionEditor`'s save error and the comment conflict `window.alert` use different error styles; they could share this banner later.

**Orchestrator browser verification:** in the new-issue modal, attaching an SVG via the attach button shows a dismissible alert `Couldn't upload "test.svg": Unsupported file type: .svg`, nothing is inserted into the description, and no asset file is written.
