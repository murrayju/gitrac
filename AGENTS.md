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
./gitrac claim <id>            # assign to yourself + set in_progress (exit 3 if someone else has it, in any worktree/branch)
./gitrac ready                 # open, unassigned-or-mine, unblocked issues (priority, then ID; -o json)
./gitrac next --claim          # atomically pick + claim the top ready issue (exit 5 if none)
./gitrac link <id> --blocked-by 3,4 [--parent 2]   # dependencies (unlink <id> -b 3 / --parent removes)
./gitrac unclaim <id>          # give it back (alias: release; also releases a claim held in another worktree/branch)
./gitrac ls --stale 2h         # claims with no activity for 2h (dead agents); also on ready, next [--claim], unclaim
./gitrac claim <id> --renew    # heartbeat: renew your own claim so it is not stale
./gitrac review <id>           # hand a claimed issue off for review (needs reviewStatus in config.yaml; stays claimed)
./gitrac comment <id> "text"    # add a comment (or --body-file <path|->)
./gitrac close <id>            # close an issue
./gitrac delete <id> --yes     # delete an issue + assets only it uses, unlink it from others (--dry-run to preview)
./gitrac renumber <id> --file <path>   # give one copy of a duplicated ID a fresh ID (--update-refs repoints links)
./gitrac install-merge-driver  # once per clone: issue-aware git merges (`init` does it too)
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
  service/    # Issue/config operations shared by CLI + web (lock, validate, write, commit)
  cli/        # Commander.js CLI commands
  web/
    server.ts # Hono HTTP server + API routes
    routes/   # REST API route handlers
    watcher.ts# File watcher + SSE
    ui/       # React SPA (Vite + Tailwind + Tiptap)
scripts/
  build.ts    # Two-phase build (Vite + bun compile)
  release.ts  # Version bump, tag, push (triggers the Publish workflow)
  npm/        # npm packaging: @gitrac/cli wrapper + per-platform binary packages
install.sh    # One-line installer served at https://get.gitrac.dev (see docs/releasing.md)
www/          # Static marketing site for https://gitrac.dev (GitHub Pages, see docs/releasing.md)
video/        # Remotion project for the gitrac.dev demo video, from real recordings (see video/README.md)
.issues/      # Project issues (managed by gitrac itself)
```

The architecture is layered: `core` (pure functions, no I/O) -> `fs` (filesystem) -> `git` (git operations) -> `service` (one function per mutation: `createIssue`, `updateIssue`, `addComment`, `editComment`, `deleteComment`, `closeIssue`, `reopenIssue`, `deleteIssue`, `renumberIssue`, `claimIssue`, `unclaimIssue`, `submitForReview`, `claimNextIssue`, `linkIssue`, `unlinkIssue`, `initProject`, `updateLabelColors`, `updateAssignees`, `installMergeDriver`) -> `cli`/`web` (thin adapters: parse input -> call the service -> format output, mapping `GitracError`s to exit codes / HTTP statuses). Each layer only depends on layers below it.

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
./bun run typecheck                # tsc --noEmit (src/, scripts/, root *.ts)
./bun run lint                     # biome check (every non-git-ignored file)
./bun run check                    # install + typecheck + lint + test
```

Tests are colocated with source files (`*.test.ts` next to `*.ts`). Use `bun:test` (`describe`, `test`, `expect`).

### Releasing

`./bun run scripts/release.ts <patch|minor|major|x.y.z>` bumps the version, tags and pushes; the tag-triggered Publish workflow builds the binaries, creates the GitHub Release and publishes the npm packages. See `docs/releasing.md` (including the one-time Cloudflare/npm setup). Keep `install.sh`, `scripts/npm/` and the workflow's platform matrix in sync.

### Building

```bash
./bun run scripts/build.ts                        # build to ./bin/gitrac
./bun run scripts/build.ts --minify --sourcemap   # production build
```

This builds the React UI with Vite, then compiles the CLI into a standalone binary with `bun build --compile`, embedding every `dist/ui` file (via a generated `dist/gitrac-entry.ts`) so the binary serves the UI from memory with nothing beside it. Running from source, the server serves gitrac's own `dist/ui` (resolved from the source tree, never the served project's dir); see `src/web/ui-assets.ts`.

## Code Conventions

- **TypeScript**, strict mode, `verbatimModuleSyntax` (use `import type` for type-only imports)
- **Biome** for linting and formatting (single quotes, space indent, organize imports)
- **No global bun** — always use `./bun` to ensure the pinned version
- **Bun APIs preferred** over Node.js equivalents (`Bun.file()`, `Bun.write()`, etc.)
- **`node:` prefix** for Node.js built-in imports
- **Resolve the project root via `resolveProjectOptions`** (`src/cli/global-options.ts`) at the start of every CLI command (not `getGlobalOptions`, whose `dir` is just `--dir`/cwd). It runs `git rev-parse --show-toplevel` so gitrac works from any subdirectory, and prints a friendly error if not in a git repo or `.issues/` isn't initialized (pass `{ requireInit: false }` for `init`).
- **Native `<select>`s use the `select-caret` class** (`src/web/ui/styles/globals.css`): it hides the browser's caret and draws a padded one for light and dark mode. Set left padding only (`pl-*`), not `px-*`/`pr-*`. A test checks every `<select>` in the UI.
- **Web routes are same-origin only** — `requestGuard` (`src/web/security.ts`) runs on every request; don't add CORS. Uploads are capped (`MAX_UPLOAD_BYTES`) and SVG is not allowed.
- **Mutations go through `src/service/`** — CLI commands and web routes don't read-modify-write issue or config files themselves. Each service operation takes a `ServiceContext` (root dir, identity, `loadConfig`, `noCommit`/`push`, a `CommitStrategy`, `onPushError`; build it with `cliServiceContext` in `src/cli/service-context.ts` or `webServiceContext` in `src/web/service-context.ts`) and returns the issue/config plus the changed paths. Validation, lifecycle/claim rules, label registration, file moves, commit messages and asset paths live there once, and behave the same on both surfaces — don't add per-surface switches. Service error messages are surface-neutral (no CLI flags): a CLI command appends its own hint by error code with `withHint` (`src/cli/errors.ts`). Validate input before loading the issue, so input errors take precedence. Add new mutations as service operations. Rewrite an existing issue with `relocateIssue` (`src/fs/issue-store.ts`), never plain `writeIssue`: it renames away a file whose name/directory no longer matches, so an issue stays one file (and returns both paths to commit).
- **Never hard-code status or priority names** — they come from `config.yaml` (`statuses` with `closed` flags, `priorities` in urgency order, plus optional `activeStatus` / `unclaimStatus` / `reviewStatus` / `closeStatus` / `cancelStatus`). Use the helpers in `src/core/workflow.ts` (`isClosedStatus(config, s)`, `activeStatus(config)`, `isHeldStatus(config, s)` (claimed = held + assigned), `closeStatus(config)`, `statusNames`, `statusSortOrder`, …) and, in the UI, `useWorkflow()`; `DEFAULT_STATUSES` / `DEFAULT_PRIORITIES` etc. are only the defaults. `Config.statuses` / `priorities` are normalized definitions; `serializeConfig` writes plain names where possible so a plain-list config round-trips unchanged. See "Statuses and Priorities" in `docs/specs/`.
- **Validate issue fields before writing** — any service operation that creates/updates an issue from user input runs it through `validateIssueFields` (`src/core/validate.ts`) first and rejects invalid input (CLI exit 2, HTTP 400) before touching disk. Register new labels with `registerLabels` (`src/fs/issue-store.ts`).
- **CLI errors are thrown, not `process.exit`ed** — commands signal failure by throwing a `GitracError` (`src/core/errors.ts`; helpers `issueNotFound`, `invalidInput`, `parseIssueIdArg`) and let the single top-level handler (`runCli` in `src/cli/index.ts` → `src/cli/errors.ts`) print `Error: <message>` or the `-o json` `{"error":{"code","message"}}` line to stderr and exit with the code's exit status. Don't catch-and-print in commands, never print warnings to stdout, and keep the exit codes stable (they're documented in the skill). See "Errors and Exit Codes" in `docs/specs/`.
- **Mutations must hold the repo lock** — every service operation runs its whole read-modify-write-commit in `withRepoLock` (`src/git/lock.ts`, re-entrant), so new mutations get it by being service operations. Mutating web routes also add the `mutationLock` middleware (`src/web/lock.ts`), which holds the same lock for the whole request (FIFO request order, `If-Match` response read-back) and answers 503 on timeout. Keep interactive input (prompts, stdin) outside the lock: read it before calling the service. See "Concurrency" in `docs/specs/`.
- **Availability is judged across worktrees and branches** — an issue's effective state is its newest version (by `updated`) here, in other worktrees' working trees, or on any local/remote-tracking branch (`issueStatesElsewhere`, `src/git/elsewhere.ts`; rules in `src/core/elsewhere.ts`). Pass those states to `decideClaim` / `isAvailableTo` / `nextIssue` rather than judging a claim from the local file alone. Web read routes add `claimedElsewhere` / `closedElsewhere` from the server's short-lived cached scan (`elsewhereCache(ctx)`, `src/web/elsewhere-cache.ts`), never a fresh scan per request; mutations scan fresh under the lock. The UI refetches for it on one shared timer (`elsewhereRefresh()`, `src/web/ui/lib/refresh-timer.ts`), not per-component intervals. See "Claims on other branches and worktrees" in `docs/specs/`.
- **Server config is live** — web routes read `ctx.config`, which is re-read from disk per request (`freshConfig`, `src/web/live-config.ts`) and, for mutations, under the lock (`mutationLock`, and the service's `loadConfig`). Don't cache config elsewhere in the server; tests that need a custom config must `writeConfig` it to disk, not just set `ctx.config`.
- **One SSE connection per tab** — UI code subscribes to live updates via `useSSE` (`src/web/ui/hooks.ts`) or `issueEvents()` (`src/web/ui/lib/event-stream.ts`), never `new EventSource`, and reads config via `useConfig()` (one shared fetch), never `fetchConfig()` directly. Each open stream holds one of the browser's ~6 per-host connections; a test enforces this.
- **Single-issue web mutations honor `If-Match`** — run the service operation through `mutateIssue` (`src/web/routes/issues.ts`): it passes an `If-Match` `precondition` that the service checks on the issue it loads under the lock (409 + current issue), maps errors via `errorResponse`, and replies via `respondWithIssue` so the response carries the new `ETag` (`src/web/etag.ts`). UI code that writes stale-able content (the description editor, comment edit/delete) sends the version it was based on.

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
parent: 12          # optional: sub-issue of #12
blockedBy:          # optional: can't start until these are closed
  - 3
created: 2026-03-28T12:00:00Z
createdBy: murrayju
updated: 2026-03-28T14:30:00Z
---

Description goes here (full markdown supported).

---

### author — 2026-03-28T12:05:00Z

Comment body here. Headings in comments are escaped with `\#`.
```

Unknown frontmatter keys (hand-added `estimate:`, `externalId:`, ...) are preserved verbatim after the known ones on every write and merge, and exposed read-only as `Issue.extra` (`-o json`, API). Don't build or copy issue frontmatter field by field without carrying `extra` along (`src/core/issue.ts`).

## Working on Issues

1. Run `./gitrac ls` (or `./gitrac ready`) to see open issues
2. Pick one and claim it: `./gitrac claim <id>` (or `./gitrac next --claim` to take the top ready one)
3. Implement the fix/feature
4. Add a comment summarizing what was done: `./gitrac comment <id> "text"` — or use `--comment` flag on close
5. Close the issue: `./gitrac close <id> --no-commit --comment "summary of changes"` (use `--no-commit` so you can commit the code changes, comment, and close together)
6. Commit everything together (code + issue changes) with a descriptive message referencing the issue number
7. Run `./bun run check` before pushing
