---
id: 39
title: >-
  Web server is exposed: binds all interfaces, allows any origin, serves SVG
  same-origin
status: in_progress
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:42:47.976Z'
---

- `Bun.serve` is called without `hostname`, so it listens on 0.0.0.0 — anyone on the LAN can read and mutate issues (and create commits).
- `app.use('*', cors())` allows every origin, so any website the user visits can call the API (create issues, commits, upload files).
- SVG uploads are allowed and served as `image/svg+xml` from the same origin as the app — a stored-XSS vector.

## Acceptance criteria

- Default bind to `127.0.0.1`; add `--host` to opt into other interfaces.
- Remove blanket CORS (the Vite dev server proxies, so CORS isn't needed); reject mutating requests whose `Origin` / `Host` isn't the server's own (DNS-rebinding protection).
- Disallow SVG uploads (or serve assets with `Content-Security-Policy: sandbox` / `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`).
- Enforce an upload size limit.
