---
id: 37
title: create -p (priority) is swallowed by global -p/--port
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:28:09.358Z'
---

The root program defines `-p, --port <port>` and `create` defines `-p, --priority <priority>`. Commander consumes `-p high` as the global port, so `gitrac create -t x -p high` creates a `medium` priority issue. `edit -p` has the same conflict.

## Acceptance criteria

- `create -p high` and `edit -p high` set priority.
- Move server-only options (`--port`) to an explicit `serve` subcommand (keeping bare `gitrac` as an alias for serving), or otherwise avoid short-flag collisions between global and subcommand options.
- Tests exercising real argv parsing for both commands.

---

### Justin Murray — 2026-10-14T22:28:09.358Z

\## Fix #37: `create -p` / `edit -p` no longer swallowed by the global `--port`

**What was wrong**
The root program defined `-p, --port <port>`. Commander matches program-level options anywhere on the command line, so the global option took `-p high` before `create` or `edit` saw it. That made `gitrac create -t x -p high` produce a `medium` issue (the port was set to `"high"`). `edit -p` had the same bug.

**What changed**
- **New `serve` subcommand** (`src/cli/commands/serve.ts`). It owns `-p, --port <port>` (default 3000) and contains:
  - `resolveServeOptions()`: the subcommand's `-p` wins if given, otherwise the global `--port`.
  - `runServe()`: starts the server, with the old "Is this a gitrac project?" error. It now also rejects ports that aren't an integer from 0 to 65535.
- **Global `--port` is now long-only** (`src/cli/index.ts`). Bare `gitrac` still starts the server and works as an alias for `serve`, so `gitrac`, `gitrac --port 4000` and `./gitrac` behave as before. `-o json` and all other global flags are unchanged. `getGlobalOptions` still returns `port`; only a doc comment changed in `global-options.ts`.
- **Port resolution:** `serve -p 4000`, `serve --port 4000` and `gitrac --port 4000` all work. Commander takes `serve --port` at the program level, which is why `resolveServeOptions` merges the two values.

**Tests** (`src/cli/global-options.test.ts`, all using real argv parsing)
- `create -t x -p high`, `-o json create -p high …` and `edit 1 -p high` parse priority correctly.
- End-to-end runs in a scratch repo confirm `create -p high` and `edit -p high` save the priority to the issue file.
- Port resolution is covered for bare `gitrac`, `--port 4000`, `serve`, `serve -p`, `serve --port`, `-p` overriding a global `--port`, and `--dir`.
- A guard test fails if any subcommand's short flag is also defined at the program level.
- A test checks that bare `gitrac -p 4000` is rejected.

When I temporarily put the global `-p` back, 7 of these tests failed. `./bun run check` passes (310 tests). I also checked by hand in a temp repo: `create -p high` and `edit -p low` set priority, and the server started on the expected port for each of the four forms.

**Docs**
- `AGENTS.md`: added `serve -p` examples.
- `skills/using-gitrac/SKILL.md`: added a quick-reference row.
- `docs/specs/2026-03-28-gitrac-design.md`: added the `serve` command and the `--port` global flag, plus a note that global flags must not define short flags that subcommands use.

**Decisions / trade-offs**
- **Breaking change:** bare `gitrac -p 4000` now fails with "unknown option '-p'". Use `gitrac --port 4000` or `gitrac serve -p 4000`.
- I didn't switch to `enablePositionalOptions()`. That would also prevent collisions, but it would break the documented `gitrac close 1 --no-commit` form, where global flags come after the subcommand.

**Follow-ups noticed (not fixed)**
- Because Commander matches global options anywhere, any subcommand accepts `--port` without complaint (e.g. `gitrac create --port 1` does nothing). This was already true before the change.
- `create` and `edit` still don't check `-p` / `-s` values against the priorities and statuses in the config.
