---
id: 79
title: Add anti-framing headers to the web server
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:02.850Z'
createdBy: Justin Murray
updated: '2026-10-15T17:24:30.048Z'
---

The web UI sets no `frame-ancestors` / `X-Frame-Options`, so another site could frame it for clickjacking (the server has no auth and can make commits).

## Acceptance criteria

- All HTML (and ideally all) responses send `Content-Security-Policy: frame-ancestors 'none'` (merged with any existing CSP, e.g. the asset sandbox CSP) and `X-Frame-Options: DENY`.
- Vite dev workflow unaffected.
- Tests.

---

### Justin Murray — 2026-10-15T17:24:30.048Z

**Issue #79: anti-framing headers on all web server responses**

**What was wrong:** The web server sent no `frame-ancestors` or `X-Frame-Options` header, so any website could load the UI in a frame and trick a user into clicking (clickjacking). That matters here because the server has no auth and the UI can make commits.

**What changed:**
- **`src/web/security.ts`**
  - New `withFrameAncestorsNone(csp)` adds `frame-ancestors 'none'` to an existing CSP and keeps its other directives. If the policy already has its own `frame-ancestors`, it's left unchanged.
  - New `antiFraming()` Hono middleware. After the route runs, it merges that CSP and sets `X-Frame-Options: DENY` (for browsers that don't support `frame-ancestors`). If a response's headers can't be changed (e.g. `Response.redirect`), it copies the response first.
- **`src/web/server.ts`**: registers `antiFraming()` first on `*`, before `requestGuard`. So every response gets the headers: UI HTML and static files, API, SSE, assets, 404s, error responses and the guard's 403s.
- **Tests**
  - `src/web/security.test.ts`: unit tests for the CSP merge (no policy, trailing `;`, keeping an explicit `frame-ancestors`) and for the middleware (normal, 404, error-handler, route-CSP and immutable-header responses).
  - `src/web/server.test.ts`: the headers are on the SPA HTML, a static JS file, `/api/issues`, an unknown `/api` 404 and a rebound-Host 403. The asset sandbox CSP comes out as a single policy that still has `default-src 'none'` and `sandbox`. These server tests fail without the fix.
- **Docs**: one new "No framing (clickjacking)" bullet under Web UI → Security in `docs/specs/2026-03-28-gitrac-design.md`.

**Decisions:**
- The CSP is merged into one header rather than added as a second one, as the acceptance criteria ask. That also keeps asset responses down to a single readable policy.
- The Vite dev workflow is unaffected: Vite serves its own `index.html` without these headers, and proxied `/api` responses carry them, which does nothing to `fetch`. I didn't change `vite.config.ts`.

**Checks:** `./bun run check` passes (1101 tests). I also ran a real `gitrac serve` in a scratch repo: the 404 for `/` (no UI build in that worktree) and the `/api/events` SSE stream both came back with the two headers.

**Follow-ups noticed:** None that overlap with the other in-flight issues. The only file I touched outside `src/web/security*.ts` and `src/web/server*.ts` is that one bullet in the spec.
