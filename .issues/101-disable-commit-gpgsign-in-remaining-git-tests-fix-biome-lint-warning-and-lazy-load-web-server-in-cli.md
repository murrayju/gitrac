---
id: 101
title: >-
  Disable commit.gpgsign in remaining git tests, fix Biome lint warning, and
  lazy-load web server in CLI
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - chore
created: '2026-10-16T12:13:26.873Z'
createdBy: Justin Murray
updated: '2026-10-16T14:13:08.574Z'
---

Three developer-experience, test-speed, and startup hygiene items:

1. **Missing `commit.gpgsign = false` in 6 test files:** `src/git/amend-tracker.test.ts`, `src/git/operations.test.ts`, `src/git/status.test.ts`, `src/fs/gitignore.test.ts`, `src/service/config.test.ts`, and `src/web/server.test.ts` call `git.init()` without `await git.addConfig('commit.gpgsign', 'false')` (which the other 25 git-backed test files set). On machines with global `commit.gpgsign=true`, every test commit spawns `gpg` (~500ms per commit, making `amend-tracker.test.ts` take ~47s or hang if gpg-agent prompts).
2. **Biome lint warning in `src/npm-package.test.ts:23`:** `./bun run lint` reports `lint/suspicious/noTemplateCurlyInString` on `'#!/bin/sh\necho "fake gitrac $*"\nexit "${FAKE_EXIT:-0}"\n'`.
3. **Eager web server import on every CLI command:** `src/cli/index.ts` imports `./commands/serve.ts`, which statically imports `../../web/server.ts` (Hono + all 7 web route modules) on every CLI invocation (including `gitrac ls`, `gitrac claim`, and `gitrac merge-driver`).

## Acceptance criteria

- Every test file that calls `git.init()` sets `commit.gpgsign` to `false`.
- `./bun run lint` completes with 0 warnings and 0 errors.
- `src/cli/commands/serve.ts` dynamically imports `../../web/server.ts` inside `runServe` so non-`serve` CLI invocations do not load the web server stack.
