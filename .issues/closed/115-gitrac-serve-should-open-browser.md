---
id: 115
title: gitrac serve should open browser
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-20T20:38:18.260Z'
createdBy: Justin Murray
updated: '2026-10-20T22:26:31.274Z'
---

By default, open the served url in the default browser. Add a `--no-open` / `-n` flag to suppress this.

---

### Justin Murray — 2026-10-20T22:26:30.869Z

Typecheck and lint are clean, and the 365 tests in `src/cli` plus the two new or changed web test files pass (`listen.test.ts`, `server.test.ts`).

\## What was wrong
- **#118:** `gitrac serve` always bound port 3000. If something else already had it, startup failed instead of moving to another port.
- **#115:** the server never opened the browser, and there was no flag to control that.

\## What changed
- **Port choice** (new `src/web/listen.ts`, used by `src/web/server.ts`): `bindFirstFreePort(bind, start, attempts)` binds directly and moves to the next port only on `EADDRINUSE`. It doesn't check ports first, so another process can't grab a port between the check and the bind.
  - `startServer` has a new `portAttempts` option (default 1). `runServe` passes 20 when no port was given (neither `serve -p/--port` nor the global `--port`), otherwise 1.
  - An explicit busy port still fails with `server_error`, now worded `Could not start server on 127.0.0.1:3000: port 3000 is already in use`. If all 20 ports are busy, the message is `ports 3000-3019 are all in use`.
  - `-p 0` still means any free port and is tried once. Other bind errors are not retried, and the search never goes past 65535.
  - The startup line already printed `server.port`, so it shows the port actually bound.
- **Opening the browser** (new `src/cli/open-browser.ts`):
  - `shouldOpenBrowser` decides; it says no if `-n`/`--no-open` was given, stdout is not a TTY, `CI` is set, or `GITRAC_NO_OPEN` is set. An env value that is empty, `0` or `false` doesn't count.
  - `openerCommand` picks `xdg-open` on Linux (and the fallback), `open` on macOS, `cmd /c start "" <url>` on Windows.
  - `openBrowser` starts the opener detached with its output ignored. It never throws; on failure it prints a short note to stderr.
  - `runServe` calls it with `displayUrl(host, server.port)` after the server is listening.
- **Flag:** `-n, --no-open` is a program-level option in `src/cli/index.ts`, so both `gitrac -n` and `gitrac serve -n` work. `serve --help` lists it under "Also:" (see the first trade-off).
- **Docs:** updated the README (quick start, web UI section, CLI table), the spec (`gitrac` / `serve` rows, the global flags table, the note on short-flag collisions), `skills/using-gitrac/SKILL.md` (the `serve` row) and the AGENTS.md command list.

\## Tests
- **`src/web/listen.test.ts`:** a busy 3000 falls back to 3001/3002; one attempt fails and names the port; the 20-attempt cap; the 65535 limit; port 0 is not retried; other errors are not retried; one check against a real `Bun.serve`.
- **`src/web/server.test.ts`:** `startServer` falls back from a busy port and logs the bound port; without `portAttempts` it fails with `EADDRINUSE`.
- **`src/cli/commands/serve.test.ts` (end-to-end):** `serve -p <busy>` and `--port <busy>` exit 1 with a `server_error` that names the port; `serve -p 0` binds and answers requests.
- **`src/cli/global-options.test.ts`:** `autoPort` is set only when no port was given; `open` is off for `-n` / `--no-open` wherever they appear.
- **`src/cli/open-browser.test.ts`:** the open decision (flag, TTY, `CI`, `GITRAC_NO_OPEN`), the command per platform, and failure notes for a missing or failing opener.
- **No test opens a browser:** every test that starts `gitrac serve` uses a piped stdout, so it is not a TTY. `startServer` never opens one. The video recorder starts gitrac with no terminal attached, so it doesn't open one either.
- **Manual check** under a real TTY (via `script`, with a fake `xdg-open` on PATH):
  - With 3000 and 3001 busy, it served on 3002 and opened `http://localhost:3002`.
  - `-n` and `GITRAC_NO_OPEN=1` opened nothing.
  - A failing `xdg-open` printed the note and the server kept running.

\## Decisions and trade-offs
- **`-n` is global only, not also on `serve`.** No other subcommand uses `-n`, but an existing test forbids a subcommand short flag that matches a global one, and Commander would take it at the program level anyway. Because of that, `serve --help` shows `-n` in an "Also:" note instead of its Options list.
- **The browser check looks at stdout, not stdin.** That matches the guidance, and it is what makes piped test and agent runs safe.
- **Opener exit codes:** a non-zero exit from the opener also prints the note. This catches `xdg-open` running with no desktop.

\## Follow-ups noticed
- `-n` / `--no-open` is accepted and silently ignored on every subcommand (e.g. `gitrac ls -n`), like the other global serve flags (`--port`, `--host`).
- `getGlobalOptions().port` still defaults to 3000 and is no longer used for serving. It could be removed later.

**Orchestrator verification:** on a scratch repo, two `gitrac serve` runs with no port bound 3000 and then 3001, and `serve -p 3000` failed with "Could not start server on 127.0.0.1:3000: port 3000 is already in use". Neither run opened a browser (stdout was not a TTY). Implemented together with #115 (same startup code); both issues are closed by this change.
