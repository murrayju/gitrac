---
id: 79
title: Add anti-framing headers to the web server
status: in_progress
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:02.850Z'
createdBy: Justin Murray
updated: '2026-10-15T16:51:53.187Z'
---

The web UI sets no `frame-ancestors` / `X-Frame-Options`, so another site could frame it for clickjacking (the server has no auth and can make commits).

## Acceptance criteria

- All HTML (and ideally all) responses send `Content-Security-Policy: frame-ancestors 'none'` (merged with any existing CSP, e.g. the asset sandbox CSP) and `X-Frame-Options: DENY`.
- Vite dev workflow unaffected.
- Tests.
