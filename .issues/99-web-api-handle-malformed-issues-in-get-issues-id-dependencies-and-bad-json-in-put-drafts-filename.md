---
id: 99
title: >-
  Web API: handle malformed issues in GET /issues/:id/dependencies and bad JSON
  in PUT /drafts/:filename
status: backlog
priority: low
assignee: ''
labels:
  - bug
created: '2026-10-16T12:12:46.052Z'
createdBy: Justin Murray
updated: '2026-10-16T12:12:46.052Z'
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
