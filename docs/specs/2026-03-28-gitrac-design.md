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
  .gitattributes                 # Routes issue files + config.yaml to the gitrac merge driver
  1-fix-login-timeout.md         # Open issue
  2-add-dark-mode.md             # Open issue
  closed/
    3-update-readme.md           # Closed issue
```

### config.yaml

```yaml
version: 1
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

`statuses`, `labels`, and `priorities` are the source of truth — the CLI/UI validate against these. Users can customize by editing config (see [Statuses and Priorities](#statuses-and-priorities)). Config is validated on load with fail-fast behavior and clear error messages for invalid/missing fields. A `nextId:` key written by older gitrac versions is still accepted (it must be a number) and read as a lower bound for new IDs, but gitrac never writes, bumps or adds it any more — see [Issue ID Scheme](#issue-id-scheme). Like issue frontmatter, `config.yaml` is parsed with the YAML core schema (js-yaml 4, a pinned direct dependency): `!!js/*`, `!!timestamp`, `!!binary`, `!!set`/`!!omap` tags are rejected, so a config from an untrusted clone/PR can only ever yield plain strings, numbers, booleans, nulls, lists and maps, and date-like values (e.g. `defaultBranch: 2026-03-28`) stay strings.

#### Statuses and Priorities

Statuses and priorities are fully configurable; nothing in gitrac depends on the built-in names (`backlog`, `todo`, `in_progress`, `done`, `cancelled`; `urgent` … `none`) except as defaults. The rules live in `src/core/workflow.ts`.

```yaml
statuses:                  # workflow order: dropdowns, filters
  - backlog                # a plain name...
  - todo
  - name: in_progress      # ...or a definition
    label: In Progress     #   optional display name (default: name humanized)
    color: '#d4a843'       #   optional badge color (#rgb / #rrggbb)
  - name: review
    closed: false          #   closed issues live in .issues/closed/
  - done
  - name: wontfix
    label: Won't fix
    closed: true
priorities:                # most urgent first (--sort priority order)
  - name: urgent
    color: '#e05d5d'
  - high
  - medium
  - low
defaultStatus: backlog     # new issues and reopen; must be open
defaultPriority: medium
activeStatus: in_progress  # optional: what claim sets (claimed = this + assigned); open
unclaimStatus: todo        # optional: where unclaim moves an active issue; open
closeStatus: done          # optional: what close sets; closed
cancelStatus: wontfix      # optional: what close --cancelled sets; closed
```

- **Entries** are a plain name or `{ name, label?, color?, closed? }` (priorities: no `closed`). Names are lowercase letters, digits, `_` and `-` (filters are comma-separated and case-insensitive); `all` is not a status. A plain name — or a definition without `closed` — is closed only if it is `done` or `cancelled`, so the old plain-list format (`statuses: [backlog, todo, in_progress, done, cancelled]`) still works unchanged and is read as before; an unknown legacy name is open. A status an issue has but the config doesn't list is judged by the same rule.
- **Workflow statuses:** when a key is unset, the built-in name is used if it is a configured status of the right kind, else a fallback: `activeStatus` → `in_progress`, else the last open status; `unclaimStatus` → `todo` (unless it's the active status), else `defaultStatus`; `closeStatus` → `done`, else the first closed status; `cancelStatus` → `cancelled`, else none (`close --cancelled` then fails with `invalid_input`, exit 2 / HTTP 400, naming the closed statuses).
- **Validation** (on every read; an inconsistent config is `invalid_config`, exit 1, with every problem listed, e.g. `Invalid .issues/config.yaml: defaultStatus "done" must be an open status`): `statuses` and `priorities` are non-empty lists of unique, valid names; unknown keys in a definition, a non-hex `color` or a non-boolean `closed` are errors; at least one status is open and one closed; `defaultStatus` is a configured open status, `defaultPriority` a configured priority; `activeStatus` / `unclaimStatus` (if set) are configured open statuses and differ; `closeStatus` / `cancelStatus` (if set) are configured closed statuses.
- **Order:** `--sort priority` follows `priorities`; `--sort status` lists open statuses furthest along the workflow first (reverse of their order in `statuses`), then closed ones in configured order — for the built-ins `in_progress, todo, backlog, done, cancelled`. Unconfigured values sort last. The web UI's column sort uses the same orders.
- **Format on disk:** gitrac never rewrites `config.yaml` just because it read it. When it writes it for another reason (registering a label, adding an assignee, a merge), each status/priority that needs nothing beyond its name (no label/color, `closed` equal to the default for that name) is written as a plain name and the rest as definitions — so a plain-list config stays byte-for-byte a plain list (and readable by older gitrac versions) until a status needs more than a name. The optional workflow keys are only written if present.
- **Web UI:** status/priority dropdowns, list filters and badges come from `GET /api/config` (`statuses` / `priorities` are returned as normalized definitions, `closed` always set); a configured `color` tints the badge, otherwise the built-in colors by name, gray for anything else.

**Write validation:** Every create/update path (CLI `create`/`edit`, `POST`/`PATCH /api/issues`) validates its input with `validateIssueFields` (`src/core/validate.ts`) before writing anything: `status` and `priority` must be in the configured lists, `title` must be a non-empty string, `labels` an array of non-empty strings, `assignee`/`description` strings. Titles and labels are trimmed and labels de-duplicated. Invalid input is rejected as a whole — the CLI prints each error and exits 2 (`invalid_input`), the API returns 400 `{ error, errors[] }` — and no file changes and no ID is allocated. Unknown labels are not an error: both the CLI and the web register them in `config.labels` with an auto-assigned color, committed alongside the issue.

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
parent: 12
blockedBy:
  - 3
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
- Frontmatter is parsed with the YAML core schema (no timestamp type), so `created`/`updated` are always strings whether or not they are quoted (`created: 2026-03-28T12:00:00Z` and `created: "2026-03-28T12:00:00Z"` are equivalent). Fields are coerced defensively: `id` to a number (numeric strings accepted), `title`/`assignee`/`createdBy`/`status`/`priority` to strings (missing -> `''`), `labels` to an array of strings (a single scalar becomes a one-element list). The optional `parent` (an issue ID) and `blockedBy` (issue IDs; a scalar becomes a one-element list, numeric strings are accepted, non-IDs are dropped, sorted and de-duplicated) are only written when set / non-empty, so files without them round-trip unchanged — see [Dependencies](#dependencies)
- Content after frontmatter, up to the separator -> description (supports full markdown including headings and horizontal rules)
- The separator is the first `---` line outside a fenced code block whose next non-blank line is a comment header. Any other `---` (or `***`, `___`) is an ordinary horizontal rule and stays in the description. Content after the separator -> comments section, which therefore always starts with a comment header.
- Each comment starts with `### {author} — {ISO8601 timestamp}` (em dash, U+2014)
- Any line starting with one or more `#` characters inside a comment body (outside code fences) is escaped with a leading backslash (`\## Heading`). Inside code fences, only lines that look like a comment header are escaped. The parser unescapes these on read; the serializer escapes them on write.
- In the description, a comment-header-like line that directly follows a `---` line (outside code fences) is escaped with a leading backslash so it cannot be mistaken for the separator. All other description content is written verbatim.
- Escaping is reversible: a line that already starts with backslashes gets one more, and the parser removes exactly one.
- Fenced code blocks may use ```` ``` ```` or `~~~` (3+ characters, optionally indented); a fence closes only with the same character at least as long as the opener. If a description ends inside an unclosed fence and the issue has comments, the serializer closes the fence so it cannot swallow the comments.
- Cross-references use `#N` syntax (e.g., `#45`)

### Dependencies

Two optional relations, stored only in the dependent issue's frontmatter (one edit to one file per link; the inverses are derived by scanning, so they can't go out of sync):

- `blockedBy: [ids]` — this issue can't start until those are closed. The inverse, "blocks", is derived.
- `parent: id` — this issue is a sub-issue of that one (inverse: sub-issues). Informational only: it doesn't affect readiness.

**Resolved blockers.** A blocker is resolved when it is in any closed status — e.g. `done` **or** `cancelled` — or no longer exists (deleted). A cancelled blocker will never be done, so treating it as blocking would strand its dependents forever; re-plan them instead (e.g. `unlink`, or cancel them too).

**Validation** (`validateLinks`, `src/core/dependencies.ts`, run by `linkIssue` under the repo lock against every open and closed issue): an issue can't be blocked by itself or be its own parent, every target must exist, a new `blockedBy` edge must not close a cycle (directly or transitively), and a new parent must not make the issue its own ancestor. Violations are `invalid_input` (exit 2 / HTTP 400 `{ error, errors }`) and nothing is written. Unlinking needs no validation (links to deleted issues can be removed). Links that two branches add independently can still form a cycle after a merge; such issues are simply never ready until one link is removed.

**Ready.** An issue is *ready* for a user when it is available to them (`isAvailableTo`, `src/core/ready.ts`: open, and unassigned or assigned to them — issues assigned to someone else are skipped in any status; judged by the issue's effective state across worktrees and branches, see [Claims on other branches and worktrees](#claims-on-other-branches-and-worktrees)) and none of its blockers is open. `gitrac ready` lists them (default sort: priority, then ID); `gitrac next` picks the first one that isn't already in the active status (`in_progress` by default; so several agents sharing one git identity each get a different issue) and `next --claim` claims it with the normal claim rules, choosing and claiming under one hold of the repo lock so concurrent `next --claim`s never get the same issue.

### Issue ID Scheme

Sequential integers, allocated without touching `config.yaml` so parallel branches and worktrees don't conflict on a shared counter. Under the repo lock (see [Concurrency](#concurrency)), `allocateIssueId` (`src/git/ids.ts`) hands out one past the highest of:

1. the **high-water mark** in `$(git rev-parse --git-common-dir)/gitrac/next-id` (holds the next free ID; shared by all worktrees of the repository, never committed). It means an ID is never reused locally, even if its issue file was deleted or lives only in another worktree's uncommitted changes;
2. the issue files in the working tree (`.issues/` and `.issues/closed/`);
3. the issue files on **every ref** — local branches, remote-tracking branches, tags and `HEAD` — so an issue created on a branch that isn't checked out (or one fetched from a remote) is respected. This costs three git processes regardless of the number of refs (`for-each-ref`, then `cat-file --batch-check` / `--batch` on the deduplicated `.issues` trees);
4. the legacy `nextId` in `config.yaml`, if present.

The high-water mark is then bumped. Creating an issue therefore only writes (and commits) the issue file, plus `config.yaml` when it registers new labels. A legacy `nextId` is left in place rather than stripped — it is harmless once frozen (no one bumps it, so it can't conflict) and removing it could lower the floor for clones that still rely on it; delete it by hand if you like. Outside a git repo only sources 2 and 4 apply.

**Limitation:** work in another clone that hasn't been fetched yet can still get the same ID (e.g. two machines both create #12 before either pushes). Fetch before creating to minimize this. Such a collision is not a merge conflict (the files have different names, e.g. `12-a.md` and `12-b.md`), so the merge driver doesn't see it; it surfaces on the next read as `duplicate_issue` (see [File Lookup](#file-lookup)) and must be fixed by hand: give one of the copies a new ID (rename the file and change its `id:`) and update references to it.

### File Lookup

Issues are looked up by ID prefix match on the filename (`{id}-*.md`). Renaming a title changes the slug portion of the filename but the ID prefix remains the canonical identifier. Lookup searches both `.issues/` and `.issues/closed/`.

Every write of an existing issue (edit, comment, comment edit/delete, close, reopen, claim, unclaim, link, unlink) writes it under the filename its current title gives, in the directory its state requires; if that differs from the file it was read from (title edited by hand, older slug rules, moved between `.issues/` and `.issues/closed/`), the old file is renamed onto the new path and both paths are committed, so an issue is always exactly one file. A new issue is likewise written in the directory its status requires (`.issues/closed/` for a closed status); `.issues/closed/` is created on demand, since git doesn't keep the empty directory in a clone.

If more than one file has the same ID (across both directories), lookup fails with `duplicate_issue` (exit **3**; HTTP **409** `{ error, code: "duplicate_issue", files }`) listing the repo-relative paths, rather than picking one. Nothing is written; merge the copies by hand and delete all but one.

---

## Architecture

Layered library architecture:

```
src/
  core/          # Pure data layer — parse/serialize issues, validate, transform
  fs/            # Filesystem CRUD for issue files and config
  git/           # Git operations — commit, amend, push, pull, conflict resolution
  service/       # Mutations shared by CLI + web — lock, validate, write, commit
  cli/           # CLI commands — thin adapters over the service layer
  web/
    server/      # Bun HTTP server (Hono) + REST API
    ui/          # React SPA (Vite + Tailwind + Tiptap)
```

**Core layer** — pure functions, no I/O. Parses frontmatter (gray-matter), validates issue structure, serializes back to markdown. Handles comment escaping/unescaping. Testable without git.

**Git layer** — all git operations. Commit, amend-until-pushed, push, pull, rebase, conflict resolution for issue files. Tracks "amendable" commit state. Uses simple-git or shells out to git.

**Service layer** — one function per mutation (`createIssue`, `updateIssue`, `addComment`, `editComment`, `deleteComment`, `closeIssue`, `reopenIssue`, `deleteIssue`, `claimIssue`, `unclaimIssue`, `initProject`, `updateLabelColors`, `updateAssignees`, `installMergeDriver`). Each takes an explicit context — project root, identity, a config loader, commit options (`noCommit`, `push`) and a commit strategy (the CLI makes plain commits; the web plugs in the amend-until-pushed `AmendTracker`) — and returns the resulting issue/config plus the changed paths. It owns the repo lock, input validation, the close/reopen and claim rules, label registration, moving files between `.issues/` and `.issues/closed/`, the commit file set (incl. referenced assets) and commit messages. Errors are `GitracError`s with surface-neutral messages (no CLI flags; the CLI appends hints such as `Use --force to take it over.` by error code). Input is validated before the issue is loaded, so a bad field/status/comment body is `invalid_input` (400) even when the issue is also missing or in the wrong state. The CLI and web share one behavior; the only differences are context options (identity, commit strategy, `--no-commit`/`--push`).

**CLI layer** — thin command adapters using Commander.js. Reads args/flags/stdin, calls the service, formats output; errors become exit codes.

**Web layer** — Hono server serves REST API + pre-built React SPA. Routes parse the request, call the service, and map errors to HTTP statuses. File watcher detects external changes and pushes events to the UI via SSE (Server-Sent Events).

---

## CLI Interface

### Commands

| Command | Aliases | Description |
|---------|---------|------------|
| `gitrac` | | Start web UI (default; alias for `gitrac serve`). Accepts `--port <port>` and `--host <host>`. |
| `gitrac serve` | | Start web UI. `-p, --port <port>` (default: 3000), `--host <host>` (default: `127.0.0.1`). |
| `gitrac init` | | Initialize `.issues/` in current repo and install the merge driver (see [Conflict Resolution](#conflict-resolution)). Errors if already exists (use `--force` to reinitialize). Errors if not in a git repo. |
| `gitrac create` | `new`, `add` | Create a new issue (interactive or via flags); one created with a closed status (`-s done`, or `POST /api/issues`) is written straight into `.issues/closed/` |
| `gitrac list` | `ls` | List issues with filters (`--status`, `--priority`, `--label`, `--assignee`, `--mine`, `--search`, `--sort`; see [List Filters](#list-filters)). Default: open issues, sorted by ID ascending. |
| `gitrac show <id>` | `view` | Show full issue detail |
| `gitrac edit <id>` | | Edit issue fields (title, status, priority, assignee, labels, description). See [Text Input](#text-input). |
| `gitrac comment <id> [body]` | `c` | Add a comment. Body from the argument, `-F, --body-file <path\|->`, or piped stdin. |
| `gitrac close <id>` | | Close issue (moves to `.issues/closed/`) with the configured `closeStatus` (default `done`); `--cancelled` uses `cancelStatus` (default `cancelled`; exit **2** if none is configured), `-s, --status <status>` any configured closed status. Fails with exit **3** (`invalid_state`, nothing written) if the issue is already closed. |
| `gitrac reopen <id>` | | Reopen issue (moves back to `.issues/`) with status `defaultStatus` from the config, or `-s, --status <status>` (any configured non-closed status). Fails with exit **3** (`invalid_state`) if the issue is already open. |
| `gitrac claim <id>` | | Assign to self + set status to the configured `activeStatus` (default `in_progress`). Exclusive: see [Claiming](#claiming). |
| `gitrac delete <id>` | `rm` | Delete an issue (open or closed): removes its file plus any `.issues/assets/` files no other issue or draft references, and commits the removal (`issue: delete #N <title>`). See [Deleting](#deleting). |
| `gitrac unclaim <id>` | `release` | Give an issue back: clear `assignee`, and set the active status (`in_progress`) back to `unclaimStatus` (`todo`). See [Claiming](#claiming). |
| `gitrac link <id>` | | Add dependencies: `-b, --blocked-by <ids>` (comma-separated, repeatable) adds blockers, `--parent <id>` sets the parent. Exit 2 (nothing written) for a missing target, a self-link or a cycle; re-adding existing links is a no-op (exit 0, no commit). Commit: `issue: link #N <title>`. See [Dependencies](#dependencies). |
| `gitrac unlink <id>` | | Remove dependencies: `-b, --blocked-by <ids>`, `--parent` (clears it). Removing links that aren't there is a no-op. |
| `gitrac ready` | | List ready issues (see [Dependencies](#dependencies)): open, unassigned or yours, no open blockers; sorted by priority, then ID. Filters `--status` (open statuses; default all of them), `--priority`, `--label`, `--mine`, `--search`, `--sort` as in [List Filters](#list-filters). |
| `gitrac next` | | Show the top ready issue that isn't already in the active status (`in_progress`); `--claim` claims it atomically (`-c` adds a comment). Same filters as `ready`. Exit **5** (`no_ready_issues`) if there is none. |
| `gitrac install-merge-driver` | | Install the git merge driver: write `.issues/.gitattributes` (committed if changed) and `merge.gitrac.*` in the local git config. `--command <cmd>` sets what git runs. Idempotent; run once per clone. See [Conflict Resolution](#conflict-resolution). |
| `gitrac merge-driver <base> <ours> <theirs> [path]` | | The merge driver itself (run by git as `%O %A %B %P`, `--marker-size %L`). Writes the result to `<ours>`; exits 0 if clean, 1 if conflicts remain. |

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

Global flags may appear before or after the subcommand (`gitrac --no-commit close 1` and `gitrac close 1 --no-commit` are equivalent). `--no-commit` applies to every mutating command (`init`, `create`, `edit`, `comment`, `close`, `reopen`, `claim`, `unclaim`, `next --claim`, `link`, `unlink`, `delete`) and also suppresses push. If both `--push` and `--no-push` are given, the last one wins.

Because global flags are matched anywhere on the command line, they must not define short flags that subcommands also use. In particular `-p` belongs to the subcommands (`create -p high`, `edit -p high`, `serve -p 4000`); the global port option is long-only (`--port`).

### Claiming

The claimer's identity is their git `user.email` (falling back to `user.name`), or the `--author` name if given; an `assignee` matches the user if it equals (case-insensitively) either their email or name. The check and the write happen under the repo mutation lock, so of several concurrent claims exactly one wins.

In this section `in_progress` stands for the configured `activeStatus` and `todo` for `unclaimStatus` (see [Statuses and Priorities](#statuses-and-priorities)); "closed" means any closed status.

| Situation | `claim` | `claim --force` |
|-----------|---------|-----------------|
| Open, unassigned (or assigned but not `in_progress`) | Claims | Claims |
| `in_progress`, assigned to someone else | Fails, exit **3**, no change | Takes over |
| `in_progress`, assigned to you | No-op (exit 0, no commit; `-c` comment is not added) | No-op |
| Closed (a closed status, e.g. `done`/`cancelled`) | Fails, exit **4**, no change | Reopens and claims |

`unclaim <id>` (alias `release`) clears `assignee` and moves `in_progress` back to `todo` (other statuses are kept). It fails with exit **3** if the issue is assigned to someone else (`--force` overrides), exits **4** for closed issues, and is a no-op if the issue is unassigned. Accepts `-c, --comment`.

Exit codes: `3` claimed by someone else, `4` issue is closed (see [Errors and Exit Codes](#errors-and-exit-codes)).

#### Claims on other branches and worktrees

Each worktree has its own checkout of `.issues/`, so a claim made in one worktree — or committed on a branch that isn't merged yet — isn't in the others' files. `claim`, `ready`, `next`, `ls` and `show` therefore judge an issue by its **effective state**: the version with the latest `updated` among this working tree's file and the issue's file (by ID, in `.issues/` or `.issues/closed/`) in

- every other worktree's working tree (from `git worktree list --porcelain`; uncommitted `--no-commit` claims included), and
- every local and remote-tracking branch (`refs/heads/*`, `refs/remotes/*`) other than the one checked out here.

Ties go to this working tree, then other worktrees, then local branches, then remote-tracking ones. `issueStatesElsewhere` (`src/git/elsewhere.ts`) gathers the versions with a constant number of git processes (`for-each-ref`, `worktree list`, one `cat-file --batch-check`, two `cat-file --batch`; branch blobs identical to this worktree's `HEAD` are skipped) plus plain reads of the other worktrees' files. The rules are pure functions in `src/core/elsewhere.ts`, used by `decideClaim` (`src/core/claim.ts`) and `isAvailableTo` / `nextIssue` (`src/core/ready.ts`):

- `claim` fails with `already_claimed` (exit **3**) if the effective state is `in_progress` and assigned to someone else; when that version is elsewhere, the message says where (`… claimed by bob (in_progress) in worktree /path (branch agent-1)` / `on branch origin/agent-1`) and the JSON error has `claimedElsewhere: { ref, worktree?, assignee, updated }`. `--force` takes it over (the new local claim is then the newest version). Your own claim elsewhere doesn't block you. A local closed issue is still `issue_closed` (exit 4). The scan runs under the repo lock, which all worktrees share, so a claim in another worktree can't slip in between the check and the write.
- `ready` skips issues whose effective state is closed or assigned to someone else (e.g. claimed in another worktree, or closed on a branch that isn't merged yet); `next` also skips those whose effective state is `in_progress`, even yours — so agents sharing one identity in different worktrees get different issues. Blockers are judged by their local state.
- `ls`, `show` and `ready` mark issues whose effective state is a claim elsewhere: human output appends `[claimed on branch X by Y]` (list) or an `Elsewhere:` line (detail); `-o json`/`yaml` add a `claimedElsewhere` field (`ref`: short branch name, or `HEAD` for a detached worktree; `worktree`: set when found in another worktree's working tree). The web API doesn't include it.

A later unclaim or close anywhere (with a newer `updated`) supersedes a claim automatically, as does any newer edit of the issue — the newest version wins whatever it says. A claim left on an abandoned branch stays visible until the branch is deleted (`git branch -D`, or `git fetch --prune` / `git push --delete` for remote ones) or someone claims with `--force`. Work in other clones is seen only once fetched.

### Deleting

`gitrac delete <id>` first works out what it would remove: the issue file, plus each asset the issue references that exists in `.issues/assets/` and whose filename appears in no other issue file (open or closed) or web UI draft. Matching is loose on purpose — any mention keeps the asset — and only plain filenames are considered (a ref with `/` or `..` never deletes anything outside `.issues/assets/`). Assets referenced only from other branches can't be seen and may be removed; they remain in git history.

- `--yes` / `-y`: delete without asking. `--dry-run`: print the plan and exit 0.
- Otherwise, on a terminal it prints the plan and asks `Delete issue #N? [y/N]`; anything but `y`/`yes` aborts with `confirmation_required` (exit **2**). When stdin is not a terminal (agents, scripts) it prints the plan to stdout and fails with `confirmation_required` (exit **2**) without asking — re-run with `--yes`.
- The prompt runs outside the repo lock; if the issue changed while it was open, the delete fails with `invalid_state` (exit **3**) and nothing is removed.
- Output (stdout): human `Deleted #N: <title>` (or `Would delete …`) followed by the paths; `-o json`/`yaml` `{ deleted, issue, paths, assets }`, where `paths` is the issue file followed by the removed assets.
- The ID is not reused: new IDs come from the shared high-water mark, which already counted it.

### Errors and Exit Codes

Commands never call `process.exit` on failure: they throw a `GitracError` (`src/core/errors.ts`) carrying a machine-readable `code`, and a single top-level handler (`runCli` in `src/cli/index.ts`, using `src/cli/errors.ts`) prints it and exits with that code's exit status. Errors from simple-git become `git_error`; Commander usage errors (unknown option, missing argument, bad `-o` value) become `usage`; anything else becomes `error` with the original message.

Errors always go to **stderr**; stdout carries only the command's result (so with `-o json`, stdout is either the result or empty). Warnings (e.g. the non-default-branch warning) also go to stderr, before the error.

- **human:** `Error: <message>` (one line per message when several fields are invalid).
- **`-o json`:** one line, the last line of stderr: `{"error":{"code":"not_found","message":"Issue #9 not found","id":9}}`. `code` and `message` are always present; some errors add fields (`id`, `assignee`, `status`, `errors` for multiple validation messages, `files` for duplicate issue files, `lockPath`, `reason` for usage errors).
- **`-o yaml`:** the same object as YAML.
- Stack traces are printed only with `--debug` (before the error line).

| Exit | `code` | Meaning |
|------|--------|---------|
| 0 | — | Success (including no-op claims) |
| 1 | `error`, `invalid_config`, `invalid_issue`, `server_error` | Unexpected error, unparseable `.issues/config.yaml`, malformed issue file (no frontmatter, bad YAML, an `id` that doesn't match the file name; `file` names it — nothing is written), web server failed to start |
| 2 | `invalid_input`, `usage`, `confirmation_required` | Bad issue ID, field value, text input, flag, or missing argument; or `delete` without confirmation (no `--yes` and no terminal, or the prompt was declined); nothing written |
| 3 | `already_claimed`, `already_initialized`, `invalid_state`, `duplicate_issue` | Conflicts with current state: claimed by someone else (`claim`/`unclaim`), `init` on an initialized repo, `close` of a closed issue, `reopen` of an open issue, several files for one issue ID (`files` lists them) |
| 4 | `issue_closed` | `claim`/`unclaim` on a closed issue |
| 5 | `not_found`, `no_ready_issues` | The issue doesn't exist; `next` found no ready issue |
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
gitrac ls --status todo,in_progress --label bug,auth
gitrac ls --assignee "Justin Murray"  # name or email, case-insensitive
gitrac ls --mine                 # assigned to you (git user.email/user.name, or --author)
gitrac ls --search "login timeout"
gitrac ls --sort priority
```

Filtering, search and sorting are one pure function (`src/core/query.ts`, loaded via `listIssues` in `src/service/list.ts`) shared by `gitrac ls` and `GET /api/issues`, so both return exactly the same issues in the same order:

- `--status`, `--priority`, `--label`, `--assignee` take comma-separated values (and may be repeated). An issue matches a filter if it matches **any** of its values; it must match **every** filter given.
- Without `--status`, only open (non-closed-status) issues are listed; `all` (alone or in a list) lists everything. `.issues/closed/` is only read when a closed status or `all` is asked for.
- `--assignee` compares case-insensitively with the stored value, and a name or email listed in `config.assignees` also matches its counterpart (`--assignee "Justin Murray"` finds `assignee: justin@…`). `--mine` does the same for the current user's name and email.
- `--search <text>`: every whitespace-separated word must occur (case-insensitively) in the title or description.
- `--sort`: `id` (default, ascending), `priority` (configured order, most urgent first), `status` (open statuses furthest along first, then closed; built-in: in_progress, todo, backlog, done, cancelled — see [Statuses and Priorities](#statuses-and-priorities)), `created` / `updated` (newest first); ties by ID.
- Status and priority values are matched case-insensitively against the configured names.
- Unknown statuses, priorities or sort fields are rejected (exit 2 / HTTP 400). Labels and assignees are free-form — no match just means an empty list.
- The human output shows ID, title, status, priority, assignee, updated date and labels.

### Commit Messages

Auto-generated with the configured prefix, identical for the CLI and the web UI:

```
issue: create #3 Fix login timeout
issue: edit #3 Fix login timeout
issue: comment on #3 Fix login timeout
issue: edit comment on #3 Fix login timeout
issue: delete comment on #3 Fix login timeout
issue: close #3 Fix login timeout
issue: reopen #3 Fix login timeout
issue: claim #3 Fix login timeout
issue: unclaim #3 Fix login timeout
issue: delete #3 Fix login timeout
```

**Committed files.** A commit contains the issue file (plus the old path when it was moved or renamed), `config.yaml` only when it actually changed (new labels registered, a new assignee added by `claim`), and the `.issues/assets/` files the issue references in its description or comments (plain filenames only; missing files are skipped) — on every surface, so an issue never points at an uncommitted image. Deleting a comment commits the assets the issue still references and never removes any (another issue may share them); only `delete` removes assets (see [Deleting](#deleting)).

Comment bodies are trimmed everywhere (`comment`, `-c/--comment` on `edit`/`close`/`reopen`/`claim`/`unclaim`, the web UI); a blank `-c` adds no comment.

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

**Web edits vs. external changes (optimistic concurrency).** The lock serializes writes but doesn't stop a client from writing back content it loaded before someone else's change. So single-issue API responses (`GET /api/issues/:id` and every mutation that returns an issue) carry an `ETag`: a quoted SHA-1 of the issue file's raw bytes, so any change — web, CLI, agent, `git pull`, hand edit — yields a new version. Mutations on an existing issue (`PATCH /api/issues/:id`, `DELETE /api/issues/:id`, comment add/edit/delete, close, reopen) accept `If-Match: <etag>` (or `*`); it is checked under the lock and a mismatch returns **409** `{ error, current }` with the current issue and its `ETag`, writing nothing. Without `If-Match` the request is last-writer-wins, as before (curl, scripts, metadata dropdowns that only send the changed field). Mutation responses return the issue as re-read from disk, so their body and `ETag` match a subsequent GET.

The description editor sends the version its content is based on with every autosave, one save at a time. When a newer version arrives (SSE refetch or a 409's `current`): if the description is unchanged (only comments/metadata changed) it just adopts the new version (and retries a 409'd save); if the description changed and the editor has no unsaved edits, the new text is loaded into the editor; if it has unsaved edits, autosave pauses and a notice offers "Discard mine, load theirs" or "Keep mine, overwrite theirs". Comment edit/delete send the version too, since comments are addressed by index. The title input is an explicit edit of one field and stays last-writer-wins.

Implementation: `withLock` (`src/fs/lock.ts`, generic) and `withRepoLock` (`src/git/lock.ts`, resolves the lock path). Every service operation (`src/service/`) runs inside `withRepoLock`, so CLI commands and web routes get the lock by calling it; mutating web routes additionally use the `mutationLock` middleware (`src/web/lock.ts`) to hold the lock for the whole request (and answer 503 on timeout). The `If-Match` check is a precondition the service runs on the issue it loads under the lock.

### Push/Pull

- `--push` flag forces push, `--no-push` flag forces no push, absence of either defers to `config.git.autoPush`
- The web UI follows `config.git.autoPush` too, pushing after each commit or amend (within the request, under the lock). A pushed commit is no longer amendable, so with `autoPush` every web edit is its own commit — pushed history is never rewritten. A failed web push is logged to the server's stderr and doesn't fail the request (the change is already written and committed); the CLI reports it as `git_error` (exit 7)
- Before commit: if remote has changes, attempt `git pull --rebase` first
- Issue file conflict auto-resolution (see below)

### Conflict Resolution

Issue files have predictable structure, enabling smarter-than-default merge. gitrac ships a [custom git merge driver](https://git-scm.com/docs/gitattributes#_defining_a_custom_merge_driver), so this applies to every `git merge`, `git pull` (merge or rebase), `git rebase`, `cherry-pick`, etc.

**Setup.** `gitrac init` and `gitrac install-merge-driver` write `.issues/.gitattributes` (`*.md merge=gitrac`, `config.yaml merge=gitrac`; patterns relative to `.issues/`, so `closed/` is included) and commit it, and set `merge.gitrac.name` / `merge.gitrac.driver` (`<cmd> merge-driver --marker-size %L %O %A %B %P`) in the repository's local git config — shared by all its worktrees, but not by other clones: git config isn't versioned, so each clone runs `gitrac install-merge-driver` once. A clone without the config falls back to git's normal text merge (an undefined driver is ignored). `<cmd>` defaults to `gitrac` when that is the binary on `PATH`, else the running binary's absolute path, `./gitrac` when running from source in the gitrac repo itself (git runs drivers at the work-tree root), or `<bun> <index.ts>`; override with `--command`, and re-run it if the binary moves.

**Issue files** (`.issues/**/*.md`, `mergeIssueFiles` in `src/git/conflict.ts`):

1. **Frontmatter:** per field. A field changed on one side takes that change; a field both sides changed differently goes to the side whose `updated` is later (ties: ours) — per-field last-writer-wins, not whole-block replacement. `labels` and `blockedBy` merge as sets (additions and removals from both sides); `parent` is an ordinary field. `updated` is the later of the two.
2. **Description:** unchanged on a side → the other side's; changed on both → line-based three-way merge (`git merge-file`). If that conflicts, the file is still written with merged frontmatter and comments, the conflict markers are left inside the description, and the driver exits 1 so git reports the conflict for manual resolution.
3. **Comments:** keyed by author + timestamp. Additions from both sides are kept; a comment deleted on one side stays deleted unless the other side edited it; an edit on one side wins (both: ours). Sorted by timestamp.

**config.yaml** (`mergeConfigFiles`): legacy `nextId` = max of both; `labels` = union (a color changed on one side wins, both: ours; a label added on their side whose color clashes with another label gets a fresh color; removals stick); `assignees` = union deduplicated by email (case-insensitive), ours' order first; `git.*` per key, and every other key three-way as a whole value, ours on conflict.

**Robustness.** If any version can't be parsed strictly (no frontmatter, invalid id or YAML, leftover conflict markers, different issue IDs, invalid config) or the merged issue wouldn't read back identically, the driver does exactly what git's default driver does — a line merge with ordinary conflict markers (`git merge-file`), exit 1 on conflict — and prints a note to stderr; it never writes a half-merged file. Files are rewritten in gitrac's canonical format (unknown frontmatter keys are dropped, as on any gitrac write).

**Renames.** A title change renames the file (`<id>-<slug>.md`), and closing/reopening moves it between `.issues/` and `.issues/closed/`. Git's rename detection pairs the old and new paths and the driver merges their contents, so a rename (or close) on one side and edits on the other merge cleanly into the renamed file. If **both** sides renamed it differently (both changed the title), git reports a rename/rename conflict and leaves both files, each with the merged content; keep the one matching the merged title (`git rm` the other, `git add` the keeper). Until then gitrac reports `duplicate_issue` for that ID. If the merged frontmatter doesn't match the directory git kept (e.g. one side closed the issue, the other later set an open status), the next gitrac write to the issue moves it to the right place.

**Duplicate IDs** from separate clones (`12-a.md` vs `12-b.md`) aren't a content conflict and are not handled by the driver; see [Issue ID Scheme](#issue-id-scheme).

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
| GET | `/api/issues` | List issues. Query params `status`, `priority`, `label`, `assignee` (comma-separated or repeated), `search`, `mine` (= the server's identity), `sort` — same semantics as `gitrac ls` (see [List Filters](#list-filters)) |
| GET | `/api/issues/:id` | Get single issue. **409** `{ error, code: "duplicate_issue", files }` if several files have the ID, **409** `{ error, code: "invalid_issue", file }` if its file is malformed (both also for every mutation of that issue) |
| POST | `/api/issues` | Create issue (optional `author` sets `createdBy`) |
| PATCH | `/api/issues/:id` | Update issue metadata |
| DELETE | `/api/issues/:id` | Delete issue + assets only it references (see [Deleting](#deleting)); always a new commit, never amended into the create. **200** `{ deleted: true, issue, paths, assets }` (the issue as it was). Honors `If-Match` |
| POST | `/api/issues/:id/comments` | Add comment (`body`; optional `author`) |
| PUT | `/api/issues/:id/comments/:index` | Edit comment |
| DELETE | `/api/issues/:id/comments/:index` | Delete comment |
| GET | `/api/issues/:id/dependencies` | `{ parent, children, blockedBy, blocks, blocked }`: the linked issues as `{ id, title, status, resolved }` (`status: null`, `resolved: true` for a missing issue); `blocks`/`children` are derived. The issue itself (`GET /api/issues/:id`) carries `parent` / `blockedBy` when set |
| POST | `/api/issues/:id/link` | `{ blockedBy?: id \| id[], parent?: id }`: add blockers / set the parent. **400** `{ error, errors }` for a missing target, a self-link or a cycle. Honors `If-Match` |
| POST | `/api/issues/:id/unlink` | `{ blockedBy?: id \| id[], parent?: true }`: remove blockers / clear the parent. Honors `If-Match` |
| PATCH | `/api/issues/:id/close` | Close issue with the configured close status (`done`); optional body `{ status }` (a configured closed status) or `{ cancelled: true }` (the cancel status), else 400. **409** `{ error, code: "invalid_state", current }` if already closed |
| PATCH | `/api/issues/:id/reopen` | Reopen issue with `defaultStatus` (optional body `{ status }`: a non-closed status, else 400). **409** `invalid_state` if already open |
| GET | `/api/config` | Get project config |
| PATCH | `/api/config/labels` | Merge label colors (`{ labels: { name: color } }`). **400** if `labels` isn't an object (including a non-JSON or `null` body) |
| PATCH | `/api/config/assignees` | Replace the assignees (`{ assignees: [{ name, email }] }`). **400** if not an array of non-empty `name`/`email` |
| GET | `/api/identity` | Default author for web writes (`{ name, email }` from git config / `--author`) |
| GET | `/api/git/status` | Branch, push state, warnings |
| GET | `/api/events` | SSE stream for live updates: `connected` on (re)connect, `issues-changed` on file changes, `: keep-alive` comments every 5s |
| POST | `/api/issues/assets` | Upload an image (multipart `file`; no SVG; max 10 MiB) |

### React UI

**Editor:** Tiptap (`@tiptap/react`) — the same editor framework Linear uses (built on ProseMirror). WYSIWYG with no edit/view mode toggle. Auto-saves on change (debounced). Markdown serialization via `tiptap-markdown` for round-tripping to `.md` files.

**List View:** Sortable/filterable table with columns: ID, Title, Status, Priority, Assignee, Labels, Updated. Colored status/priority badges. Click row to open detail view. Inline status/assignee quick-edit.

**Detail View:** Tiptap WYSIWYG editor for description (auto-save on change; external changes are loaded into the editor or flagged as a conflict — see "Concurrency"). Inline metadata editing (dropdowns for status, priority, assignee, labels). Below the metadata, a read-only dependencies panel lists the parent, sub-issues, blockers and the issues this one blocks (linked, with status; closed/missing ones struck through; refreshed on every change); links are edited with `gitrac link` / `unlink` or the API. Comments rendered below with author/timestamp. Tiptap "add comment" editor at bottom. "Delete issue" at the bottom of the sidebar asks for confirmation, deletes with `If-Match` (a 409 shows the latest version instead), then returns to the list. All changes trigger commit (with amend-until-pushed logic).

**Visual Style:** Dark theme by default (with light theme option). Status colors: a status's configured `color`, else backlog=gray, todo=blue, in_progress=yellow, done=green, cancelled=red, gray for other statuses (priority dots likewise). Clean sans-serif typography, minimal chrome.

**Branch Warning:** Persistent yellow banner when not on default branch.

### Build

Vite builds the React SPA at publish time (`dist/ui/`). `scripts/build.ts` then generates an entry (`dist/gitrac-entry.ts`) that imports every `dist/ui` file `with { type: 'file' }` — embedding it in the executable — and registers the URL-path manifest (`registerEmbeddedUi`, `src/web/ui-assets.ts`) before running the CLI; `bun build --compile` turns that into a single self-contained binary, which serves the UI from the embedded files and needs nothing beside it on disk. Releases ship just that binary.

Where the server finds the UI (`resolveUiAssets`):

1. **Compiled binary:** the embedded manifest only.
2. **From source** (`./gitrac`): gitrac's own `dist/ui/` (built by `./bun run vite build --config vite.config.ts`), resolved relative to the gitrac source tree — so it works when serving any other repo.
3. Otherwise only the API is served (startup prints a warning).

The served project's directory, the cwd and the bun executable's directory are never searched, so a repo with an unrelated `dist/ui/` can't shadow the UI. Files under `/assets/` (Vite's hashed output) are served `Cache-Control: immutable` and a missing one is a 404; any other unknown GET path falls back to `index.html` (SPA routing).

During development, the Vite dev server proxies API requests to the Bun backend for hot reloading.

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
