---
id: 40
title: CLI fails when run from a subdirectory of the repo
status: done
priority: high
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T22:54:21.509Z'
---

Commands call `getGitRoot(dir)` but discard the result, then build paths from `process.cwd()`. Running `gitrac ls` in any subdirectory crashes with a raw ENOENT stack trace.

## Acceptance criteria

- The project root is resolved via `git rev-parse --show-toplevel` (honoring `--dir` when given) once, in a shared helper used by every command and the server.
- Friendly error when not in a git repo or when `.issues/` isn't initialized ("run gitrac init").
- Tests running commands from a nested directory.

---

### Justin Murray — 2026-10-14T22:54:21.509Z

\## #40: CLI fails when run from a subdirectory of the repo

**What was wrong**
Every command called `getGitRoot(dir)` only to check that it was inside a repo. It threw the result away and then built `.issues/` paths from `--dir` or `process.cwd()`. So running `gitrac ls` (or any other command) in a subdirectory crashed with a raw ENOENT stack trace. `serve` didn't look for the git root at all, and from a subdirectory it failed with the misleading message "Is this a gitrac project?". The `./gitrac` wrapper also used relative paths (`./bun run index.ts`), so `../gitrac` didn't work from a subdirectory either.

**What changed**
- **One shared helper** in `src/cli/global-options.ts`:
  - `resolveProjectRoot(dir, { requireInit })` runs `git rev-parse --show-toplevel` starting from `--dir` (or the cwd). It throws a typed `ProjectRootError` when:
    - the directory doesn't exist,
    - it's not in a git repo or work tree,
    - `.issues/config.yaml` is missing. This check runs unless `requireInit: false` is passed, and the message tells you to run `gitrac init`.
  - `resolveProjectRootOrExit` prints `Error: <message>` and exits 1, with no stack trace.
  - `resolveProjectOptions(program, opts)` returns the global options with `dir` replaced by the resolved root.
- **All commands** (`init`, `create`, `list`, `show`, `edit`, `comment`, `close`, `reopen`, `claim`) now call `resolveProjectOptions`, replacing the old copy-pasted try/`getGitRoot` blocks. `init` uses `{ requireInit: false }`, so running it from a subdirectory initializes at the repo root.
- **`serve` / bare `gitrac`**: `runServe` resolves the root before `readConfig`/`startServer`, so the web server, watcher and UI-dist lookup all get the root. This is a 3-line change in `serve.ts`; `resolveServeOptions` is unchanged to stay clear of the #39 work.
- **`./gitrac` wrapper**: now resolves `bun` and `index.ts` relative to the script's own location.
- **Docs**:
  - The spec's `--dir` row now matches real behavior: it used to say "validated to be within the current git repo".
  - There's a new "Project root resolution" paragraph in `docs/specs/2026-03-28-gitrac-design.md`.
  - `skills/using-gitrac/SKILL.md` notes that commands work from subdirectories.
  - `AGENTS.md` gets a convention that new commands must use `resolveProjectOptions`.
  - The `--dir` help text is updated.

**Tests**
New file `src/cli/project-root.test.ts`, which runs the real CLI as a subprocess with a nested cwd:
- Unit tests for `resolveProjectRoot`: nested dir, not initialized, `requireInit: false`, non-git dir, missing dir.
- `init`, `create`, `ls`, `show`, `comment`, `claim`, `edit`, `close` and `reopen` all run from `src/deep/er`. The test checks that files and commits land at the root and nothing is written in the subdirectory.
- `--dir` pointing at a subdirectory.
- `serve -p 0` starts from a subdirectory.
- Friendly errors with no ENOENT or stack trace: not initialized (`ls`, `show`, `create`, `serve`) and outside a repo (`ls`, `init`, `serve`).

On a copy of the tree with the command changes reverted, 6 of the CLI tests fail; with the fix all of them pass. `./bun run check` passes (350 tests).

**Decisions / trade-offs**
- `getGlobalOptions` stays synchronous and still returns the raw `--dir`/cwd, so existing parsing tests and `resolveServeOptions` are untouched. The doc comment now says it is not the project root.
- "Initialized" means `.issues/config.yaml` exists, since that's the file every command reads first.
- In `create`, the root is resolved before the interactive title prompt and outside the mutation lock, as AGENTS.md requires.

**Follow-ups / interactions**
- For #39: `runServe` now resolves `dir` itself at the top, so a new `--host` option should go through `ServeOptions` without changing that line.
- `startServer` trusts the `dir` it's given. Any future caller other than `runServe` should resolve the root first.
- `findUiDistDir`'s "relative to project dir" candidate now points at the repo root rather than the cwd, which is the intended meaning.
