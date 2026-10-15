# gitrac

A CLI tool and web UI for managing project issues as markdown files in a git repo.

## Self-Bootstrapped

This project uses gitrac to track its own issues. The `.issues/` directory contains the active issues for this project. Use the gitrac CLI (or web UI) to view, create, and manage them.

```bash
./gitrac ls                    # list open issues
./gitrac show <id>             # view an issue
./gitrac create -t "title"     # create an issue
./gitrac create -t "title" --description-file desc.md   # with a description (-d "text"; `-` = stdin)
./gitrac edit <id> -d "text"   # replace the description (or --description-file <path|->)
./gitrac claim <id>            # assign to yourself + set in_progress (exit 3 if someone else has it)
./gitrac unclaim <id>          # give it back (alias: release)
./gitrac comment <id> "text"    # add a comment (or --body-file <path|->)
./gitrac close <id>            # close an issue
./gitrac                       # start the web UI at http://localhost:3000
./gitrac serve -p 4000         # same, on another port (or: ./gitrac --port 4000)
./gitrac serve --host 0.0.0.0  # listen on all interfaces (default: 127.0.0.1 only; no auth!)
```

When working on a task, claim the corresponding issue first. Close it in the same commit that implements the fix when possible.

### Slash Commands

Use `/work-backlog` in OpenCode to automatically work through the issue backlog in order. See `.opencode/commands/` for details.

## Project Structure

```
src/
  core/       # Pure data layer (types, parsing, serialization, validation)
  fs/         # Filesystem CRUD for issue files
  git/        # Git operations (commit, amend, push, conflict resolution)
  cli/        # Commander.js CLI commands
  web/
    server.ts # Hono HTTP server + API routes
    routes/   # REST API route handlers
    watcher.ts# File watcher + SSE
    ui/       # React SPA (Vite + Tailwind + Tiptap)
scripts/
  build.ts    # Two-phase build (Vite + bun compile)
  release.ts  # Version bump, tag, push
.issues/      # Project issues (managed by gitrac itself)
```

The architecture is layered: `core` (pure functions, no I/O) -> `fs` (filesystem) -> `git` (git operations) -> `cli`/`web` (thin consumers). Each layer only depends on layers below it.

## Development

### Prerequisites

No global installs required. The `./bun` script auto-downloads the pinned Bun version on first use.

### Setup

```bash
./bun install
```

### Running

```bash
./gitrac <command>                 # run CLI directly
./gitrac                           # start web server on :3000 (alias for `serve`)
./gitrac serve -p 4000             # start web server on :4000
```

For web UI development with hot reload, run both:
```bash
./gitrac                                          # API server on :3000
./bun run vite --config vite.config.ts            # Vite dev server on :5173
```

Open `http://localhost:5173` — Vite proxies API requests to the backend at `127.0.0.1:3000`, keeping the browser's `Host` so it matches `Origin`. The server sends no CORS headers and rejects cross-origin mutations and unknown `Host` names (DNS rebinding) with 403, so don't add `changeOrigin: true` to the proxy or call the API cross-origin. See "Security" under "Web UI" in `docs/specs/`.

### Testing

```bash
./bun test                         # run all tests
./bun test src/core/               # run tests in a specific directory
./bun run typecheck                # tsc --noEmit
./bun run lint                     # biome check
./bun run check                    # install + typecheck + lint + test
```

Tests are colocated with source files (`*.test.ts` next to `*.ts`). Use `bun:test` (`describe`, `test`, `expect`).

### Building

```bash
./bun run scripts/build.ts                        # build to ./bin/gitrac
./bun run scripts/build.ts --minify --sourcemap   # production build
```

This builds the React UI with Vite, then compiles the CLI into a standalone binary with `bun build --compile`.

## Code Conventions

- **TypeScript**, strict mode, `verbatimModuleSyntax` (use `import type` for type-only imports)
- **Biome** for linting and formatting (single quotes, space indent, organize imports)
- **No global bun** — always use `./bun` to ensure the pinned version
- **Bun APIs preferred** over Node.js equivalents (`Bun.file()`, `Bun.write()`, etc.)
- **`node:` prefix** for Node.js built-in imports
- **Resolve the project root via `resolveProjectOptions`** (`src/cli/global-options.ts`) at the start of every CLI command (not `getGlobalOptions`, whose `dir` is just `--dir`/cwd). It runs `git rev-parse --show-toplevel` so gitrac works from any subdirectory, and prints a friendly error if not in a git repo or `.issues/` isn't initialized (pass `{ requireInit: false }` for `init`).
- **Web routes are same-origin only** — `requestGuard` (`src/web/security.ts`) runs on every request; don't add CORS. Uploads are capped (`MAX_UPLOAD_BYTES`) and SVG is not allowed.
- **Validate issue fields before writing** — any path that creates/updates an issue from user input runs it through `validateIssueFields` (`src/core/validate.ts`) first and rejects invalid input (CLI exit 1, HTTP 400) before touching disk. Register new labels with `registerLabels` (`src/fs/issue-store.ts`).
- **CLI errors are thrown, not `process.exit`ed** — commands signal failure by throwing a `GitracError` (`src/core/errors.ts`; helpers `issueNotFound`, `invalidInput`, `parseIssueIdArg`) and let the single top-level handler (`runCli` in `src/cli/index.ts` → `src/cli/errors.ts`) print `Error: <message>` or the `-o json` `{"error":{"code","message"}}` line to stderr and exit with the code's exit status. Don't catch-and-print in commands, never print warnings to stdout, and keep the exit codes stable (they're documented in the skill). See "Errors and Exit Codes" in `docs/specs/`.
- **Mutations must hold the repo lock** — wrap the whole read-modify-write-commit of any new CLI command in `withMutationLock` (`src/cli/global-options.ts`) and add the `mutationLock` middleware (`src/web/lock.ts`) to any new mutating web route. Keep interactive input (prompts, stdin) outside the lock. See "Concurrency" in `docs/specs/`.
- **Server config is live** — web routes read `ctx.config`, which is re-read from disk per request (`freshConfig`, `src/web/live-config.ts`) and inside `mutationLock` for mutations. Don't cache config elsewhere in the server; tests that need a custom config must `writeConfig` it to disk, not just set `ctx.config`.
- **One SSE connection per tab** — UI code subscribes to live updates via `useSSE` (`src/web/ui/hooks.ts`) or `issueEvents()` (`src/web/ui/lib/event-stream.ts`), never `new EventSource`, and reads config via `useConfig()` (one shared fetch), never `fetchConfig()` directly. Each open stream holds one of the browser's ~6 per-host connections; a test enforces this.
- **Single-issue web mutations honor `If-Match`** — load the issue with `loadIssue`, return `preconditionFailed(c, loaded)` if set (409 + current issue), and reply via `respondWithIssue` so the response carries the new `ETag` (`src/web/routes/issues.ts`, `src/web/etag.ts`). UI code that writes stale-able content (the description editor, comment edit/delete) sends the version it was based on.

## Issue File Format

Issues are markdown files with YAML frontmatter in `.issues/`. Closed issues live in `.issues/closed/`.

```markdown
---
id: 1
title: Fix login timeout
status: in_progress
priority: high
assignee: murrayju
labels:
  - bug
created: 2026-03-28T12:00:00Z
createdBy: murrayju
updated: 2026-03-28T14:30:00Z
---

Description goes here (full markdown supported).

---

### author — 2026-03-28T12:05:00Z

Comment body here. Headings in comments are escaped with `\#`.
```

## Working on Issues

1. Run `./gitrac ls` to see open issues
2. Pick one and claim it: `./gitrac claim <id>`
3. Implement the fix/feature
4. Add a comment summarizing what was done: `./gitrac comment <id> "text"` — or use `--comment` flag on close
5. Close the issue: `./gitrac close <id> --no-commit --comment "summary of changes"` (use `--no-commit` so you can commit the code changes, comment, and close together)
6. Commit everything together (code + issue changes) with a descriptive message referencing the issue number
7. Run `./bun run check` before pushing
