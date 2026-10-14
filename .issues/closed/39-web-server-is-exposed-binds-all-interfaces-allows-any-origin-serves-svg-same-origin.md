---
id: 39
title: >-
  Web server is exposed: binds all interfaces, allows any origin, serves SVG
  same-origin
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:56:35.337Z'
---

- `Bun.serve` is called without `hostname`, so it listens on 0.0.0.0 — anyone on the LAN can read and mutate issues (and create commits).
- `app.use('*', cors())` allows every origin, so any website the user visits can call the API (create issues, commits, upload files).
- SVG uploads are allowed and served as `image/svg+xml` from the same origin as the app — a stored-XSS vector.

## Acceptance criteria

- Default bind to `127.0.0.1`; add `--host` to opt into other interfaces.
- Remove blanket CORS (the Vite dev server proxies, so CORS isn't needed); reject mutating requests whose `Origin` / `Host` isn't the server's own (DNS-rebinding protection).
- Disallow SVG uploads (or serve assets with `Content-Security-Policy: sandbox` / `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`).
- Enforce an upload size limit.

---

### Justin Murray — 2026-10-14T22:56:35.337Z

Issue #39 is fixed. The server now listens on `127.0.0.1` by default, sends no CORS headers, rejects cross-origin writes and unknown `Host` names with 403, no longer accepts SVG uploads, and caps uploads at 10 MiB. `./bun run check` passes, and I also tested it by hand against a real server and the Vite dev server in a scratch repo. Nothing is committed.

**What was wrong**
- `Bun.serve` had no `hostname`, so it listened on 0.0.0.0 and anyone on the LAN could read and change issues and create commits.
- `app.use('*', cors())` let any website call the API, including creating issues, committing and uploading files.
- SVG uploads were allowed and served as `image/svg+xml` from the app's own origin, so a stored SVG could run script in the app (stored XSS).
- Uploads had no size limit.

**What changed**
- **Bind address:** the default is now `127.0.0.1`. A new `--host <host>` option works on `serve` and on bare `gitrac`, and is long-only like `--port`. With a non-loopback host the server prints a warning that there is no authentication. The startup message shows the real address.
- **New request check** (`src/web/security.ts`, runs on every request, replaces CORS):
  - *Fake hostnames (DNS rebinding):* the `Host` header must be an IP address, `localhost` / `*.localhost`, or the exact name given to `--host`. Anything else gets 403, including GETs, so a page on a hostname re-pointed at 127.0.0.1 can't read issues either.
  - *Cross-site writes:* for anything except GET/HEAD/OPTIONS, an `Origin` header must have the same host:port as `Host`. With no `Origin`, a `Sec-Fetch-Site` of `cross-site` or `same-site` is rejected. Requests with neither header (curl, scripts) are allowed.
- **Vite dev workflow:** `vite.config.ts` now proxies to `http://127.0.0.1:3000` (`localhost` can resolve to `::1` first and miss a 127.0.0.1-only server). It sets `changeOrigin: false` explicitly so the browser's `Host` (`localhost:5173`) still matches `Origin`. Through the proxy, POST returns 201 and GET 200; a cross-origin POST or a foreign `Host` gets 403.
- **Uploads:** SVG is removed from the allowed types. Uploads are capped at 10 MiB with a 413 response, both via Content-Length and for streamed bodies. A malformed upload body now returns 400 instead of 500. All request bodies are capped at 11 MiB.
- **Serving assets:** every asset gets `X-Content-Type-Options: nosniff` and a `sandbox` Content-Security-Policy. SVGs already committed still display in `<img>` but can't run script if opened directly. Unknown file types (e.g. a committed `.html`) are sent as `application/octet-stream` with `Content-Disposition: attachment`.
- `startServer` now returns `{ hostname, port, stop }` so tests can start and stop a real server. In `runServe`, a bind failure now prints its own error instead of "Is this a gitrac project?".

**Files**
- New: `src/web/security.ts`, `src/web/security.test.ts`, `src/web/routes/assets.test.ts`
- Changed: `src/web/server.ts`, `src/web/server.test.ts`, `src/web/routes/assets.ts`, `src/cli/commands/serve.ts`, `src/cli/index.ts`, `src/cli/global-options.ts`, `src/cli/global-options.test.ts`, `vite.config.ts`, `AGENTS.md`, `skills/using-gitrac/SKILL.md`, `docs/specs/2026-03-28-gitrac-design.md` (new "Security" section, `--host` flag, upload route)

The new tests fail on the old code: they cover CORS headers, cross-origin and fake-`Host` requests (403), the Vite-proxy case, binding to 127.0.0.1 by default, SVG and oversized uploads, asset headers, and `--host` option parsing. I reasoned through that rather than re-running them against the old code, since I couldn't change git state.

**Decisions and trade-offs**
- With `--host 0.0.0.0`, the server is reachable by IP address, or by a name only if that exact name is passed to `--host`; names like `mybox.local` are refused. Allowing any name would remove the rebinding protection. This is documented.
- Clients that send no `Origin` (curl, scripts) are allowed, so local tooling keeps working.
- The startup URL still says `http://localhost:<port>` for the default bind.

**Follow-ups noticed**
- The `./gitrac` wrapper script runs `./bun` relative to the current directory, so it fails when called from another directory (it overlaps with #40).
- The web UI doesn't tell the user when an upload is rejected (SVG or too large); the errors only reach the browser console.
- The app sets no anti-framing headers (`frame-ancestors` / `X-Frame-Options`), so another site could embed it in a frame and trick clicks. That's a small, separate hardening item.
- #40 may edit `serve.ts`, `index.ts` or `global-options.ts`; my changes there are small additions, so any conflicts should be easy to resolve.
