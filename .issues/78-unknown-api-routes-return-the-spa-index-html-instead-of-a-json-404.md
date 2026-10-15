---
id: 78
title: Unknown /api/* routes return the SPA index.html instead of a JSON 404
status: todo
priority: low
assignee: ''
labels:
  - bug
created: '2026-10-15T16:07:01.961Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:01.961Z'
---

`GET /api/does-not-exist` falls through to the SPA fallback and returns `index.html` with status 200. API clients and agents get HTML instead of an error.

## Acceptance criteria

- Any unmatched `/api/*` request (any method) returns `404 {"error": "Not found", "code": "not_found"}` as JSON.
- SPA fallback still works for UI routes; `/.issues/assets/*` unaffected.
- Tests.
