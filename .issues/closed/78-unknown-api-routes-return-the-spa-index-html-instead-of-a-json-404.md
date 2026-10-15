---
id: 78
title: Unknown /api/* routes return the SPA index.html instead of a JSON 404
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:01.961Z'
createdBy: Justin Murray
updated: '2026-10-15T16:34:52.588Z'
---

`GET /api/does-not-exist` falls through to the SPA fallback and returns `index.html` with status 200. API clients and agents get HTML instead of an error.

## Acceptance criteria

- Any unmatched `/api/*` request (any method) returns `404 {"error": "Not found", "code": "not_found"}` as JSON.
- SPA fallback still works for UI routes; `/.issues/assets/*` unaffected.
- Tests.

---

### Justin Murray — 2026-10-15T16:34:52.588Z

\## #78: unknown `/api/*` routes now return a JSON 404

**What was wrong**
In `createApp`, `app.get('*', serveUi(ui))` was the last route, and nothing handled `/api` requests that didn't match a real endpoint. So `GET /api/does-not-exist` got `index.html` with status 200. Other methods to unknown API paths got Hono's plain-text 404, not JSON.

**What changed**
- `src/web/server.ts`: added an `apiNotFound` handler that returns `404 {"error":"Not found","code":"not_found"}`. It is registered with `app.all('/api', …)` and `app.all('/api/*', …)`, after all the `/api` route groups and before the `/.issues/assets/:filename` route and the SPA fallback. Real API routes still match first. Their own 404s (e.g. `Issue #999 not found`) are unchanged. `requestGuard` still runs first, so cross-origin and DNS-rebinding requests still get 403.
- `src/web/server.test.ts`: new `unknown /api routes` tests:
  - GET/POST/PUT/PATCH/DELETE on `/api`, `/api/`, `/api/does-not-exist` and `/api/issues/1/nope/deeper` all return the JSON 404 body with a JSON content-type.
  - The same 404 when no UI is served (`ui: null`).
  - Known API routes, SPA routes (`/`, `/issues/5`, and `/apidocs` / `/api-not-really`, which only share the prefix) and `/.issues/assets/*` behave as before.
  - A missing issue still returns the route's own 404 message.

  With the two new routes commented out, the two 404 tests fail. `./bun run check` passes (1077 tests).
- `docs/specs/2026-03-28-gitrac-design.md`: added a line under the API Routes table describing the 404, and changed the SPA-fallback sentence to say "unknown GET path outside `/api`".

**Decisions**
- I registered `/api` on its own as well as `/api/*`, so the bare prefix can never fall through to the SPA.
- I used explicit routes instead of `app.notFound`. That way the SPA fallback and the plain-text 404 for missing hashed `/assets/*` files stay as they are.

**Follow-ups noticed (not fixed)**
- Error bodies elsewhere in `src/web/routes/issues.ts` don't all include `code`. For example, `Issue #N not found` and `Invalid issue ID` are `{ error }` only. Making API error bodies consistent would be a separate issue.
- A CORS preflight `OPTIONS` to a real `/api` route now gets this JSON 404 too, still with no allow headers. The existing no-CORS tests pass.
- No overlap with the other work in progress (#73, #80, #81).
