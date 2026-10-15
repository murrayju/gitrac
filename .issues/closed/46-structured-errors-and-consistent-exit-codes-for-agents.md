---
id: 46
title: Structured errors and consistent exit codes for agents
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T00:05:01.135Z'
---

Errors are a mix of `console.error` strings and raw uncaught stack traces (e.g. simple-git errors, ENOENT). With `-o json` agents get unparseable output on failure.

## Acceptance criteria

- A single top-level error handler: human mode prints `Error: <message>`; json/yaml mode prints `{"error": {"code": "...", "message": "..."}}` to stderr (or stdout — document it).
- Distinct exit codes for not found, invalid input, conflict (e.g. already claimed), git failure.
- No raw stack traces unless `--debug`.
- Branch warnings should go to stderr only and not corrupt JSON stdout.

---

### Justin Murray — 2026-10-15T00:05:01.135Z

Issue #46 is done: every CLI failure now goes through one top-level handler, with distinct exit codes and a JSON error line on stderr. `./bun run check` passes (598 tests). I also ran the new integration test against the old code (`git archive HEAD`, no change to git state) and all 21 cases failed there.

\## What was wrong
Errors came out in several ways. Some commands printed `Error: …` and called `process.exit(1)`. Others caught everything and printed only `err.message`. Unhandled errors (simple-git failures, YAML parse errors in `config.yaml`) reached the user as raw stack traces, because `index.ts` used `program.parse()` with async actions. Nearly everything exited 1, and with `-o json` a failure gave agents nothing they could parse. `init` also silently ignored commit failures.

\## What changed
- **One handler.** `index.ts` now calls `runCli()`, which awaits `program.parseAsync()` and catches any error in one place. It prints the error and exits with that error's exit code.
- **Commands throw instead of exiting.** They throw a typed `GitracError`, defined in the new `src/core/errors.ts`. The fs layer throws the same type: `readIssue`/`moveToClose`/`moveToReopen` → `not_found`/`invalid_state`, `initIssuesDir` → `already_initialized`, `readConfig` → `not_initialized`/`invalid_config`. `ProjectRootError` and `LockTimeoutError` now extend `GitracError`. Lookups that used to fail inside the lock now throw, so the lock is released normally on the way out.
- **Other errors are mapped** by `src/cli/errors.ts`:
  - simple-git `GitError` → `git_error`
  - Commander usage errors → `usage` (its own error printing is turned off so only our message shows)
  - anything else → `error`, keeping the original message
- **Output format:**
  - human: `Error: <msg>`, one line per message when several fields are invalid
  - json: one line, always the last line of stderr, e.g. `{"error":{"code":"not_found","message":"Issue #9 not found","id":9}}`. `code` and `message` always come first; some errors add `id`, `assignee`, `errors[]`, etc.
  - yaml: the same object as YAML
  - Errors go to stderr, so stdout holds only results.
- **Exit codes:**

| Exit | `code` | Meaning |
|------|--------|---------|
| 1 | `error`, `invalid_config`, `server_error` | General / unexpected |
| 2 | `invalid_input`, `usage` | Bad input or flags |
| 3 | `already_claimed`, `already_initialized`, `invalid_state` | Conflict |
| 4 | `issue_closed` | Issue is closed |
| 5 | `not_found` | No such issue |
| 6 | `lock_timeout` | Lock wait timed out |
| 7 | `git_error` | git commit/push failed |
| 8 | `not_a_git_repo`, `not_initialized` | Not a gitrac project |

  `EXIT_ALREADY_CLAIMED` (3) and `EXIT_ISSUE_CLOSED` (4) keep their values and are still exported from `core/claim.ts`.
- **`--debug`** is a new global flag. Stack traces (including causes) are printed only with it, before the error line.
- **`-o`** now only accepts human, json or yaml. Anything else is a usage error; before, it printed `undefined`.
- **Issue IDs are parsed strictly:** `12abc` is rejected and `#12` is accepted.
- **Branch warnings** already went to stderr. `show` now parses the ID first, and a test checks that `-o json` stdout stays parseable on a non-default branch.

\## Files
- **New:** `src/core/errors.ts`, `src/cli/errors.ts`, plus tests `src/core/errors.test.ts`, `src/cli/errors.test.ts`, `src/cli/structured-errors.test.ts`.
- **Modified:** `index.ts`, `src/cli/index.ts`, `src/cli/global-options.ts` (removed `resolveProjectRootOrExit`), `validation.ts` (`exitWithErrors` → `throwValidationErrors`), `text-input.ts` (removed `resolveTextOptionOrExit`), all commands, `src/core/claim.ts`, `src/fs/issue-store.ts`, `src/fs/lock.ts`.
- **Docs:** `AGENTS.md` (new convention), `skills/using-gitrac/SKILL.md` (new "Errors and exit codes" section), `docs/specs` (new "Errors and Exit Codes" section).
- **Updated tests:** `validation.test.ts`, `text-input.test.ts`, `project-root.test.ts`, for the new exit codes.

\## Decisions / trade-offs
- **Breaking change:** invalid input exits 2 (was 1) and not-a-project exits 8 (was 1). Docs and tests are updated. The issue asked for distinct codes, so 1 is now kept for unexpected errors only.
- **Errors go to stderr, not stdout.** Some commands print their result before committing, so a git failure leaves the result on stdout and the error on stderr, and both stay parseable.
- **Exit 3 now means "conflict" in general**, not just "already claimed" (it also covers `init` twice and `reopen` of an open issue). The JSON `code` tells them apart.
- **The `-o` and `--debug` settings for errors are read from raw argv**, so they still work when Commander fails while parsing options.
- **I didn't touch the web layer.** fs error messages for not-found are unchanged.

\## Follow-ups noticed (not fixed)
- Commands write and print the issue before committing, so on `git_error` the file is changed but not committed. This is documented for agents.
- `close` on an already-closed issue reads it, writes a copy to the open dir, then moves it back (the CLI and the web route do the same). It probably should be an `invalid_state` error.
- `serve --port abc` reports `Invalid port "NaN"`.
- No-op notices from `claim`/`unclaim` go to stderr as plain text, before any JSON.
- `readConfig` errors are now typed. The web routes in `src/web/` (being changed in #47/#61) still turn any thrown error into a generic 500, and could map `GitracError` codes to HTTP statuses later.
