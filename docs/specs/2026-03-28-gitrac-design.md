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

`statuses`, `labels`, and `priorities` are the source of truth — the CLI/UI validate against these. Users can customize by editing config. Config is validated on load with fail-fast behavior and clear error messages for invalid/missing fields.

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
- Content after frontmatter, up to first `---` horizontal rule -> description (supports full markdown including headings)
- Content after that `---` -> comments section
- Each comment starts with `### {author} — {ISO8601 timestamp}` (em dash, U+2014)
- Any line starting with one or more `#` characters inside a comment body is escaped with a leading backslash (`\## Heading`). The parser unescapes these on read; the serializer escapes them on write.
- Cross-references use `#N` syntax (e.g., `#45`)

### Issue ID Scheme

Auto-incrementing integers. `nextId` in `config.yaml` is the counter. The CLI reads the counter, creates the file, increments the counter, and commits atomically. Race conditions are resolved by git (failed push -> rebase -> reassign ID if needed).

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
| `gitrac` | | Start web UI (default) |
| `gitrac init` | | Initialize `.issues/` in current repo. Errors if already exists (use `--force` to reinitialize). Errors if not in a git repo. |
| `gitrac create` | `new`, `add` | Create a new issue (interactive or via flags) |
| `gitrac list` | `ls` | List issues with filters. Default sort: ID ascending. |
| `gitrac show <id>` | `view` | Show full issue detail |
| `gitrac edit <id>` | | Edit issue metadata (status, priority, assignee, labels). Metadata only — description editing is via web UI or direct file editing. |
| `gitrac comment <id>` | `c` | Add a comment |
| `gitrac close <id>` | | Close issue (moves to `.issues/closed/`). `--cancelled` flag sets status to `cancelled` instead of `done`. |
| `gitrac reopen <id>` | | Reopen issue (moves back to `.issues/`) |
| `gitrac claim <id>` | | Assign to self + set status to `in_progress` |

### Global Flags

| Flag | Description |
|------|------------|
| `-o json` / `-o yaml` | Output format (default: human-readable) |
| `--push` / `--no-push` | Override configured push behavior |
| `--no-commit` | Skip git commit entirely |
| `--author <name>` | Override comment author (default: `git config user.name`) |
| `--dir <path>` | Override issues directory (validated to be within the current git repo) |

### Create Flags

```
gitrac create --title "Fix login" --priority high --labels bug,auth
gitrac create -t "Fix login" -p high -l bug,auth
gitrac create   # interactive mode — prompts for title, priority, etc.
```

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

**Web UI:** Amend strategy for rapid edits:
1. First edit to an issue -> new commit
2. Subsequent edits to the same issue -> amend that commit, **if and only if:**
   - The commit hasn't been pushed to a remote
   - No other commit has been made since (by CLI, another tool, or manual git)
3. If either condition fails -> new commit instead

**Implementation:** After committing, store the commit hash and issue ID in server memory. Before amending, verify `git log -1 --format=%H` matches the stored hash and the branch is ahead of remote. This has a narrow TOCTOU window that is acceptable for a single-user tool; if amend fails, fall back to a new commit.

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

Bun HTTP server with Hono router. Serves REST API and pre-built React SPA static assets. File watcher (`fs.watch`) on `.issues/` directory detects external changes; events pushed to UI via SSE for live updates.

### API Routes

| Method | Route | Description |
|--------|-------|------------|
| GET | `/api/issues` | List issues (supports query params for filtering) |
| GET | `/api/issues/:id` | Get single issue |
| POST | `/api/issues` | Create issue |
| PATCH | `/api/issues/:id` | Update issue metadata |
| POST | `/api/issues/:id/comments` | Add comment |
| PATCH | `/api/issues/:id/close` | Close issue |
| PATCH | `/api/issues/:id/reopen` | Reopen issue |
| GET | `/api/config` | Get project config |
| GET | `/api/git/status` | Branch, push state, warnings |
| GET | `/api/events` | SSE stream for live updates (file change notifications) |

### React UI

**Editor:** Tiptap (`@tiptap/react`) — the same editor framework Linear uses (built on ProseMirror). WYSIWYG with no edit/view mode toggle. Auto-saves on change (debounced). Markdown serialization via `tiptap-markdown` for round-tripping to `.md` files.

**List View:** Sortable/filterable table with columns: ID, Title, Status, Priority, Assignee, Labels, Updated. Colored status/priority badges. Click row to open detail view. Inline status/assignee quick-edit.

**Detail View:** Tiptap WYSIWYG editor for description (auto-save on change). Inline metadata editing (dropdowns for status, priority, assignee, labels). Comments rendered below with author/timestamp. Tiptap "add comment" editor at bottom. All changes trigger commit (with amend-until-pushed logic).

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
