# gitrac

A CLI tool and web UI for managing project issues as markdown files in a git repo.

## Self-Bootstrapped

This project uses gitrac to track its own issues. The `.issues/` directory contains the active issues for this project. Use the gitrac CLI (or web UI) to view, create, and manage them.

```bash
./gitrac ls                    # list open issues
./gitrac show <id>             # view an issue
./gitrac create -t "title"     # create an issue
./gitrac claim <id>            # assign to yourself + set in_progress
./gitrac comment <id> -b "text" # add a comment
./gitrac close <id>            # close an issue
./gitrac                       # start the web UI at http://localhost:3000
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
./gitrac                           # start web server on :3000
```

For web UI development with hot reload, run both:
```bash
./gitrac                                          # API server on :3000
./bun run vite --config vite.config.ts            # Vite dev server on :5173
```

Open `http://localhost:5173` — Vite proxies API requests to the backend.

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
4. Close the issue: `./gitrac close <id>` (ideally in the same commit as the code change, using `--no-commit` on the close and committing everything together)
5. Run `./bun run check` before pushing
