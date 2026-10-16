---
id: 101
title: >-
  Disable commit.gpgsign in remaining git tests, fix Biome lint warning, and
  lazy-load web server in CLI
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - chore
created: '2026-10-16T12:13:26.873Z'
createdBy: Justin Murray
updated: '2026-10-16T19:09:10.328Z'
---

Three developer-experience, test-speed, and startup hygiene items:

1. **Missing `commit.gpgsign = false` in 6 test files:** `src/git/amend-tracker.test.ts`, `src/git/operations.test.ts`, `src/git/status.test.ts`, `src/fs/gitignore.test.ts`, `src/service/config.test.ts`, and `src/web/server.test.ts` call `git.init()` without `await git.addConfig('commit.gpgsign', 'false')` (which the other 25 git-backed test files set). On machines with global `commit.gpgsign=true`, every test commit spawns `gpg` (~500ms per commit, making `amend-tracker.test.ts` take ~47s or hang if gpg-agent prompts).
2. **Biome lint warning in `src/npm-package.test.ts:23`:** `./bun run lint` reports `lint/suspicious/noTemplateCurlyInString` on `'#!/bin/sh\necho "fake gitrac $*"\nexit "${FAKE_EXIT:-0}"\n'`.
3. **Eager web server import on every CLI command:** `src/cli/index.ts` imports `./commands/serve.ts`, which statically imports `../../web/server.ts` (Hono + all 7 web route modules) on every CLI invocation (including `gitrac ls`, `gitrac claim`, and `gitrac merge-driver`).

## Acceptance criteria

- Every test file that calls `git.init()` sets `commit.gpgsign` to `false`.
- `./bun run lint` completes with 0 warnings and 0 errors.
- `src/cli/commands/serve.ts` dynamically imports `../../web/server.ts` inside `runServe` so non-`serve` CLI invocations do not load the web server stack.

---

### Justin Murray — 2026-10-16T19:09:09.904Z

All three parts of issue #101 are fixed. Typecheck passes, lint reports 0 warnings and 0 errors, and the listed tests plus three more files pass (125 tests across 10 files).

\## What was wrong
1. Several git-backed test files ran `git init` without turning off commit signing. On machines with global `commit.gpgsign=true`, every test commit started `gpg` (about 500ms each).
2. Biome flagged `"${FAKE_EXIT:-0}"` in a plain string in `src/npm-package.test.ts` (`noTemplateCurlyInString`).
3. `src/cli/commands/serve.ts` imported `../../web/server.ts` at the top of the file. So every CLI command loaded Hono and all the web routes at startup, not just `serve`.

\## What changed
- **Test signing:** after each `git.init()` the tests now call `await git.addConfig('commit.gpgsign', 'false')`. That is 8 calls across the 6 listed files, including the second call in `amend-tracker.test.ts` and `operations.test.ts`.
  - I also fixed two files the issue didn't list, `src/git/identity.test.ts` and `src/service/merge-driver.test.ts`. They use `simpleGit(dir).init()`, which the issue's search missed, and one test in `merge-driver.test.ts` makes a real commit. The acceptance criterion says every such file, so I included them.
- **Lint warning:** the fake binary script is now an array of lines joined with `\n`. The default value is set with `[ -n "$FAKE_EXIT" ] || FAKE_EXIT=0` and the script ends with `exit "$FAKE_EXIT"`. It behaves the same with no `${...}` in the string. I didn't use a suppression comment or escape the `$`, which would make the shell script harder to read.
- **Lazy server load:** I removed the top-level import from `serve.ts`. `runServe` now loads it with `const { startServer } = await import('../../web/server.ts')`, after it checks the port and reads the config. Any failure from `startServer` still becomes a `server_error`.
  - `DEFAULT_HOST` still comes from `src/web/security.ts` through `global-options.ts`. I kept that import because the file only imports Hono for a type, which is removed at runtime, so it loads nothing heavy.

\## Files modified
- `src/cli/commands/serve.ts`
- `src/npm-package.test.ts`
- `src/git/amend-tracker.test.ts`, `src/git/operations.test.ts`, `src/git/status.test.ts`, `src/git/identity.test.ts`
- `src/fs/gitignore.test.ts`
- `src/service/config.test.ts`, `src/service/merge-driver.test.ts`
- `src/web/server.test.ts`

\## Tests
No new tests. Beyond the test run above, I checked by hand:
- Loading `serve.ts` now brings in only `src/web/security.ts` from the web code. No Hono runtime modules and no `server.ts`.
- `./gitrac serve -p 4123` still starts, and `/api/config` returns 200.
