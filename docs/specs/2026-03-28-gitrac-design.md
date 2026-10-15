# gitrac — Design Specification

## Overview

gitrac is a CLI tool and web UI for managing project issues as markdown files inside a git repository. Issues live alongside code, enabling atomic operations (e.g., closing an issue in the same commit that fixes it), offline-first workflows, and seamless integration with coding agents.

## Goals

- Issues stored as human-readable markdown files with YAML frontmatter
- CLI for all CRUD operations with auto-commit to git
- Local web server with a Linear-inspired React UI
- WYSIWYG editing (Tiptap) with auto-save
- Ships as a single binary via `bun build --compile`
- Agent-friendly: structured output via `-o json` / `-o yaml`
- Designed for future GitHub Issues sync (not in v1)

## Non-Goals (v1)

- Real-time collaboration / multi-user web UI
- GitHub Issues two-way sync
- Cross-repo issue tracking
- Board/kanban view (list + detail views only in v1)

---

## Data Model

### Directory Structure

```
.issues/
  config.yaml                    # Project configuration
  1-fix-login-timeout.md         # Open issue
  2-add-dark-mode.md             # Open issue
  closed/
    3-update-readme.md           # Closed issue
```

### config.yaml

```yaml
version: 1
nextId: 4
statuses: [backlog, todo, in_progress, done, cancelled]
labels: [bug, feature, enhancement, docs, chore]
priorities: [urgent, high, medium, low, none]
defaultStatus: backlog
defaultPriority: medium
git:
  autoCommit: true
  autoPush: false
  commitPrefix: "issue:"
  defaultBranch: main
```

`statuses`, `labels`, and `priorities` are the source of truth — the CLI/UI validate against these. Users can customize by editing config. Config is validated on load with fail-fast behavior and clear error messages for invalid/missing fields. Like issue frontmatter, `config.yaml` is parsed with the YAML core schema (js-yaml 4, a pinned direct dependency): `!!js/*`, `!!timestamp`, `!!binary`, `!!set`/`!!omap` tags are rejected, so a config from an untrusted clone/PR can only ever yield plain strings, numbers, booleans, nulls, lists and maps, and date-like values (e.g. `defaultBranch: 2026-03-28`) stay strings.

**Write validation:** Every create/update path (CLI `create`/`edit`, `POST`/`PATCH /api/issues`) validates its input with `validateIssueFields` (`src/core/validate.ts`) before writing anything: `status` and `priority` must be in the configured lists, `title` must be a non-empty string, `labels` an array of non-empty strings, `assignee`/`description` strings. Titles and labels are trimmed and labels de-duplicated. Invalid input is rejected as a whole — the CLI prints each error and exits 2 (`invalid_input`), the API returns 400 `{ error, errors[] }` — and no file (not even `nextId`) changes. Unknown labels are not an error: both the CLI and the web register them in `config.labels` with an auto-assigned color, committed alongside the issue.

### Issue File Format

**Filename:** `{id}-{slugified-title}.md`

```markdown
---
id: 1
title: Fix login timeout
status: in_progress
priority: high
assignee: murrayju
labels:
  - bug
  - auth
created: 2026-03-28T12:00:00Z
createdBy: murrayju
updated: 2026-03-28T14:30:00Z
---

The login page times out after 30 seconds when the session middleware
is under load. This started after commit abc123.

## Acceptance Criteria

- Login succeeds within 5 seconds under normal load
- Timeout is configurable

---

### murrayju — 2026-03-28T12:05:00Z

I think this is related to the session middleware changes in #45.

```ts
const timeout = getSessionTimeout();
```

### agentbot — 2026-03-28T12:10:00Z

Investigating. Claimed this issue.

\## Analysis

Found that the timeout defaults to 30s instead of 300s.
```

### Parsing Rules

- YAML frontmatter between first `---` pair -> metadata
- Frontmatter is parsed with the YAML core schema (no timestamp type), so `created`/`updated` are always strings whether or not they are quoted (`created: 2026-03-28T12:00:00Z` and `created: "2026-03-28T12:00:00Z"` are equivalent). Fields are coerced defensively: `id` to a number (numeric strings accepted), `title`/`assignee`/`createdBy`/`status`/`priority` to strings (missing -> `''`), `labels` to an array of strings (a single scalar becomes a one-element list)
- Content after frontmatter, up to the separator -> description (supports full markdown including headings and horizontal rules)
- The separator is the first `---` line outside a fenced code block whose next non-blank line is a comment header. Any other `---` (or `***`, `___`) is an ordinary horizontal rule and stays in the description. Content after the separator -> comments section, which therefore always starts with a comment header.
- Each comment starts with `### {author} — {ISO8601 timestamp}` (em dash, U+2014)
- Any line starting with one or more `#` characters inside a comment body (outside code fences) is escaped with a leading backslash (`\## Heading`). Inside code fences, only lines that look like a comment header are escaped. The parser unescapes these on read; the serializer escapes them on write.
- In the description, a comment-header-like line that directly follows a `---` line (outside code fences) is escaped with a leading backslash so it cannot be mistaken for the separator. All other description content is written verbatim.
- Escaping is reversible: a line that already starts with backslashes gets one more, and the parser removes exactly one.
- Fenced code blocks may use ```` ``` ```` or `~~~` (3+ characters, optionally indented); a fence closes only with the same character at least as long as the opener. If a description ends inside an unclosed fence and the issue has comments, the serializer closes the fence so it cannot swallow the comments.
- Cross-references use `#N` syntax (e.g., `#45`)

### Issue ID Scheme

Auto-incrementing integers. `nextId` in `config.yaml` is the counter. Allocation takes `max(nextId, highest existing issue file ID + 1)` across `.issues/` and `.issues/closed/`, so a stale counter (e.g. after a merge) never yields a duplicate ID within a checkout. Allocation, writing the file, bumping the counter and committing all happen under the repo lock (see [Concurrency](#concurrency)), so parallel local creates can't collide. Races across clones/branches are resolved by git (failed push -> rebase -> reassign ID if needed).

### File Lookup

Issues are looked up by ID prefix match on the filename (`{id}-*.md`). Renaming a title changes the slug portion of the filename but the ID prefix remains the canonical identifier. Lookup searches both `.issues/` and `.issues/closed/`.

---

## Architecture

Layered library architecture:

```
src/
  core/          # Pure data layer — parse/serialize issues, validate, transform
  git/           # Git operations — commit, amend, push, pull, conflict resolution
  cli/           # CLI commands — thin wrappers over core + git
  web/
    server/      # Bun HTTP server (Hono) + REST API
    ui/          # React SPA (Vite + Tailwind + Tiptap)
```

**Core layer** — pure functions, no I/O. Parses frontmatter (gray-matter), validates issue structure, serializes back to markdown. Handles comment escaping/unescaping. Testable without git.

**Git layer** — all git operations. Commit, amend-until-pushed, push, pull, rebase, conflict resolution for issue files. Tracks "amendable" commit state. Uses simple-git or shells out to git.

**CLI layer** — thin command wrappers using Commander.js. Reads args/flags, calls core + git, formats output.

**Web layer** — Hono server serves REST API + pre-built React SPA. File watcher detects external changes and pushes events to the UI via SSE (Server-Sent Events).

---

## CLI Interface

### Commands

| Command | Aliases | Description |
|---------|---------|------------|
| `gitrac` | | Start web UI (default; alias for `gitrac serve`). Accepts `--port <port>` and `--host <host>`. |
| `gitrac serve` | | Start web UI. `-p, --port <port>` (default: 3000), `--host <host>` (default: `127.0.0.1`). |
| `gitrac init` | | Initialize `.issues/` in current repo. Errors if already exists (use `--force` to reinitialize). Errors if not in a git repo. |
| `gitrac create` | `new`, `add` | Create a new issue (interactive or via flags) |
| `gitrac list` | `ls` | List issues with filters. Default sort: ID ascending. |
| `gitrac show <id>` | `view` | Show full issue detail |
| `gitrac edit <id>` | | Edit issue fields (title, status, priority, assignee, labels, description). See [Text Input](#text-input). |
| `gitrac comment <id> [body]` | `c` | Add a comment. Body from the argument, `-F, --body-file <path\|->`, or piped stdin. |
| `gitrac close <id>` | | Close issue (moves to `.issues/closed/`). `--cancelled` flag sets status to `cancelled` instead of `done`. |
| `gitrac reopen <id>` | | Reopen issue (moves back to `.issues/`) |
| `gitrac claim <id>` | | Assign to self + set status to `in_progress`. Exclusive: see [Claiming](#claiming). |
| `gitrac unclaim <id>` | `release` | Give an issue back: clear `assignee`, and set `in_progress` back to `todo`. See [Claiming](#claiming). |

### Global Flags

| Flag | Description |
|------|------------|
| `-o json` / `-o yaml` | Output format (default: human-readable) |
| `--push` / `--no-push` | Override configured push behavior |
| `--no-commit` | Skip git commit entirely |
| `--author <name>` | Override comment author / `createdBy` (default: `git config user.name`); with `serve`, the default author for web changes |
| `--dir <path>` | Directory to locate the project from (default: cwd). Any path inside the repo works. |
| `--debug` | Print stack traces on errors |
| `--port <port>` | Web server port for bare `gitrac` (long form only; `serve` also accepts `-p`) |
| `--host <host>` | Web server bind interface (default `127.0.0.1`; e.g. `0.0.0.0` for all interfaces) |

**Project root resolution:** every command (including `serve` / bare `gitrac`) resolves the project root once, via `git rev-parse --show-toplevel` starting from `--dir` (or the cwd), so gitrac works from any subdirectory of the repo. `.issues/` always lives at that root. Outside a git repo, commands exit 8 (`not_a_git_repo`) with `Error: Not inside a git repository`; if `.issues/config.yaml` is missing, every command except `init` exits 8 (`not_initialized`) with a message to run `gitrac init`.

Global flags may appear before or after the subcommand (`gitrac --no-commit close 1` and `gitrac close 1 --no-commit` are equivalent). `--no-commit` applies to every mutating command (`init`, `create`, `edit`, `comment`, `close`, `reopen`, `claim`, `unclaim`) and also suppresses push. If both `--push` and `--no-push` are given, the last one wins.

Because global flags are matched anywhere on the command line, they must not define short flags that subcommands also use. In particular `-p` belongs to the subcommands (`create -p high`, `edit -p high`, `serve -p 4000`); the global port option is long-only (`--port`).

### Claiming

The claimer's identity is their git `user.email` (falling back to `user.name`), or the `--author` name if given; an `assignee` matches the user if it equals (case-insensitively) either their email or name. The check and the write happen under the repo mutation lock, so of several concurrent claims exactly one wins.

| Situation | `claim` | `claim --force` |
|-----------|---------|-----------------|
| Open, unassigned (or assigned but not `in_progress`) | Claims | Claims |
| `in_progress`, assigned to someone else | Fails, exit **3**, no change | Takes over |
| `in_progress`, assigned to you | No-op (exit 0, no commit; `-c` comment is not added) | No-op |
| Closed (`done`/`cancelled`) | Fails, exit **4**, no change | Reopens and claims |

`unclaim <id>` (alias `release`) clears `assignee` and moves `in_progress` back to `todo` (other statuses are kept). It fails with exit **3** if the issue is assigned to someone else (`--force` overrides), exits **4** for closed issues, and is a no-op if the issue is unassigned. Accepts `-c, --comment`.

Exit codes: `3` claimed by someone else, `4` issue is closed (see [Errors and Exit Codes](#errors-and-exit-codes)).

### Errors and Exit Codes

Commands never call `process.exit` on failure: they throw a `GitracError` (`src/core/errors.ts`) carrying a machine-readable `code`, and a single top-level handler (`runCli` in `src/cli/index.ts`, using `src/cli/errors.ts`) prints it and exits with that code's exit status. Errors from simple-git become `git_error`; Commander usage errors (unknown option, missing argument, bad `-o` value) become `usage`; anything else becomes `error` with the original message.

Errors always go to **stderr**; stdout carries only the command's result (so with `-o json`, stdout is either the result or empty). Warnings (e.g. the non-default-branch warning) also go to stderr, before the error.

- **human:** `Error: <message>` (one line per message when several fields are invalid).
- **`-o json`:** one line, the last line of stderr: `{"error":{"code":"not_found","message":"Issue #9 not found","id":9}}`. `code` and `message` are always present; some errors add fields (`id`, `assignee`, `status`, `errors` for multiple validation messages, `lockPath`, `reason` for usage errors).
- **`-o yaml`:** the same object as YAML.
- Stack traces are printed only with `--debug` (before the error line).

| Exit | `code` | Meaning |
|------|--------|---------|
| 0 | — | Success (including no-op claims) |
| 1 | `error`, `invalid_config`, `server_error` | Unexpected error, unparseable `.issues/config.yaml`, web server failed to start |
| 2 | `invalid_input`, `usage` | Bad issue ID, field value, text input, flag, or missing argument; nothing written |
| 3 | `already_claimed`, `already_initialized`, `invalid_state` | Conflicts with current state: claimed by someone else (`claim`/`unclaim`), `init` on an initialized repo, `reopen` of an open issue |
| 4 | `issue_closed` | `claim`/`unclaim` on a closed issue |
| 5 | `not_found` | The issue doesn't exist |
| 6 | `lock_timeout` | Timed out waiting for the repo lock (safe to retry) |
| 7 | `git_error` | A git command (commit, push) failed. The issue file may already be written (and its result printed) |
| 8 | `not_a_git_repo`, `not_initialized` | Not inside a git work tree, or `gitrac init` hasn't been run |

These values are a public contract for scripts and agents; keep them stable.

### Create Flags

```
gitrac create --title "Fix login" --priority high --labels bug,auth
gitrac create -t "Fix login" -p high -l bug,auth
gitrac create -t "Fix login" -d "Steps to reproduce: ..."
gitrac create -t "Fix login" --description-file desc.md
gitrac create   # interactive mode — prompts for title, priority, etc.
```

### Text Input

Long text can be passed inline or read from a file; `-` reads stdin.

| Command | Inline | From file / stdin |
|---------|--------|-------------------|
| `create`, `edit` | `-d, --description <text>` | `--description-file <path\|->` |
| `comment` | `[body]` argument | `-F, --body-file <path\|->` |

- Giving both the inline and file form is an error (exit 2, nothing written).
- File paths are relative to the current working directory (not `--dir`). A missing file exits 2.
- Text is trimmed (it is trimmed on read-back anyway). `edit -d ""` clears the description; an empty comment body is rejected.
- `edit` replaces the whole description; comments are untouched.
- `comment` with no body argument and no `--body-file` still reads stdin when it is piped (not a TTY).
- Input is read before the repo mutation lock is taken.

### List Filters

```
gitrac ls                        # all non-closed issues
gitrac ls --status done          # done issues
gitrac ls --status all           # everything
gitrac ls --assignee murrayju
gitrac ls --label bug
gitrac ls --priority urgent,high
gitrac ls --sort priority
```

### Commit Messages

Auto-generated with the configured prefix:

```
issue: create #3 - Fix login timeout
issue: comment on #3
issue: close #3 - Fix login timeout
issue: update #3 priority=high assignee=murrayju
issue: claim #3 (murrayju)
```

---

## Git Operations

### Commit Strategy

**CLI:** Each mutating command creates one commit.

**Path-limited commits:** Every gitrac commit (and amend) contains only the paths gitrac itself wrote — the issue file(s), `config.yaml`, label/asset files — never the rest of the index. gitrac stages exactly those paths (`git add -A -- <paths>`, so deletions and renames from close/reopen/title changes are recorded) and commits with `git commit [--amend] --only -- <paths>`. Anything else you or another tool had staged stays staged and uncommitted. Listed paths that don't exist and are unknown to git are skipped; if nothing remains, no commit is made.

**Web UI:** Amend strategy for rapid edits:
1. First edit to an issue -> new commit
2. Subsequent edits to the same issue -> amend that commit, **if and only if:**
   - The commit hasn't been pushed to a remote
   - No other commit has been made since (by CLI, another tool, or manual git)
3. If either condition fails -> new commit instead
4. If an amend leaves the commit with no net change vs. its parent (every file it touches is one of the issue files gitrac just committed, and only the frontmatter `updated:` timestamp differs), the commit is dropped. The drop uses `git reset --soft HEAD~1` and then restores only those issue files (index + working tree) to the parent's version — it never uses `reset --hard`, so unrelated staged/unstaged work is preserved.
5. An amended commit keeps the first operation's message so history still shows what happened (e.g. `create #5 Fix login`); when a later operation with a different message is folded in, the subject gets a single ` (+ edits)` suffix (`create #5 Fix login (+ edits)`).

**Implementation:** After committing, store the commit hash and issue ID in server memory. Before amending, verify `git log -1 --format=%H` matches the stored hash and the branch is ahead of remote. This has a narrow TOCTOU window that is acceptable for a single-user tool; if amend fails, fall back to a new commit.

### Concurrency

Every mutation — CLI command or web API request — runs its whole read-modify-write-commit sequence (reading the issue/config, ID allocation, writing files, `git add`/`commit`/amend, and push) while holding a repo-wide lock. This applies even with `--no-commit`, since the file writes themselves can race.

- **Cross-process:** a lockfile at `$(git rev-parse --git-common-dir)/gitrac.lock` (shared by all worktrees of the repo). It is created atomically (temp file + hard link) and records the holder's PID, hostname, and a token. Waiters retry with jittered exponential backoff and give up after 120s (CLI: `lock_timeout`, exit 6; web: HTTP 503).
- **In-process:** within one process (notably the web server) callers queue FIFO per lock before competing for the lockfile, so overlapping autosave/comment requests are applied one at a time.
- **Stale locks:** a lock is broken if its holder is on the same host and its PID is dead, or if its mtime is older than 60s. Holders refresh the mtime every 15s, so a long push is never mistaken for an abandoned lock. Breaking happens under a secondary `gitrac.lock.break` lock and re-verifies the lock contents, so a freshly acquired lock is never removed. A process that calls `process.exit()` while holding the lock removes it on exit.
- **Re-entrant:** nested acquisitions in the same async context are no-ops; low-level git helpers (`commitPaths`, `commitOrAmend`, push/pull) take the lock themselves as a safety net.
- Outside a git repo (tests, plain directories) the lock lives in the OS temp dir, keyed by directory.
- Asset uploads and drafts don't take the lock: uploads write new uniquely-named files and drafts are untracked.

**Web edits vs. external changes (optimistic concurrency).** The lock serializes writes but doesn't stop a client from writing back content it loaded before someone else's change. So single-issue API responses (`GET /api/issues/:id` and every mutation that returns an issue) carry an `ETag`: a quoted SHA-1 of the issue file's raw bytes, so any change — web, CLI, agent, `git pull`, hand edit — yields a new version. Mutations on an existing issue (`PATCH /api/issues/:id`, comment add/edit/delete, close, reopen) accept `If-Match: <etag>` (or `*`); it is checked under the lock and a mismatch returns **409** `{ error, current }` with the current issue and its `ETag`, writing nothing. Without `If-Match` the request is last-writer-wins, as before (curl, scripts, metadata dropdowns that only send the changed field). Mutation responses return the issue as re-read from disk, so their body and `ETag` match a subsequent GET.

The description editor sends the version its content is based on with every autosave, one save at a time. When a newer version arrives (SSE refetch or a 409's `current`): if the description is unchanged (only comments/metadata changed) it just adopts the new version (and retries a 409'd save); if the description changed and the editor has no unsaved edits, the new text is loaded into the editor; if it has unsaved edits, autosave pauses and a notice offers "Discard mine, load theirs" or "Keep mine, overwrite theirs". Comment edit/delete send the version too, since comments are addressed by index. The title input is an explicit edit of one field and stays last-writer-wins.

Implementation: `withLock` (`src/fs/lock.ts`, generic) and `withRepoLock` (`src/git/lock.ts`, resolves the lock path). The CLI wraps commands with `withMutationLock`; web routes use the `mutationLock` middleware (`src/web/lock.ts`).

### Push/Pull

- `--push` flag forces push, `--no-push` flag forces no push, absence of either defers to `config.git.autoPush`
- Before commit: if remote has changes, attempt `git pull --rebase` first
- Issue file conflict auto-resolution (see below)

### Conflict Resolution

Issue files have predictable structure, enabling smarter-than-default merge:

1. **Frontmatter:** Per-field last-writer-wins (not whole-block replacement)
2. **Description:** Standard merge; flag for manual resolution if truly conflicting
3. **Comments:** Append-only — keep both sides, sort by timestamp

### Branch Warning

When current branch != `config.git.defaultBranch`, display prominent warning in CLI output and persistent yellow banner in web UI.

---

## Web UI

### Server

Bun HTTP server with Hono router. Serves REST API and pre-built React SPA static assets. File watcher (`fs.watch`) on `.issues/` directory detects external changes; events pushed to UI via SSE for live updates. The SSE stream (`GET /api/events`) is long-lived: the route lifts Bun's idle timeout for that request only and writes a `: keep-alive` comment every 5s (so proxies don't drop it either). It sends a `connected` event on every (re)connect and an `issues-changed` event on each change; the UI refetches on both, so changes made while it was disconnected are never missed. The UI opens exactly one `EventSource` per tab (`src/web/ui/lib/event-stream.ts`), shared by every hook via a ref-counted subscriber set — browsers allow only ~6 HTTP/1.1 connections per host, so per-component streams would starve all other requests. Likewise the project config is fetched by one shared store (`useConfig`), not per component.

**Live config.** The server never caches `config.yaml` from startup: it re-reads it before every read-only API request (so `GET /api/config` and `GET /api/git/status` reflect CLI changes such as new assignees from `claim`, label colors, or `git.*` settings) and, for mutations, again right after acquiring the repo lock (so defaults, validation and `git.autoCommit`/`commitPrefix` match the file another process may just have written). If the file is momentarily unreadable or invalid, the last good config is kept. `config.yaml` lives in the watched `.issues/` directory, so a change also emits `issues-changed` over SSE, on which the UI's shared config store refetches.

**Identity.** Web writes are attributed like the CLI's: the server resolves `git config user.name` / `user.email` (as seen from the project root) at startup and re-reads it at most every few seconds, so `git config` changes are picked up without a restart; `gitrac --author <name> serve` pins a fixed name instead. `createdBy` on `POST /api/issues` and the comment author on `POST /api/issues/:id/comments` default to that name (`unknown` if git has none). Either request may send `author` (non-empty string, else 400) to override it — the UI's "Acting as" picker in the sidebar lets the user choose a name from `config.assignees` (remembered in `localStorage`). `GET /api/identity` returns the default `{ name, email }`. Assignee semantics are unchanged.

### Security

The server has no authentication, so exposure is limited instead (`src/web/security.ts`):

- **Loopback by default.** Binds `127.0.0.1`. `--host <host>` opts into another interface (`0.0.0.0` = all); the server then prints a warning that anyone who can reach it can read/modify issues and create commits.
- **No CORS.** The UI is same-origin and the Vite dev server proxies `/api`, so no `Access-Control-*` headers are sent; other sites can't read API responses.
- **Host check (DNS rebinding), all requests.** The `Host` header must be an IP literal, `localhost` / `*.localhost`, or the exact name passed to `--host`; anything else gets 403. (A rebinding attack needs an attacker-controlled domain name, which this rejects.) If you bind to all interfaces, reach the server by IP, or pass the name you'll use as `--host`.
- **Origin check (CSRF), mutating requests.** For anything but GET/HEAD/OPTIONS, an `Origin` header must have the same host:port as `Host`; without `Origin`, a `Sec-Fetch-Site` other than `same-origin`/`none` is rejected. Requests with neither header (curl, scripts) are allowed.
- **Vite dev proxy.** `vite.config.ts` proxies `/api` to `http://127.0.0.1:3000` with `changeOrigin: false`, so the browser's `Host` (`localhost:5173`) and `Origin` (`http://localhost:5173`) still match and pass both checks.
- **Uploads.** `POST /api/issues/assets` accepts PNG, JPEG, GIF, WebP, BMP, and ICO up to 10 MiB (413 above that). SVG is rejected — it can carry script and would be served from the app's origin.
- **Serving assets.** Assets are served with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; …; sandbox`, so a file opened directly (e.g. an SVG committed earlier) can't run script in the app's origin. Unknown file types are sent as `application/octet-stream` with `Content-Disposition: attachment`.
- All request bodies are capped at 11 MiB (`maxRequestBodySize`).

### API Routes

| Method | Route | Description |
|--------|-------|------------|
| GET | `/api/issues` | List issues (supports query params for filtering) |
| GET | `/api/issues/:id` | Get single issue |
| POST | `/api/issues` | Create issue (optional `author` sets `createdBy`) |
| PATCH | `/api/issues/:id` | Update issue metadata |
| POST | `/api/issues/:id/comments` | Add comment (`body`; optional `author`) |
| PUT | `/api/issues/:id/comments/:index` | Edit comment |
| DELETE | `/api/issues/:id/comments/:index` | Delete comment |
| PATCH | `/api/issues/:id/close` | Close issue |
| PATCH | `/api/issues/:id/reopen` | Reopen issue |
| GET | `/api/config` | Get project config |
| GET | `/api/identity` | Default author for web writes (`{ name, email }` from git config / `--author`) |
| GET | `/api/git/status` | Branch, push state, warnings |
| GET | `/api/events` | SSE stream for live updates: `connected` on (re)connect, `issues-changed` on file changes, `: keep-alive` comments every 5s |
| POST | `/api/issues/assets` | Upload an image (multipart `file`; no SVG; max 10 MiB) |

### React UI

**Editor:** Tiptap (`@tiptap/react`) — the same editor framework Linear uses (built on ProseMirror). WYSIWYG with no edit/view mode toggle. Auto-saves on change (debounced). Markdown serialization via `tiptap-markdown` for round-tripping to `.md` files.

**List View:** Sortable/filterable table with columns: ID, Title, Status, Priority, Assignee, Labels, Updated. Colored status/priority badges. Click row to open detail view. Inline status/assignee quick-edit.

**Detail View:** Tiptap WYSIWYG editor for description (auto-save on change; external changes are loaded into the editor or flagged as a conflict — see "Concurrency"). Inline metadata editing (dropdowns for status, priority, assignee, labels). Comments rendered below with author/timestamp. Tiptap "add comment" editor at bottom. All changes trigger commit (with amend-until-pushed logic).

**Visual Style:** Dark theme by default (with light theme option). Status colors: backlog=gray, todo=blue, in_progress=yellow, done=green, cancelled=red. Clean sans-serif typography, minimal chrome.

**Branch Warning:** Persistent yellow banner when not on default branch.

### Build

Vite builds the React SPA at publish time. `bun build --compile` produces a single binary with embedded assets. During development, Vite dev server proxies API requests to the Bun backend for hot reloading.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Bun |
| Binary | `bun build --compile` |
| CLI framework | Commander.js |
| Frontmatter parsing | gray-matter |
| Web server | Hono (on Bun) |
| Web UI | React + Vite + Tailwind CSS |
| Rich text editor | Tiptap (`@tiptap/react`) |
| Markdown <-> Tiptap | `tiptap-markdown` |
| Git operations | simple-git |
| File watching | `fs.watch` (Bun built-in) |
| Linting/formatting | Biome |
| Testing | Bun built-in test runner |

### Project Conventions (following ox patterns)

- `./bun` bootstrap script pins Bun version, auto-downloads on first use
- `./bun` used in all scripts and CI (never global `bun`)
- Biome for linting + formatting (space indent, single quotes)
- Tests colocated with source (`*.test.ts` next to `*.ts`)
- `bun:test` for test runner (`describe`, `test`, `expect`)
- `import type` enforced via `verbatimModuleSyntax`
- `bun build --compile` for single-binary distribution
- GitHub Actions: check workflow (lint, typecheck, test), publish workflow (multi-platform build + release)
- `release.ts` script for version bumping and tag creation

---

## Future Considerations (not in v1)

- **GitHub Issues sync:** Data model supports it — frontmatter could include `externalId` / `syncedAt` fields
- **Board/kanban view:** Columns by status with drag-to-change
- **Attachments:** Would require directory-per-issue structure (migration path from single files)
- **Custom fields:** Extensible frontmatter schema
- **Templates:** Issue templates in `.issues/templates/`
