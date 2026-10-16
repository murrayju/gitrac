---
id: 99
title: >-
  Web API: handle malformed issues in GET /issues/:id/dependencies and bad JSON
  in PUT /drafts/:filename
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-16T12:12:46.052Z'
createdBy: Justin Murray
updated: '2026-10-16T19:51:49.226Z'
---

Several small input/error-handling gaps in the web routes:

1. **`GET /api/issues/:id/dependencies` (`src/web/routes/issues.ts:419-423`):** catches `isDuplicateIssue(err)` (409) but omits `if (isInvalidIssue(err)) return invalidIssueResponse(c, err)` (which `GET /api/issues/:id` has at line 264). A malformed issue file causes an unhandled 500 instead of a 409 JSON error.
2. **`PUT /api/drafts/:filename` (`src/web/routes/drafts.ts:57-58`):** calls raw `await c.req.json()` and sets `body.savedAt = ...` without `readJsonBody`/`asRecord`, throwing an unhandled 500 on malformed JSON or non-object bodies (`null`, `[]`, `"str"`).
3. **Filename checks in `drafts.ts` and `assets.ts`:** only check `filename.includes('/') || filename.includes('..')`; align with `isAssetFilename` (`src/core/assets.ts`) to also reject `\\` and `\0`.

## Acceptance criteria

- `GET /api/issues/:id/dependencies` returns 409 `invalid_issue` on malformed issue files, matching `GET /api/issues/:id`.
- `PUT /api/drafts/:filename` validates the request body with `readJsonBody` and rejects non-object / invalid JSON with 400.
- `drafts.ts` and `assets.ts` reject `\\` and `\0` in filenames with 400.
- Route tests in `src/web/routes/`.

---

### Justin Murray — 2026-10-16T19:51:48.769Z

\## Summary

I fixed three error-handling gaps in the web routes. Typecheck and lint are clean (0 warnings, 0 errors), and all 349 tests in `src/web/` pass.

\### What was wrong
1. **`GET /api/issues/:id/dependencies`** handled duplicate issue files (409) but not malformed ones. A malformed file gave an unhandled 500. `GET /api/issues/:id` already returns 409 `invalid_issue` for this case.
2. **`PUT /api/drafts/:filename`** read the body with a raw `c.req.json()` and then set `savedAt` on it. Malformed JSON gave a 500. So did bodies like `null` or a string. An array body (`[]`) was saved as a broken draft.
3. **Filename checks** in `drafts.ts` and `assets.ts` only rejected `/` and `..`. They let `\` and NUL bytes through, unlike `isAssetFilename` in `src/core/assets.ts`.

\### What changed
- **`src/web/routes/issues.ts`:** the dependencies route now returns `invalidIssueResponse` for malformed files, the same way `GET /issues/:id` does.
- **`src/web/routes/drafts.ts`:**
  - A new local `isDraftFilename` requires the `.json` suffix and reuses `isAssetFilename`. Both PUT and DELETE use it.
  - PUT reads the body with `readJsonBody` and `asRecord`. If the body is not a JSON object, it returns 400 `{ error: 'Draft body must be a JSON object' }`. This check runs before anything touches disk, so a bad request no longer creates the drafts folder or writes `.issues/.gitignore`.
- **`src/web/routes/assets.ts`:** `serveAsset` uses `isAssetFilename`, which covers both `/.issues/assets/:filename` and `/api/issues/assets/:filename`.
- **`docs/specs/2026-03-28-gitrac-design.md`:**
  - The dependencies row now lists the 409 responses.
  - I added the three drafts endpoints, which were missing from the API table.
  - I added a note on the filename rules.
- **`skills/using-gitrac/SKILL.md`:** no change. It does not document these endpoints.

\### Tests
All 12 new tests fail without the fix and pass with it.
- **`issues-dependencies.test.ts`:** a malformed `9-bad.md` gives 409 `invalid_issue` with `file`, the same as `GET /issues/9`.
- **`drafts.test.ts`:**
  - PUT rejects filenames with a backslash or a NUL byte.
  - PUT returns 400 `{ error }` for malformed JSON, `null`, `[]`, `"str"` and `42`, and writes no file.
  - DELETE rejects a backslash, a NUL byte and a non-`.json` name.
- **`assets.test.ts`:** both asset paths return 400 for a backslash or a NUL byte. The backslash test first creates a real `a\b.png` (a legal filename on POSIX) to show it is refused, not just missing.

\### Decisions and trade-offs
- The drafts route checks that the parsed body is a plain object (not `null`, an array or a primitive) before it writes anything.
- `isDraftFilename` stays private to `drafts.ts` and just calls `isAssetFilename`, so the separator checks still live in one place.

\### Follow-ups noticed
- `GET /api/drafts` sorts by `new Date(savedAt)`. A hand-edited draft without `savedAt` sorts unpredictably. This is minor and unchanged.
- The upload route (`POST /api/issues/assets`) builds its own filenames with nanoid, so it does not need the filename check.
