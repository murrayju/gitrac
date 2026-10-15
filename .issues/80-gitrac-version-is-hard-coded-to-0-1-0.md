---
id: 80
title: gitrac --version is hard-coded to 0.1.0
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:03.765Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:28.558Z'
---

`src/cli/index.ts` calls `.version('0.1.0')`. `scripts/release.ts` bumps `package.json` only, so released binaries will always report 0.1.0.

## Acceptance criteria

- `--version` reports the `package.json` version, both from source and in the compiled binary (e.g. import `package.json` with `with { type: 'json' }` so it's bundled).
- Test that `--version` matches `package.json`.
