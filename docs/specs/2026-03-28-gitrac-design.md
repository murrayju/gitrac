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
  .gitignore                     # Ignores drafts/ (web UI new-issue drafts, local only)
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
reviewStatus: review       # optional: what review sets (still claimed); open; unset = no review step
closeStatus: done          # optional: what close sets; closed
cancelStatus: wontfix      # optional: what close --cancelled sets; closed
staleAfter: 2h             # optional: the web UI's stale-claim threshold (CLI: --stale stays explicit)
```

- **Entries** are a plain name or `{ name, label?, color?, closed? }` (priorities: no `closed`). Names are lowercase letters, digits, `_` and `-` (filters are comma-separated and case-insensitive); `all` is not a status. A plain name — or a definition without `closed` — is closed only if it is `done` or `cancelled`, so the old plain-list format (`statuses: [backlog, todo, in_progress, done, cancelled]`) still works unchanged and is read as before; an unknown legacy name is open. A status an issue has but the config doesn't list is judged by the same rule.
- **Workflow statuses:** when a key is unset, the built-in name is used if it is a configured status of the right kind, else a fallback: `activeStatus` → `in_progress`, else the last open status; `unclaimStatus` → `todo` (unless it's the active status), else `defaultStatus`; `closeStatus` → `done`, else the first closed status; `cancelStatus` → `cancelled`, else none (`close --cancelled` then fails with `invalid_input`, exit 2 / HTTP 400, naming the closed statuses); `reviewStatus` has no fallback: unset (the default, also in new configs), there is no review step and `review` fails with `invalid_input` (exit 2) naming the key. The **held** statuses (`heldStatuses`, `src/core/workflow.ts`) are the active status plus `reviewStatus` if set: an assigned issue in a held status is claimed (see [Claiming](#claiming)).
- **Validation** (on every read; an inconsistent config is `invalid_config`, exit 1, with every problem listed, e.g. `Invalid .issues/config.yaml: defaultStatus "done" must be an open status`): `statuses` and `priorities` are non-empty lists of unique, valid names; unknown keys in a definition, a non-hex `color` or a non-boolean `closed` are errors; at least one status is open and one closed; `defaultStatus` is a configured open status, `defaultPriority` a configured priority; `activeStatus` / `unclaimStatus` (if set) are configured open statuses and differ; `reviewStatus` (if set) is a configured open status that differs from the (resolved) active and unclaim statuses; `closeStatus` / `cancelStatus` (if set) are configured closed statuses; `staleAfter` (if set) is a duration (`30s`, `45m`, `2h`, `1d`; see [Stale claims](#stale-claims)).
- **Order:** `--sort priority` follows `priorities`; `--sort status` lists open statuses furthest along the workflow first (reverse of their order in `statuses`), then closed ones in configured order — for the built-ins `in_progress, todo, backlog, done, cancelled`. Unconfigured values sort last. The web UI's column sort uses the same orders.
- **Format on disk:** gitrac never rewrites `config.yaml` just because it read it. When it writes it for another reason (registering a label, adding an assignee, a merge), each status/priority that needs nothing beyond its name (no label/color, `closed` equal to the default for that name) is written as a plain name and the rest as definitions — so a plain-list config stays byte-for-byte a plain list (and readable by older gitrac versions) until a status needs more than a name. The optional workflow keys are only written if present.
- **Web UI:** status/priority dropdowns, list filters and badges come from `GET /api/config` (`statuses` / `priorities` are returned as normalized definitions, `closed` always set); a configured `color` tints the badge, otherwise the built-in colors by name, gray for anything else.

**Write validation:** Every create/update path (CLI `create`/`edit`, `POST`/`PATCH /api/issues`) validates its input with `validateIssueFields` (`src/core/validate.ts`) before writing anything: `status` and `priority` must be in the configured lists, `title` must be a non-empty string, `labels` an array of non-empty strings, `assignee`/`description` strings. Titles and labels are trimmed and labels de-duplicated. After trimming, a `title`, `assignee` or label must not contain a line break (`\r` or `\n`): it would break the `gitrac ls` table and the commit subject. Invalid input is rejected as a whole — the CLI prints each error and exits 2 (`invalid_input`), the API returns 400 `{ error, errors[] }` — and no file changes and no ID is allocated. Unknown labels are not an error: both the CLI and the web register them in `config.labels` with an auto-assigned color, committed alongside the issue.

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
- Unknown frontmatter keys (e.g. `estimate:`, `externalId:`, `sprint:` added by hand or another tool) are preserved: parsed (core schema) into the issue's `extra` object — keyed separately so they can't collide with known fields, absent when there are none; exposed as `extra` in `-o json`/`-o yaml` and the API — and written back after the known keys, in their original order. An unchanged key is written as its exact source text (quoting, flow style, trailing comments and the comment lines just above it); only when the frontmatter can't be split into independent per-key blocks (e.g. an anchor/alias shared across keys) are the values re-dumped. They survive every gitrac write (CLI, web, merge driver) but aren't editable through the CLI/UI: an `extra` field in input is ignored
- Content after frontmatter, up to the separator -> description (supports full markdown including headings and horizontal rules)
- The separator is the first `---` line outside a fenced code block whose next non-blank line is a comment header. Any other `---` (or `***`, `___`) is an ordinary horizontal rule and stays in the description. Content after the separator -> comments section, which therefore always starts with a comment header.
- Each comment starts with `### {author} — {ISO8601 timestamp}` (em dash, U+2014)
- An author is checked before anything is written (`authorError`, `src/core/validate.ts`): it must be a non-empty string with no line break and no em dash (U+2014), so its header is one line that parses back to the same author and timestamp. This applies to an explicit author (`--author`, `author` in `POST /api/issues` and `POST /api/issues/:id/comments`) and to the identity's name (git `user.name`) when it writes a comment (`comment`, `-c/--comment` on `edit`/`close`/`reopen`/`claim`/`unclaim`/`next --claim`, the `renumber` comment) or `createdBy`. A bad author is `invalid_input` (exit 2, HTTP 400). A claim also rejects an identity whose name or email has a line break, because it becomes the assignee. `gitrac serve --author <name>` (and bare `gitrac --author <name>`) checks the name at startup and exits 2 before it binds, so a bad name does not fail on every web write. Each `config.assignees` entry set through `PATCH /api/config/assignees` must have a `name` and `email` with no line break and no em dash (`assigneeErrors`), because the name can become an author (the "Acting as" picker) and the email an assignee; a claim does not add an identity that fails this check to `config.assignees`. Existing files are parsed as before.
- Any line starting with one or more `#` characters inside a comment body (outside code fences) is escaped with a leading backslash (`\## Heading`). Inside code fences, only lines that look like a comment header are escaped. The parser unescapes these on read; the serializer escapes them on write.
- In the description, a comment-header-like line that directly follows a `---` line (outside code fences) is escaped with a leading backslash so it cannot be mistaken for the separator. All other description content is written verbatim.
- Escaping is reversible: a line that already starts with backslashes gets one more, and the parser removes exactly one.
- Fenced code blocks may use ```` ``` ```` or `~~~` (3+ characters, optionally indented); a fence closes only with the same character at least as long as the opener. If a description ends inside an unclosed fence and the issue has comments, the serializer closes the fence so it cannot swallow the comments.
- Cross-references use `#N` syntax (e.g., `#45`). The web UI renders them as links to the issue (see "React UI"); the stored markdown is never rewritten

### Dependencies

Two optional relations, stored only in the dependent issue's frontmatter (one edit to one file per link; the inverses are derived by scanning, so they can't go out of sync):

- `blockedBy: [ids]` — this issue can't start until those are closed. The inverse, "blocks", is derived.
- `parent: id` — this issue is a sub-issue of that one (inverse: sub-issues). Informational only: it doesn't affect readiness.

**Resolved blockers.** A blocker is resolved when it is in any closed status — e.g. `done` **or** `cancelled` — or no longer exists (deleted; `delete` also removes the links to it from other issues in this worktree, but copies on other branches may keep them). A cancelled blocker will never be done, so treating it as blocking would strand its dependents forever; re-plan them instead (e.g. `unlink`, or cancel them too). A blocker that has no file in this working tree but exists in another worktree or on another branch (see "Issues only elsewhere" under [Claims on other branches and worktrees](#claims-on-other-branches-and-worktrees)) is **not** resolved, in any status there, even a closed one: its work is not here yet, so its dependents wait until it is merged (or the link is removed). This matches the rule that blockers are judged by their local state. Only a blocker that exists nowhere counts as resolved.

**Validation** (`validateLinks`, `src/core/dependencies.ts`, run by `linkIssue` under the repo lock against every open and closed issue): an issue can't be blocked by itself or be its own parent, every target must exist, a new `blockedBy` edge must not close a cycle (directly or transitively), and a new parent must not make the issue its own ancestor. Violations are `invalid_input` (exit 2 / HTTP 400 `{ error, errors }`) and nothing is written. Unlinking needs no validation (links to deleted issues can be removed). Links that two branches add independently can still form a cycle after a merge; such issues are simply never ready until one link is removed.

**Showing.** `gitrac show <id>` resolves the links against every open and closed issue in this working tree (`describeDependencies`, `src/core/dependencies.ts`): human output lists the parent, sub-issues, blockers and the issues it blocks; `-o json`/`yaml` add `dependencies: { parent, children, blockedBy, blocks, blocked }`. Each linked issue is `{ id, title, status, resolved }` (`status: null`, `resolved: true` for a missing issue), `children` and `blocks` are derived, and `blocked` is true while any blocker is open. Links are also resolved against the issues that exist only in another worktree or on another branch (from the same `withIssues` scan that `show` uses for marks; `dependenciesWithElsewhere`, `src/service/list.ts`): such a linked issue has the title and status of its newest version there, `resolved: false` and `foundElsewhere: { ref, worktree? }`, and human output appends its location (`#3 Sub task (todo, only in worktree /path (branch agent-1))`). Sub-issues and "blocks" include the issues only elsewhere that link to this one (e.g. a sub-issue an agent filed in its worktree). `GET /api/issues/:id/dependencies` returns the same, from the server's cached scan; the web dependencies panel shows an "only in ..." badge and links to the issue's read-only view. `ls`, `ready`, `next` and mutation output carry only the issue's own `parent` / `blockedBy`.

**Ready.** An issue is *ready* for a user when it is available to them (`isAvailableTo`, `src/core/ready.ts`: open, and unassigned or assigned to them — issues assigned to someone else are skipped in any status; judged by the issue's effective state across worktrees and branches, see [Claims on other branches and worktrees](#claims-on-other-branches-and-worktrees)) and none of its blockers is open (a blocker only elsewhere is open, in any status; see "Resolved blockers"). `ready` and `next` reuse their one scan of other worktrees and branches for this. `gitrac ready` lists them (default sort: priority, then ID); `gitrac next` picks the first one that isn't already in the active status (`in_progress` by default; so several agents sharing one git identity each get a different issue) and `next --claim` claims it with the normal claim rules, choosing and claiming under one hold of the repo lock so concurrent `next --claim`s never get the same issue.

### Issue ID Scheme

Sequential integers, allocated without touching `config.yaml` so parallel branches and worktrees don't conflict on a shared counter. Under the repo lock (see [Concurrency](#concurrency)), `allocateIssueId` (`src/git/ids.ts`) hands out one past the highest of:

1. the **high-water mark** in `$(git rev-parse --git-common-dir)/gitrac/next-id` (holds the next free ID; shared by all worktrees of the repository, never committed). It means an ID is never reused locally, even if its issue file was deleted or lives only in another worktree's uncommitted changes;
2. the issue files in the working tree (`.issues/` and `.issues/closed/`);
3. the issue files on **every ref** — local branches, remote-tracking branches, tags and `HEAD` — so an issue created on a branch that isn't checked out (or one fetched from a remote) is respected. This costs three git processes regardless of the number of refs (`for-each-ref`, then `cat-file --batch-check` / `--batch` on the deduplicated `.issues` trees);
4. the legacy `nextId` in `config.yaml`, if present.

The high-water mark is then bumped. Creating an issue therefore only writes (and commits) the issue file, plus `config.yaml` when it registers new labels. A legacy `nextId` is left in place rather than stripped — it is harmless once frozen (no one bumps it, so it can't conflict) and removing it could lower the floor for clones that still rely on it; delete it by hand if you like. Outside a git repo only sources 2 and 4 apply.

**Limitation:** work in another clone that hasn't been fetched yet can still get the same ID (e.g. two machines both create #12 before either pushes). Fetch before creating to minimize this. Such a collision is not a merge conflict (the files have different names, e.g. `12-a.md` and `12-b.md`), so the merge driver doesn't see it; it surfaces on the next read as `duplicate_issue` (see [File Lookup](#file-lookup)) and is fixed with `gitrac renumber <id> --file <path>` (see [Renumbering](#renumbering)).

### File Lookup

Issues are looked up by ID prefix match on the filename (`{id}-*.md`). Renaming a title changes the slug portion of the filename but the ID prefix remains the canonical identifier. Lookup searches both `.issues/` and `.issues/closed/`.

Every write of an existing issue (edit, comment, comment edit/delete, close, reopen, claim, unclaim, link, unlink) writes it under the filename its current title gives, in the directory its state requires; if that differs from the file it was read from (title edited by hand, older slug rules, moved between `.issues/` and `.issues/closed/`), the old file is renamed onto the new path and both paths are committed, so an issue is always exactly one file. A new issue is likewise written in the directory its status requires (`.issues/closed/` for a closed status); `.issues/closed/` is created on demand, since git doesn't keep the empty directory in a clone.

If more than one file has the same ID (across both directories), lookup fails with `duplicate_issue` (exit **3**; HTTP **409** `{ error, code: "duplicate_issue", files }`) listing the repo-relative paths, rather than picking one. Nothing is written. If they are copies of one issue (e.g. a hand rename left the old file), merge them by hand and delete all but one; if they are different issues (two clones created the same ID), renumber one with `gitrac renumber` (see [Renumbering](#renumbering)) — the CLI appends `To give one of them a new ID: gitrac renumber <id> --file <path>.` to the message.

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

**Service layer** — one function per mutation (`createIssue`, `updateIssue`, `addComment`, `editComment`, `deleteComment`, `closeIssue`, `reopenIssue`, `deleteIssue`, `renumberIssue`, `claimIssue`, `unclaimIssue`, `initProject`, `updateLabelColors`, `updateAssignees`, `installMergeDriver`). Each takes an explicit context — project root, identity, a config loader, commit options (`noCommit`, `push`) and a commit strategy (the CLI makes plain commits; the web plugs in the amend-until-pushed `AmendTracker`) — and returns the resulting issue/config plus the changed paths. It owns the repo lock, input validation, the close/reopen and claim rules, label registration, moving files between `.issues/` and `.issues/closed/`, the commit file set (incl. referenced assets) and commit messages. Errors are `GitracError`s with surface-neutral messages (no CLI flags; the CLI appends hints such as `Use --force to take it over.` by error code). Input is validated before the issue is loaded, so a bad field/status/comment body is `invalid_input` (400) even when the issue is also missing or in the wrong state. The CLI and web share one behavior; the only differences are context options (identity, commit strategy, `--no-commit`/`--push`).

**CLI layer** — thin command adapters using Commander.js. Reads args/flags/stdin, calls the service, formats output; errors become exit codes.

**Web layer** — Hono server serves REST API + pre-built React SPA. Routes parse the request, call the service, and map errors to HTTP statuses. File watcher detects external changes and pushes events to the UI via SSE (Server-Sent Events).

---

## CLI Interface

### Commands

| Command | Aliases | Description |
|---------|---------|------------|
| `gitrac` | | Start web UI (default; alias for `gitrac serve`). Accepts `--port <port>` and `--host <host>`. |
| `gitrac serve` | | Start web UI. `-p, --port <port>` (default: 3000), `--host <host>` (default: `127.0.0.1`). The port must be a plain integer from 0 to 65535; anything else (`abc`, `99999`, `4000abc`) is an `invalid_input` error (exit 2) that echoes the value given, checked before anything else. |
| `gitrac init` | | Initialize `.issues/` in current repo (`config.yaml`, plus `.gitignore` ignoring web UI `drafts/`) and install the merge driver (see [Conflict Resolution](#conflict-resolution)); commits all three. Sets `git.defaultBranch` to the repo's default branch: the branch `origin/HEAD` points at, else the current (possibly unborn) branch, else git's `init.defaultBranch`, else `main`. Errors if already exists (use `--force` to reinitialize). Errors if not in a git repo. |
| `gitrac create` | `new`, `add` | Create a new issue (interactive or via flags); one created with a closed status (`-s done`, or `POST /api/issues`) is written straight into `.issues/closed/` |
| `gitrac list` | `ls` | List issues with filters (`--status`, `--priority`, `--label`, `--assignee`, `--mine`, `--search`, `--sort`; see [List Filters](#list-filters)). Default: open issues, sorted by ID ascending. `--elsewhere` also lists the issues that exist only in another worktree or on another branch, after the local ones (see [Claims on other branches and worktrees](#claims-on-other-branches-and-worktrees)). `--stale <duration>` lists only the issues whose claim is stale (see [Stale claims](#stale-claims)). |
| `gitrac show <id>` | `view` | Show full issue detail, including the parent, sub-issues, blockers and the issues it blocks (with titles and statuses). If this working tree has no file for the ID but another worktree or branch has, shows that version (read-only; see [Claims on other branches and worktrees](#claims-on-other-branches-and-worktrees)). `-o json`/`yaml`: the issue (its own `parent` / `blockedBy` IDs unchanged) plus `dependencies: { parent, children, blockedBy, blocks, blocked }`, the same shape as `GET /api/issues/:id/dependencies` (see [Dependencies](#dependencies)) |
| `gitrac edit <id>` | | Edit issue fields (title, status, priority, assignee, labels, description; `-c` adds a comment). No flags at all is exit 2. Values equal to the current ones (a description differing only in leading/trailing whitespace) are a no-op: exit 0, nothing written or committed, `updated` kept; stderr says so and stdout still shows the issue. Changing the status or assignee of an issue held by someone else fails with exit **3** unless `-f, --force` (see [Editing a claimed issue](#editing-a-claimed-issue)). See [Text Input](#text-input). |
| `gitrac comment <id> [body]` | `c` | Add a comment. Body from the argument, `-F, --body-file <path\|->`, or piped stdin. |
| `gitrac close <id>` | | Close issue (moves to `.issues/closed/`) with the configured `closeStatus` (default `done`); `--cancelled` uses `cancelStatus` (default `cancelled`; exit **2** if none is configured), `-s, --status <status>` any configured closed status. Fails with exit **3** (`invalid_state`, nothing written) if the issue is already closed, and with exit **3** (`already_claimed`) if someone else holds it, here or elsewhere, unless `-f, --force` (see [Editing a claimed issue](#editing-a-claimed-issue)). |
| `gitrac reopen <id>` | | Reopen issue (moves back to `.issues/`) with status `defaultStatus` from the config, or `-s, --status <status>` (any configured non-closed status). Fails with exit **3** (`invalid_state`) if the issue is already open, and with exit **3** (`already_claimed`) if someone else holds it in a newer version elsewhere (e.g. claimed again in a worktree), unless `-f, --force` (see [Editing a claimed issue](#editing-a-claimed-issue)). |
| `gitrac claim <id>` | | Assign to self + set status to the configured `activeStatus` (default `in_progress`). Exclusive: see [Claiming](#claiming). `--renew` on your own claim renews it (a heartbeat; see [Stale claims](#stale-claims)). |
| `gitrac delete <id>` | `rm` | Delete an issue (open or closed): removes its file plus any `.issues/assets/` files no other issue or draft references, and commits the removal (`issue: delete #N <title>`). See [Deleting](#deleting). |
| `gitrac renumber <id>` | | Give one file of a duplicated issue ID a fresh ID (`-f, --file <path>`; asked on a terminal). `--force` for a non-duplicated ID, `--update-refs` to repoint other issues' links. See [Renumbering](#renumbering). |
| `gitrac unclaim <id>` | `release` | Give an issue back: clear `assignee`, and set a held status (`in_progress`, or `reviewStatus`) back to `unclaimStatus` (`todo`). See [Claiming](#claiming). `--stale <duration>` releases someone else's claim only if it is stale (see [Stale claims](#stale-claims)). |
| `gitrac review <id>` | | Hand a claimed issue off for review: set `reviewStatus` and keep the assignee, so it stays claimed. See [Review handoff](#review-handoff). |
| `gitrac link <id>` | | Add dependencies: `-b, --blocked-by <ids>` (comma-separated, repeatable) adds blockers, `--parent <id>` sets the parent. Exit 2 (nothing written) for a missing target, a self-link or a cycle; re-adding existing links is a no-op (exit 0, no commit). Commit: `issue: link #N <title>`. See [Dependencies](#dependencies). |
| `gitrac unlink <id>` | | Remove dependencies: `-b, --blocked-by <ids>`, `--parent` (clears it). Removing links that aren't there is a no-op. |
| `gitrac ready` | | List ready issues (see [Dependencies](#dependencies)): open, unassigned or yours, no open blockers; sorted by priority, then ID. Filters `--status` (open statuses; default all of them), `--priority`, `--label`, `--mine`, `--search`, `--sort` as in [List Filters](#list-filters). `--stale <duration>` also lists stale claims (see [Stale claims](#stale-claims)). |
| `gitrac next` | | Show the top ready issue that isn't already in the active status (`in_progress`); `--claim` claims it atomically (`-c` adds a comment). Same filters as `ready`, including `--stale <duration>`, with which it can pick a stale claim and `--claim` takes it over (see [Stale claims](#stale-claims)). Exit **5** (`no_ready_issues`) if there is none. |
| `gitrac install-merge-driver` | | Install the git merge driver: write `.issues/.gitattributes` and ensure `.issues/.gitignore` ignores `drafts/` (each committed if changed, so projects initialized before `init` wrote `.gitignore` get it) and `merge.gitrac.*` in the local git config. `--command <cmd>` sets what git runs. Idempotent; run once per clone. See [Conflict Resolution](#conflict-resolution). |
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

Global flags may appear before or after the subcommand (`gitrac --no-commit close 1` and `gitrac close 1 --no-commit` are equivalent). `--no-commit` applies to every mutating command (`init`, `create`, `edit`, `comment`, `close`, `reopen`, `claim`, `unclaim`, `review`, `next --claim`, `link`, `unlink`, `delete`, `renumber`) and also suppresses push. If both `--push` and `--no-push` are given, the last one wins.

Because global flags are matched anywhere on the command line, they must not define short flags that subcommands also use. In particular `-p` belongs to the subcommands (`create -p high`, `edit -p high`, `serve -p 4000`); the global port option is long-only (`--port`).

### Claiming

The claimer's identity is their git `user.email` (falling back to `user.name`), or the `--author` name if given; an `assignee` matches the user if it equals (case-insensitively) either their email or name. The check and the write happen under the repo mutation lock, so of several concurrent claims exactly one wins.

In this section `in_progress` stands for the configured `activeStatus`, `todo` for `unclaimStatus` and `review` for `reviewStatus` (see [Statuses and Priorities](#statuses-and-priorities)); "closed" means any closed status. "Held" means `in_progress`, or `review` if a `reviewStatus` is configured: everything said here about a claim in `in_progress` applies to an assigned issue in either held status.

| Situation | `claim` | `claim --force` |
|-----------|---------|-----------------|
| Open, unassigned (or assigned but not held) | Claims | Claims |
| Held, assigned to someone else | Fails, exit **3**, no change | Takes over |
| `in_progress`, assigned to you | No-op (exit 0, no commit; `-c` comment is not added); with `--renew`, renews the claim (see [Stale claims](#stale-claims)) | No-op |
| `review`, assigned to you | Claims (back to `in_progress`, for rework) | Claims |
| Closed (a closed status, e.g. `done`/`cancelled`) | Fails, exit **4**, no change | Reopens and claims |

`unclaim <id>` (alias `release`) clears `assignee` and moves a held status (`in_progress` or `review`) back to `todo` (other statuses are kept). It fails with exit **3** if the issue is assigned to someone else (`--force` overrides), exits **4** for closed issues, and is a no-op if the issue is unassigned — all judged by the issue's effective state, so it also releases a claim held in another worktree or on another branch (see below). Accepts `-c, --comment`.

Exit codes: `3` claimed by someone else, `4` issue is closed (see [Errors and Exit Codes](#errors-and-exit-codes)).

#### Editing a claimed issue

`edit` (and `PATCH /api/issues/:id`, which the web UI's status and assignee dropdowns use) must not silently overwrite a claim (rule: `decideEdit`, `src/core/claim.ts`; service: `updateIssue`). An edit that changes the status or the assignee (after the no-op comparison: a value equal to the stored one does not count) of an issue whose effective state (here, in other worktrees, or on other branches; see below) is held and assigned to someone other than the acting user fails with `already_claimed` (exit **3**, HTTP **409**), with `assignee` and, when the claim is elsewhere, `claimedElsewhere: { ref, worktree?, assignee, updated }`, the same message and details as `claim`. Nothing is written. The CLI hint is `Use --force to change it anyway, or "gitrac claim <id> --force" to take it over.` `edit --force` (`force: true` in the PATCH body) writes the change, with `updated` strictly later than every version scanned elsewhere, so it supersedes the claim, as `claim --force` does. The claim holder can always edit, and edits of other fields (title, priority, labels, description) are always allowed. Only an edit that changes the status or the assignee scans the other worktrees and branches (under the repo lock), so ordinary edits stay cheap. The acting user is the CLI identity, or on the web the "Acting as" `author` in the PATCH body (default: the server's identity).

`close` and `reopen` (and `PATCH /api/issues/:id/close` / `reopen`; services `closeIssue` / `reopenIssue`) follow the same rule, as a status change (`decideEdit` with "changes the claim" set): if the issue's effective state is held and assigned to someone other than the acting user, they fail with `already_claimed` (exit **3**, HTTP **409**), with the same message and `assignee` / `claimedElsewhere` details, and write nothing. This keeps a close on `main` from silently superseding a newer claim in an agent's worktree, which the agent's later merge would then fight. The CLI hints are `Use --force to close it anyway.` / `Use --force to reopen it anyway.`; `close --force` / `reopen --force` (`force: true` in the body) write it with `updated` strictly later than every version scanned elsewhere, so the close (or reopen) supersedes the claim. Closing or reopening your own claim (e.g. an agent closing its finished work, from any worktree), or an issue that is unassigned or not held, needs nothing. Both always scan the other worktrees and branches under the repo lock. A reopen is refused only when a newer version elsewhere holds the issue (a closed local file is not held). The other checks (`invalid_input` for the status, `invalid_state` for an issue already closed / open) come first. The web UI does not call the close / reopen routes (it closes and reopens through the status dropdown, a `PATCH /api/issues/:id`, which offers "Change anyway"), so they have no UI of their own.

#### Review handoff

With a `reviewStatus` configured, `gitrac review <id>` (service: `submitForReview`, `src/service/claim.ts`; rules: `decideReview`, `src/core/claim.ts`) hands a claimed issue off for review, e.g. from an agent to the orchestrator that verifies, merges and closes it. It sets `review`, keeps the assignee, sets `updated` strictly later than the local and every scanned version elsewhere (the scan runs under the repo lock, like `claim`'s), and commits `issue: review #N <title>`. Accepts `-c, --comment` and `-f, --force`. Because `review` is held, the issue stays claimed until it is closed or unclaimed: others' `claim` fails with exit **3**, `next` skips it, and other worktrees show it as `claimedElsewhere`. The assignee's own `claim` moves it back to `in_progress` (rework).

| Situation (effective state) | `review` |
|-----------|---------|
| No `reviewStatus` configured | Fails, `invalid_input`, exit **2** (checked before the issue is loaded) |
| `in_progress`, assigned to you | Moves to `review` |
| `review`, assigned to you | No-op (exit 0, no commit) |
| Held, assigned to someone else | Fails, `already_claimed`, exit **3** (`claimedElsewhere` if not here); `--force` hands it off, their assignee is kept |
| Not held, or unassigned | Fails, `invalid_state`, exit **3** (claim it first) |
| Closed here or in a newer version elsewhere | Fails, `issue_closed`, exit **4** (`closedElsewhere` if not here) |

#### Claims on other branches and worktrees

Each worktree has its own checkout of `.issues/`, so a claim made in one worktree — or committed on a branch that isn't merged yet — isn't in the others' files. `claim`, `ready`, `next`, `ls` and `show` therefore judge an issue by its **effective state**: the version with the latest `updated` among this working tree's file and the issue's file (by ID, in `.issues/` or `.issues/closed/`) in

- every other worktree's working tree (from `git worktree list --porcelain`; uncommitted `--no-commit` claims included), and
- every local and remote-tracking branch (`refs/heads/*`, `refs/remotes/*`) other than the one checked out here.

Ties go to this working tree, then other worktrees, then local branches, then remote-tracking ones. `issueStatesElsewhere` (`src/git/elsewhere.ts`) gathers the versions with a constant number of git processes (`for-each-ref`, `worktree list`, one `cat-file --batch-check`, two `cat-file --batch`; branch blobs identical to this worktree's `HEAD` are skipped) plus plain reads of the other worktrees' files. The rules are pure functions in `src/core/elsewhere.ts`, used by `decideClaim` / `decideUnclaim` (`src/core/claim.ts`) and `isAvailableTo` / `nextIssue` (`src/core/ready.ts`):

- `edit` of the status or the assignee (and `PATCH /api/issues/:id`), `close` and `reopen` are refused the same way when the effective state is held by someone else (see [Editing a claimed issue](#editing-a-claimed-issue)).
- `claim` fails with `already_claimed` (exit **3**) if the effective state is `in_progress` and assigned to someone else; when that version is elsewhere, the message says where (`… claimed by bob (in_progress) in worktree /path (branch agent-1)` / `on branch origin/agent-1`) and the JSON error has `claimedElsewhere: { ref, worktree?, assignee, status, updated }` (`status`: the held status of that version, the active or the review status). `--force` takes it over (the new local claim is then the newest version). Your own claim elsewhere doesn't block you: the issue is claimed here too, with a warning on stderr (`Warning: you already hold issue #1 in worktree /path (branch agent-1); claimed it here too.`; not an error, exit 0). A local closed issue is still `issue_closed` (exit 4). An issue that is open here but whose effective state is closed elsewhere (e.g. an agent closed it in its worktree or on its branch, not merged yet) is also refused with `issue_closed` (exit **4**): the message says where (`Issue #1 is closed (done) in worktree /path (branch agent-1).`), the CLI hint says to merge that branch or use `--force` (not `reopen`, since it is open here), and the JSON error has `closedElsewhere: { ref, worktree?, status, updated }`. Without this check a claim here would write a newer `updated` and undo the agent's close when the branch is merged. `--force` claims it here (no reopen needed; the new local claim supersedes the close). The scan runs under the repo lock, which all worktrees share, so a claim in another worktree can't slip in between the check and the write.
- `unclaim` releases the effective claim: if it is yours elsewhere (e.g. an agent's claim in its worktree, released from `main`), it writes a local release — assignee cleared, the active status moved to `unclaimStatus` (other effective statuses are kept), a newer `updated` — which supersedes the claim everywhere; the other worktree's file and the branch are not touched. stderr says what was released (`Released the claim by bob in worktree /path (branch agent-1) …`). If the effective claim is someone else's, it fails with `already_claimed` (exit **3**; the message says where, the JSON error has `claimedElsewhere`) unless `--force`. It is a no-op if the effective state is unassigned (e.g. a newer release elsewhere), and fails with `issue_closed` (exit **4**, JSON `closedElsewhere: { ref, worktree?, status, updated }`) if the issue is closed here or in a newer version elsewhere, since releasing it would reopen it. The scan runs under the repo lock, like `claim`'s.
- `ready` skips issues whose effective state is closed or assigned to someone else (e.g. claimed in another worktree, or closed on a branch that isn't merged yet); `next` also skips those whose effective state is held (`in_progress` or `review`), even yours, so agents sharing one identity in different worktrees get different issues. Blockers are judged by their local state; a blocker with no local file that exists elsewhere blocks, in any status (see [Dependencies](#dependencies)).
- `ls`, `show` and `ready` mark issues whose effective state is a claim elsewhere: human output appends `[claimed on branch X by Y]` (list) or an `Elsewhere:` line (detail); `-o json`/`yaml` add a `claimedElsewhere` field (`ref`: short branch name, or `HEAD` for a detached worktree; `worktree`: set when found in another worktree's working tree). Likewise, `ls` and `show` mark an issue that is open here but whose effective state is closed elsewhere (completed work awaiting merge): `[closed (done) on branch X]` / `[closed (done) in worktree P (branch X)]`, an `Elsewhere:` line, and a `closedElsewhere: { ref, worktree?, status, updated }` field (`ready` never lists such issues). At most one of the two fields is set (`elsewhereMarks`, `src/core/elsewhere.ts`). The web API adds the same `claimedElsewhere` / `closedElsewhere` fields to `GET /api/issues`, `GET /api/issues/:id` and every other response that embeds an issue (mutation responses, the `current` issue in 409s, the `issue` in `DELETE` responses), and the UI shows them as badges (see [Web UI](#web-ui)).

**Issues that exist only elsewhere.** An issue created in an agent's worktree (committed or not) or on a branch that isn't merged yet has no file here. The same scan, with `withIssues` (it then keeps each version's parsed issue from the same reads; no extra git processes), finds it: `issuesOnlyElsewhere` (`src/core/elsewhere.ts`) picks, for each ID with no local file (a local file that can't be parsed counts as local), the newest version (ties: worktrees, then local branches, then remote-tracking ones).

- `gitrac ls --elsewhere` lists them after the local issues, filtered and sorted by the same query: human output appends `[only in worktree P (branch X)]` / `[only on branch X]`, `-o json`/`yaml` add `foundElsewhere: { ref, worktree? }`. Without `--elsewhere`, `ls` is unchanged.
- `gitrac show <id>` with no local file for the ID shows the newest version elsewhere (exit 0) with an `Elsewhere:  only …` line, `foundElsewhere` in json/yaml, and on stderr `Note: issue #N is not in this working tree; showing the version in worktree P (branch X).` If no version exists anywhere it is still `not_found` (exit **5**).
- `GET /api/issues?elsewhere=1` adds the same items with `foundElsewhere`, from the server's cached scan (`ElsewhereCache`, see [Server](#server)). `GET /api/issues/:id` and `GET /api/issues/:id/dependencies` fall back to the same cached scan when no local file has the ID, like `show` (the issue with `foundElsewhere` and no `ETag`; its links resolved against the local issues). The UI lists them behind a toggle and shows them read-only (see [Web UI](#web-ui)).
- Mutations (`edit`, `claim`, `close`, `comment`, ...; every mutating API route) are unchanged: they need the local file, so they fail with `not_found` (exit **5**, HTTP **404**). Merge the branch first.

A later unclaim or close anywhere (with a newer `updated`) supersedes a claim automatically, as does any newer edit of the issue: the newest version wins whatever it says. Every write to an existing issue (edit, comment, comment edit/delete, close, reopen, claim, unclaim, link, unlink, and the relinks of `delete` and `renumber`) sets `updated` strictly later than the issue's previous `updated`: the current time, or that timestamp plus 1 ms if it is not earlier than the current time (`nextTimestamp`, `src/core/timestamp.ts`). `claim`, `unclaim`, `review`, `close`, `reopen` and an `edit` of the status or assignee also make it strictly later than every version they scan elsewhere, so a release or a `--force` takeover supersedes the claim even when the claim was written in the same millisecond or by a machine whose clock is ahead. A comment added by the write has the same timestamp as `updated`. A claim left on an abandoned branch stays visible until the branch is deleted (`git branch -D`, or `git fetch --prune` / `git push --delete` for remote ones) or someone claims with `--force`. Work in other clones is seen only once fetched.

#### Stale claims

An agent can crash, hang or hit a context or time limit after it claims an issue. Its claim then stays held. `--stale <duration>` finds and recovers such claims. The duration is a positive whole number and one unit: `30s`, `45m`, `2h`, `1d`. Any other value is `invalid_input` (exit **2**, HTTP **400**).

A claim is **stale** (`staleClaim`, `src/core/stale.ts`) when the issue's effective state (see [Claims on other branches and worktrees](#claims-on-other-branches-and-worktrees)) is in the active status (`in_progress`) and assigned, and its `updated` is at least the duration ago. Every gitrac write sets a newer `updated`, so any activity on the issue (a comment, an edit, a renewal) makes the claim fresh again. A claim in the review status is never stale: it waits on the reviewer, not on the agent. A claim whose `updated` can't be parsed is never stale. Without `--stale`, every command behaves as before.

| Command | With `--stale <duration>` |
|---------|------------------------|
| `ls` | Lists only the issues whose effective state is a stale claim (other filters apply too). Human output appends `[stale claim by Y, last activity <iso>]`; `-o json`/`yaml` add `staleClaim: { assignee, updated, ref?, worktree? }` (`ref` / `worktree`: where the effective version is, if not here). With `--elsewhere`, issues only elsewhere are judged too. |
| `ready` | Also lists stale claims (someone else's too), with the same mark / field, if they are not blocked. |
| `next` | Can pick a stale claim (it is not skipped as held). With `--claim`, it takes it over under the repo lock: `claimIssue` scans again under the lock and takes the claim only if it is still stale, so a claim renewed in the meantime is never taken (then `already_claimed`, exit **3**). stderr says `Took over the stale claim by Y on issue #N (last activity <iso>).` Fresh claims are never taken. |
| `unclaim <id>` | Releases someone else's claim without `--force` if it is stale. If it is not stale, `already_claimed` (exit **3**) as before, and the message says why (`Its last activity was 25m ago, less than 2h.` or `A claim in review is never stale.`). stderr says `Released the stale claim by Y (last activity <iso>).` |

**Heartbeat.** `gitrac claim <id> --renew` on an issue you already hold in the active status writes a newer `updated` (instead of the usual no-op) and commits `issue: renew #N <title>` (unless `--no-commit`). On any other issue `--renew` is a normal claim. The scan reads other worktrees' working files, so an agent in a worktree can run `gitrac --no-commit claim <id> --renew` from time to time to show that it is alive, without a commit each time.

`GET /api/issues?stale=<duration>` is the same as `gitrac ls --stale` (from the server's cached scan), with `staleClaim` on each issue.

**Web threshold (`staleAfter`).** The optional `staleAfter` key in `config.yaml` (a duration, unset by default; an invalid value is `invalid_config`) is the web UI's threshold. When it is set, every issue response (`GET /api/issues`, `GET /api/issues/:id`, mutation responses, a 409's `current`) adds `staleClaim: { assignee, updated, ref?, worktree? }` (same rules and shape as `ls --stale`) to each issue whose effective claim has had no activity for that long, from the server's cached scan. The list is not filtered (`?stale=` still filters, with its own duration). The UI shows a `stale: no activity for 3h` badge and offers "Release stale claim" (see [Web UI](#web-ui)). The CLI does not read `staleAfter`: `--stale <duration>` stays explicit, so a config change never changes what a command does.

### Deleting

`gitrac delete <id>` first works out what it would remove: the issue file, plus each asset the issue references that exists in `.issues/assets/` and whose filename appears in no other issue file (open or closed) or web UI draft. Matching is loose on purpose — any mention keeps the asset — and only plain filenames are considered (a ref with `/` or `..` never deletes anything outside `.issues/assets/`). Assets referenced only from other branches can't be seen and may be removed; they remain in git history.

It also finds every other issue (open or closed) that links to the deleted one: the deleted ID is removed from their `blockedBy` (dropping the field if it becomes empty) and their `parent` is cleared if it was the deleted issue, bumping their `updated`. Those files are rewritten (renamed if their filename was stale) under the same lock and committed in the delete commit, so no link dangles. Links on other branches or in other worktrees are not touched (they are still treated as resolved/missing).

- `--yes` / `-y`: delete without asking. `--dry-run`: print the plan (including the issues whose links would be removed) and exit 0.
- Otherwise, on a terminal it prints the plan and asks `Delete issue #N? [y/N]`; anything but `y`/`yes` aborts with `confirmation_required` (exit **2**). When stdin is not a terminal (agents, scripts) it prints the plan to stdout and fails with `confirmation_required` (exit **2**) without asking — re-run with `--yes`.
- The prompt runs outside the repo lock; if the issue changed while it was open, the delete fails with `invalid_state` (exit **3**) and nothing is removed.
- Output (stdout): human `Deleted #N: <title>` (or `Would delete …`) followed by the paths, then `Removed links to #N from:` (or `Would remove …`) with one `#M: <title> (blockedBy, parent)` line per unlinked issue; `-o json`/`yaml` `{ deleted, issue, paths, assets, unlinked }`, where `paths` is the issue file followed by the removed assets, and `unlinked` is `[{ id, title, blockedBy, parent, paths }]` (`blockedBy`/`parent`: whether that link was removed; `paths`: the rewritten file, plus its old path if renamed).
- The ID is not reused: new IDs come from the shared high-water mark, which already counted it.

### Renumbering

`gitrac renumber <id> --file <path>` fixes a duplicate ID (two clones created the same one before fetching each other; see [Issue ID Scheme](#issue-id-scheme)): under the repo lock it allocates a fresh ID the normal way (so it is unique across worktrees and every known ref), rewrites the chosen file's frontmatter `id` (bumping `updated`), appends a comment recording the old ID (`Renumbered from #<old> (duplicate ID).`, or `Renumbered from #<old>.` with `--force` on a non-duplicated ID; by the current identity) so old `#<old>` mentions can be traced, renames it to `<newId>-<slug>.md` in the same directory (`.issues/` or `.issues/closed/`), and commits it (`issue: renumber #<old> -> #<new> <title>`; `--no-commit` respected). The other copy keeps the old ID.

- `--file` takes the repo-relative path as listed by `duplicate_issue`, a path relative to the cwd, or the bare filename (if that is in both `.issues/` and `.issues/closed/`, give the path). A file that isn't one of the ID's is `invalid_input` (exit **2**, `files` lists them).
- Without `--file` and several files: on a terminal it lists them (with titles) and asks which one (no answer: `confirmation_required`, exit **2**); otherwise it fails with `duplicate_issue` (exit **3**) whose `candidates` are `[{ path, filename, closed, title }]`.
- If only one file has the ID it refuses with `invalid_state` (exit **3**) unless `--force`.
- **References.** Since the old ID meant two issues, `blockedBy` / `parent` links and `#<id>` mentions in other issues are ambiguous, so by default nothing else changes and they are only reported. `--update-refs` rewrites the `blockedBy` / `parent` links (never mentions) to the new ID, bumping those issues' `updated`, in the same commit. Only this worktree's issues are considered.
- Output (stdout): human `Renumbered #<old> -> #<new>: <title>`, the `from -> to` paths, then the referencing issues as `#M: <title> (blockedBy, parent, mentions #<old>)` lines (changed ones under `Links to #<old> changed to #<new> in:`); `-o json`/`yaml` `{ renumbered, oldId, newId, from, to, issue, references, paths }`, where `references` is `[{ id, title, blockedBy, parent, mentions, updated, paths }]` (`updated`: its links were rewritten; `paths`: its rewritten file(s)) and `paths` is every committed path.

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
| 3 | `already_claimed`, `already_initialized`, `invalid_state`, `duplicate_issue` | Conflicts with current state: claimed by someone else (`claim`/`unclaim`/`review`/`close`/`reopen`, or `edit` of the status / assignee), `init` on an initialized repo, `close` of a closed issue, `review` of an issue that isn't claimed, `reopen` of an open issue, several files for one issue ID (`files` lists them; see [Renumbering](#renumbering)), `renumber` of a non-duplicated ID without `--force` |
| 4 | `issue_closed` | `claim`/`unclaim`/`review` on a closed issue |
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
gitrac create   # on a terminal, asks for the title
```

Interactive prompts (the `create` title, the `delete` confirmation, the `renumber` file choice) are written to **stderr**, so stdout carries only the command's output (`-o json` stays parseable), and are shown only when stdin is a terminal. Without one, `create` with no `-t` fails with `invalid_input` (exit **2**) instead of reading a title from stdin; `delete` and `renumber` behave as described under [Deleting](#deleting) and [Renumbering](#renumbering).

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
- Without `--status`, only open (non-closed-status) issues are listed; `all` (alone or in a list) lists everything. The `status` field decides, not the directory: both `.issues/` and `.issues/closed/` are always read, so an issue that a merge left in the wrong directory (an open status in `.issues/closed/`, or a closed one in `.issues/`) is listed by its status. `gitrac ls` prints `Warning: issue file <path> is in the wrong directory for its status; the next change to the issue moves it` on stderr for each such file.
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
issue: renew #3 Fix login timeout
issue: unclaim #3 Fix login timeout
issue: delete #3 Fix login timeout
issue: renumber #3 -> #7 Fix login timeout
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
- Asset uploads and drafts don't take the lock: uploads write new uniquely-named files and drafts are untracked. `.issues/.gitignore` (written by `init` and `install-merge-driver`, and — uncommitted — by the first draft save if it is missing or lacks the entry) ignores `.issues/drafts/`, so `git add -A` never picks them up. gitrac's lock, ID high-water mark and temp files live in the git dir or OS temp dir, so need no ignore entry — except the short-lived temp files of atomic writes (below).
- **Atomic file writes:** `config.yaml` and issue files are never rewritten in place. `atomicWriteFile` (`src/fs/atomic-write.ts`) writes and fsyncs a hidden temp sibling in the same directory (`.<name>.<pid>.<uuid>.tmp` — never `*.md` or `config.yaml`, so it's never listed, merged or committed) and `rename`s it over the target, keeping the old file's permissions and writing through a symlink. Readers that don't take the lock (web GETs, `ls`, other worktrees' scans) and a crash mid-write see the old or the new file, never a partial one; on failure the temp file is removed (one left behind by a killed process is ignored via `.*.tmp` in the managed `.issues/.gitignore`). `relocateIssue` replaces the old file this way, then renames it to its new path, so an issue is still exactly one file at every moment.

**Web edits vs. external changes (optimistic concurrency).** The lock serializes writes but doesn't stop a client from writing back content it loaded before someone else's change. So single-issue API responses (`GET /api/issues/:id` and every mutation that returns an issue) carry an `ETag`: a quoted SHA-1 of the issue file's raw bytes, so any change — web, CLI, agent, `git pull`, hand edit — yields a new version. Mutations on an existing issue (`PATCH /api/issues/:id`, `DELETE /api/issues/:id`, comment add/edit/delete, close, reopen) accept `If-Match: <etag>` (or `*`); it is checked under the lock and a mismatch returns **409** `{ error, current }` with the current issue and its `ETag`, writing nothing. Without `If-Match` the request is last-writer-wins, as before (curl, scripts, metadata dropdowns that only send the changed field). Mutation responses return the issue as re-read from disk, so their body and `ETag` match a subsequent GET.

The description editor sends the version its content is based on with every autosave, one save at a time, and skips saving content that is the markdown it is based on (give or take leading/trailing whitespace, e.g. the empty paragraph Tiptap appends when a final code block is clicked into) or the editor's own serialization of it as loaded. When a newer version arrives (SSE refetch or a 409's `current`): if the description is unchanged (only comments/metadata changed) it just adopts the new version (and retries a 409'd save); if the description changed and the editor has no unsaved edits, the new text is loaded into the editor; if it has unsaved edits, autosave pauses and a notice offers "Discard mine, load theirs" or "Keep mine, overwrite theirs". Comment edit/delete send the version too, since comments are addressed by index. The title input is an explicit edit of one field and stays last-writer-wins.

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

1. **Frontmatter:** per field. A field changed on one side takes that change; a field both sides changed differently goes to the side whose `updated` is later (ties: ours) — per-field last-writer-wins, not whole-block replacement. `labels` and `blockedBy` merge as sets (additions and removals from both sides); `parent` is an ordinary field. `updated` is the later of the two. Unknown keys (`extra`) merge per key the same way (one-sided adds/changes/removals win; changed on both: the later `updated`; removed on one side but changed on the other: kept), ours' key order first, and keep their source text.
2. **Description:** unchanged on a side → the other side's; changed on both → line-based three-way merge (`git merge-file`). If that conflicts, the file is still written with merged frontmatter and comments, the conflict markers are left inside the description, and the driver exits 1 so git reports the conflict for manual resolution.
3. **Comments:** keyed by author + timestamp. Additions from both sides are kept; a comment deleted on one side stays deleted unless the other side edited it; an edit on one side wins (both: ours). Sorted by timestamp.

**config.yaml** (`mergeConfigFiles`): legacy `nextId` = max of both; `labels` = union (a color changed on one side wins, both: ours; a label added on their side whose color clashes with another label gets a fresh color; removals stick); `assignees` = union deduplicated by email (case-insensitive), ours' order first; `git.*` per key, and every other key three-way as a whole value, ours on conflict.

**Robustness.** If any version can't be parsed strictly (no frontmatter, invalid id or YAML, leftover conflict markers, different issue IDs, invalid config) or the merged issue wouldn't read back identically, the driver does exactly what git's default driver does — a line merge with ordinary conflict markers (`git merge-file`), exit 1 on conflict — and prints a note to stderr; it never writes a half-merged file. Files are rewritten in gitrac's canonical format (known keys first in their usual order, then unknown keys, which are preserved as on any gitrac write).

**Renames.** A title change renames the file (`<id>-<slug>.md`), and closing/reopening moves it between `.issues/` and `.issues/closed/`. Git's rename detection pairs the old and new paths and the driver merges their contents, so a rename (or close) on one side and edits on the other merge cleanly into the renamed file. If **both** sides renamed it differently (both changed the title), git reports a rename/rename conflict and leaves both files, each with the merged content; keep the one matching the merged title (`git rm` the other, `git add` the keeper). Until then gitrac reports `duplicate_issue` for that ID. If the merged frontmatter doesn't match the directory git kept (e.g. one side closed the issue, the other later set an open status), the issue still lists, shows and filters by its status (`gitrac ls` warns about the file on stderr), and the next gitrac write to the issue (any edit, comment, link, close or reopen) moves it to the right place.

**Duplicate IDs** from separate clones (`12-a.md` vs `12-b.md`) aren't a content conflict and are not handled by the driver; see [Issue ID Scheme](#issue-id-scheme).

### Branch Warning

When current branch != `config.git.defaultBranch` (detected by `init`, see the command table), display prominent warning in CLI output and persistent yellow banner in web UI.

---

## Web UI

### Server

Bun HTTP server with Hono router. Serves REST API and pre-built React SPA static assets. File watcher (`fs.watch`, `src/web/watcher.ts`) on `.issues/` and `.issues/closed/` detects external changes. Git does not track the empty `.issues/closed/`, so it can be missing at startup or come and go on a branch checkout: the watcher attaches to it when it appears, keeps at most one watcher on it, and also checks it with a `stat` every second, because Bun can drop watch events (and Bun before 1.4 on Linux gives none for a directory that was deleted and created again). Events are pushed to the UI via SSE for live updates. The SSE stream (`GET /api/events`) is long-lived: the route lifts Bun's idle timeout for that request only and writes a `: keep-alive` comment every 5s (so proxies don't drop it either). It sends a `connected` event on every (re)connect and an `issues-changed` event on each change; the UI refetches on both, so changes made while it was disconnected are never missed. The UI opens exactly one `EventSource` per tab (`src/web/ui/lib/event-stream.ts`), shared by every hook via a ref-counted subscriber set — browsers allow only ~6 HTTP/1.1 connections per host, so per-component streams would starve all other requests. Likewise the project config is fetched by one shared store (`useConfig`), not per component.

**Claims elsewhere.** Issue responses — every response that embeds an issue, including a 409's `current` and a `DELETE`'s `issue` — carry `claimedElsewhere` / `closedElsewhere` (see [Claims on other branches and worktrees](#claims-on-other-branches-and-worktrees)), computed by the same code as `gitrac ls` (`marksFromStates`, `src/service/list.ts`) from a scan of every issue's versions on other branches and worktrees. The scan is cached per server (`ElsewhereCache`, `src/web/elsewhere-cache.ts`) so list refetch bursts share one: concurrent requests share an in-flight scan, and a result is reused for at most **5 seconds** (`ELSEWHERE_CACHE_TTL_MS`), or until the file watcher sees a change in this worktree's `.issues/`. Other worktrees and refs aren't watched, so a claim (or release, or close) there shows up in API responses within 5s; the UI, which gets no SSE event for it, also refetches open lists/issues every 15s (one shared timer per tab, `src/web/ui/lib/refresh-timer.ts`, paused while the page is hidden) — about 20s at worst. Mutations (`claim`, `next --claim`) never use the cache: they scan fresh under the repo lock.

**Live config.** The server never caches `config.yaml` from startup: it re-reads it before every read-only API request (so `GET /api/config` and `GET /api/git/status` reflect CLI changes such as new assignees from `claim`, label colors, or `git.*` settings) and, for mutations, again right after acquiring the repo lock (so defaults, validation and `git.autoCommit`/`commitPrefix` match the file another process may just have written). If the file is momentarily unreadable or invalid, the last good config is kept. `config.yaml` lives in the watched `.issues/` directory, so a change also emits `issues-changed` over SSE, on which the UI's shared config store refetches.

**Identity.** Web writes are attributed like the CLI's: the server resolves `git config user.name` / `user.email` (as seen from the project root) at startup and re-reads it at most every few seconds, so `git config` changes are picked up without a restart; `gitrac --author <name> serve` pins a fixed name instead. `createdBy` on `POST /api/issues` and the comment author on `POST /api/issues/:id/comments` default to that name (`unknown` if git has none). Either request may send `author` (non-empty string with no line break or em dash, else 400) to override it — the UI's "Acting as" picker in the sidebar lets the user choose a name from `config.assignees` (remembered in `localStorage`). `GET /api/identity` returns the default `{ name, email }`. Assignee semantics are unchanged.

### Security

The server has no authentication, so exposure is limited instead (`src/web/security.ts`):

- **Loopback by default.** Binds `127.0.0.1`. `--host <host>` opts into another interface (`0.0.0.0` = all); the server then prints a warning that anyone who can reach it can read/modify issues and create commits.
- **No CORS.** The UI is same-origin and the Vite dev server proxies `/api`, so no `Access-Control-*` headers are sent; other sites can't read API responses.
- **Host check (DNS rebinding), all requests.** The `Host` header must be an IP literal, `localhost` / `*.localhost`, or the exact name passed to `--host`; anything else gets 403. (A rebinding attack needs an attacker-controlled domain name, which this rejects.) If you bind to all interfaces, reach the server by IP, or pass the name you'll use as `--host`.
- **Origin check (CSRF), mutating requests.** For anything but GET/HEAD/OPTIONS, an `Origin` header must have the same host:port as `Host`; without `Origin`, a `Sec-Fetch-Site` other than `same-origin`/`none` is rejected. Requests with neither header (curl, scripts) are allowed.
- **Vite dev proxy.** `vite.config.ts` proxies `/api` to `http://127.0.0.1:3000` with `changeOrigin: false`, so the browser's `Host` (`localhost:5173`) and `Origin` (`http://localhost:5173`) still match and pass both checks.
- **Uploads.** `POST /api/issues/assets` accepts PNG, JPEG, GIF, WebP, BMP, and ICO up to 10 MiB (413 above that). SVG is rejected — it can carry script and would be served from the app's origin. The editors (paste, drop, and the new-issue attach button) insert an image only once its upload succeeds; a rejected or failed upload leaves the document untouched and shows a dismissible message beside the editor with the server's error text (or a network/HTTP-status fallback).
- **Serving assets.** Assets are served with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; …; sandbox`, so a file opened directly (e.g. an SVG committed earlier) can't run script in the app's origin. Unknown file types are sent as `application/octet-stream` with `Content-Disposition: attachment`.
- **No framing (clickjacking).** Every response (UI, API, assets, 403s/404s) carries `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`, the latter merged into a route's own CSP (e.g. the asset sandbox policy) rather than sent as a second header (`antiFraming`). The Vite dev server serves its own `index.html` without them; proxied `/api` responses still carry them.
- All request bodies are capped at 11 MiB (`maxRequestBodySize`).

### API Routes

| Method | Route | Description |
|--------|-------|------------|
| GET | `/api/issues` | List issues. Query params `status`, `priority`, `label`, `assignee` (comma-separated or repeated), `search`, `mine` (`1`/`true`; = the server's identity, or with `author=<name>` the configured assignee of that name, resolved like `author` on `POST /api/issues/:id/claim`: an unknown or blank name is **400**; `author` is ignored without `mine`), `sort` — same semantics as `gitrac ls` (see [List Filters](#list-filters)). `elsewhere=1` also returns the issues that exist only in another worktree or on another branch, after the local ones, each with `foundElsewhere: { ref, worktree? }` (as `gitrac ls --elsewhere`). Each issue has `claimedElsewhere: { ref, worktree?, assignee, status, updated }` when its newest version is a claim in another worktree / on another branch (as in `gitrac ls -o json`; up to 5s stale, see [Server](#server)), or `closedElsewhere: { ref, worktree?, status, updated }` when the issue is open here but its newest version is closed there. `stale=<duration>` returns only the issues whose effective state is a stale claim, each with `staleClaim: { assignee, updated, ref?, worktree? }` (as `gitrac ls --stale`; see [Stale claims](#stale-claims)); a bad duration is **400**. Without `stale`, when `staleAfter` is configured, each issue whose claim is stale by that threshold has `staleClaim` too (nothing is filtered) |
| GET | `/api/issues/:id` | Get single issue (with `claimedElsewhere` / `closedElsewhere` when set, as in the list). If no local file has the ID, the newest version in another worktree or on another branch (from the cached scan, as `gitrac show`) with `foundElsewhere: { ref, worktree? }` and **no `ETag`**: it can't be edited here, and every mutation of the ID is **404** (a local file that can't be read is 404 too, with no fallback). **404** if no version exists anywhere. **409** `{ error, code: "duplicate_issue", files }` if several files have the ID, **409** `{ error, code: "invalid_issue", file }` if its file is malformed (both also for every mutation of that issue) |
| POST | `/api/issues` | Create issue (optional `author` sets `createdBy`) |
| PATCH | `/api/issues/:id` | Update issue metadata. A no-op (every given field equal to the stored one; a description only differing in leading/trailing whitespace) writes and commits nothing and returns **200** with the current issue and `ETag`. Optional `author` (the "Acting as" choice, resolved as for `POST /api/issues/:id/claim`: an unknown or blank name is **400**) and `force` (a boolean, else **400**) are not issue fields. A change of the status or assignee of an issue held by someone else (here or elsewhere) is **409** `{ error, code: "already_claimed", assignee, claimedElsewhere? }` unless `force: true` (see [Editing a claimed issue](#editing-a-claimed-issue)). Honors `If-Match` (a stale one is 409 even for a no-op) |
| DELETE | `/api/issues/:id` | Delete issue + assets only it references, and remove links to it from other issues (see [Deleting](#deleting)); always a new commit, never amended into the create. **200** `{ deleted: true, issue, paths, assets, unlinked }` (the issue as it was). Honors `If-Match`. `?dryRun=1` (or `true`) writes nothing and returns the plan — the same `{ issue, paths, assets, unlinked }` as `gitrac delete --dry-run -o json`, with `deleted: false` — plus the issue's `ETag`, to send as `If-Match` when confirming |
| POST | `/api/issues/:id/comments` | Add comment (`body`; optional `author`) |
| PUT | `/api/issues/:id/comments/:index` | Edit comment |
| DELETE | `/api/issues/:id/comments/:index` | Delete comment |
| GET | `/api/issues/:id/dependencies` | `{ parent, children, blockedBy, blocks, blocked }`: the linked issues as `{ id, title, status, resolved }` (`status: null`, `resolved: true` for a missing issue; plus `foundElsewhere: { ref, worktree? }` and `resolved: false` for one only in another worktree or on another branch, from the cached scan; see [Dependencies](#dependencies)); `blocks`/`children` are derived and include such issues that link to this one. The issue itself (`GET /api/issues/:id`) carries `parent` / `blockedBy` when set. For an issue only elsewhere, its version there, resolved the same way (as `gitrac show`). **409** `duplicate_issue` / `invalid_issue` as for `GET /api/issues/:id` |
| POST | `/api/issues/:id/link` | `{ blockedBy?: id \| id[], parent?: id }`: add blockers / set the parent. **400** `{ error, errors }` for a missing target, a self-link or a cycle. Honors `If-Match` |
| POST | `/api/issues/:id/unlink` | `{ blockedBy?: id \| id[], parent?: true }`: remove blockers / clear the parent. Honors `If-Match` |
| POST | `/api/issues/:id/claim` | Claim the issue with the rules of `gitrac claim` (see [Claiming](#claiming); `claimIssue`, judged across worktrees and branches): assign it to the acting user and set the active status. Body `{ author?, comment?, force?, renew? }`: `renew: true` renews your own claim (a heartbeat, as `claim --renew`; see [Stale claims](#stale-claims)); `author` (the UI's "Acting as" choice) must be the name of a configured assignee (the claim is then theirs, with their email) or of the server's identity, else **400**; default: the server's identity. A no-op (already your claim) writes nothing and is **200** with the current issue. **409** `{ error, code: "already_claimed", assignee, claimedElsewhere? }` if someone else holds it (`force: true` takes it over), **409** `{ error, code: "issue_closed", status, closedElsewhere? }` if it is closed here or in a newer version elsewhere (`force: true` reopens / claims it). Honors `If-Match` |
| POST | `/api/issues/:id/unclaim` | Give the issue back with the rules of `gitrac unclaim` (`unclaimIssue`): clear the assignee, active status to `unclaimStatus`. Same body and identity as `claim` (without `renew`), plus `stale: "<duration>"`: release someone else's claim only if it is stale (as `unclaim --stale`; a bad duration is **400**; a claim that is not stale is **409** `already_claimed`, with its age in the message). No-op (unassigned) is **200**. **409** `already_claimed` if someone else holds it (`force: true` releases it anyway), **409** `issue_closed` if it is closed. Honors `If-Match` |
| PATCH | `/api/issues/:id/close` | Close issue with the configured close status (`done`); optional body `{ status }` (a configured closed status) or `{ cancelled: true }` (the cancel status), else 400. Optional `author` and `force` as for `PATCH /api/issues/:id`. **409** `{ error, code: "invalid_state", current }` if already closed; **409** `already_claimed` (`assignee`, `claimedElsewhere?`) if someone else holds it unless `force: true` (see [Editing a claimed issue](#editing-a-claimed-issue)). Honors `If-Match` |
| PATCH | `/api/issues/:id/reopen` | Reopen issue with `defaultStatus` (optional body `{ status }`: a non-closed status, else 400). Optional `author` and `force` as for close. **409** `invalid_state` if already open; **409** `already_claimed` if someone else holds it in a newer version elsewhere unless `force: true`. Honors `If-Match` |
| GET | `/api/config` | Get project config |
| PATCH | `/api/config/labels` | Merge label colors (`{ labels: { name: color } }`). **400** if `labels` isn't an object (including a non-JSON or `null` body) |
| PATCH | `/api/config/assignees` | Replace the assignees (`{ assignees: [{ name, email }] }`). **400** if not an array of non-empty `name`/`email`, or if a name or email has a line break or em dash (`{ error }`, plus `errors[]` with one message per problem when there are several) |
| GET | `/api/identity` | Default author for web writes (`{ name, email }` from git config / `--author`) |
| GET | `/api/git/status` | Branch, push state, warnings |
| GET | `/api/events` | SSE stream for live updates: `connected` on (re)connect, `issues-changed` on file changes, `: keep-alive` comments every 5s |
| POST | `/api/issues/assets` | Upload an image (multipart `file`; no SVG; max 10 MiB) |
| GET | `/api/drafts` | List the web UI's new-issue drafts (`.issues/drafts/*.json`, untracked), newest first |
| PUT | `/api/drafts/:filename` | Save a draft (a JSON object; `savedAt` is set). **400** `{ error }` for a body that isn't a JSON object (including malformed JSON, `null`, an array) or a bad filename |
| DELETE | `/api/drafts/:filename` | Delete a draft (no error if it is already gone) |

Draft filenames must end in `.json`; draft and asset filenames must not contain `/`, `\`, `..` or a NUL byte (**400** `{ error: "Invalid filename" }`, the same rule as `isAssetFilename`, `src/core/assets.ts`).

Any other `/api` or `/api/*` request (any method) is a **404** `{ "error": "Not found", "code": "not_found" }` — never the SPA's `index.html`.

### React UI

**Editor:** Tiptap (`@tiptap/react`) — the same editor framework Linear uses (built on ProseMirror). WYSIWYG with no edit/view mode toggle. Auto-saves on change (debounced). Markdown serialization via `tiptap-markdown` for round-tripping to `.md` files.

**Tables:** GFM tables render as tables in every markdown surface (description editor, read-only markdown, comments and their editors) via `@tiptap/extension-table`, with gitrac's own GFM serializer (`src/web/ui/lib/table-extensions.ts`). A table is written as `| a | b |` rows with a `| --- | :---: | ---: |` delimiter row that keeps each column's alignment, `|` inside a cell escaped as `\|`; a table already in that form round-trips byte for byte, while other spellings (`|a|b|`, `|-|`, padded columns, short rows) load fine but are rewritten in that form on the next real edit (opening or clicking around never saves — see "Concurrency"). There is no table toolbar; tables come from markdown or a paste, and edits that GFM can't express are flattened instead of lost: a hard break or a second paragraph in a cell becomes a space, merged cells become the merged cell plus empty ones, and a table without a header row is written with its first row as the header.

**List View:** Sortable/filterable table with columns: ID, Title, Status, Priority, Assignee, Labels, Updated. Colored status/priority badges. An issue claimed in another worktree or on another branch gets a badge after its title (`claimed by Bob in wt-1` / `on origin/agent-1`, in the colors of the claim's status; a claim in the review status reads `Review by Bob in wt-1`; the full location on hover). With `staleAfter` configured, an issue whose claim is stale also gets a `stale: no activity for 3h` badge. An open issue that is closed in another worktree or on another branch gets a `Done in wt-1` / `Done on agent-1` badge instead, in that closed status's colors. Click row to open detail view. Inline status/priority quick-edit as the "Acting as" user; the saves go one at a time, and a failure shows under the row's title. A status change refused because someone else holds the issue (409 `already_claimed`) shows the server's message there with a "Change anyway" button, which sends it again with `force` (`src/web/ui/lib/claim-edit.ts`). Filters above the table, kept for the session in `filterStore`: a search box (the `search` query param, sent 250 ms after the last keystroke; every word must appear in the title or description), Status (default: open), Priority, Assignee, Label (one of the configured labels), a "Mine" checkbox (`mine=1`) and an "Other worktrees/branches" checkbox (`elsewhere=1`, off by default). With the latter, issues that exist only in another worktree or on another branch (e.g. ones an agent filed, not merged yet) are listed after the local ones, sorted among themselves by the same column (as `gitrac ls --elsewhere` lists them after the local ones, and so they never look like local issues), each with a dashed `only in wt-1` / `only on agent-1` badge after the title (the full location on hover). Their status and priority are plain badges, not dropdowns: they have no file here, so they can't be edited. "Mine" means the "Acting as" identity: the UI sends `author=<name>` with `mine=1` when a configured assignee is picked, and leaves it out for the server's git identity (then it is the same as `gitrac ls --mine` run by the server). The filters go to `GET /api/issues`; sorting by a column header stays client-side.

**Detail View:** For an issue that exists only in another worktree or on another branch (`foundElsewhere` from `GET /api/issues/:id`), a read-only view (`ElsewhereIssueView`): a notice `This issue exists only in worktree P (branch X). Merge that branch to edit it here.` (for a detached worktree: commit it on a branch first), the title, the description and comments rendered as markdown, the status, priority, assignee and labels as plain badges, an `Only in worktree P (branch X)` badge, and its links without the editing controls. It refetches like any issue, so it turns into the normal editable view once the branch is merged. Otherwise: Tiptap WYSIWYG editor for description (auto-save on change; external changes are loaded into the editor or flagged as a conflict, see "Concurrency"). Inline metadata editing (dropdowns for status, priority, assignee, labels); below the assignee, "Claim" (shown when the issue is open and not the acting user's active claim, here or elsewhere) and "Release" (shown when it is assigned) buttons claim or give it back as the "Acting as" user through `POST /api/issues/:id/claim` / `unclaim`, so the CLI's claim rules apply and a claim held in another worktree is not overwritten; a refusal shows the server's message inline, with "Take over" / "Release anyway" (`force`) when someone else holds the issue; "Renew" (`renew`) is shown for the acting user's own active claim; with `staleAfter` configured, a stale claim shows a `stale: no activity for 3h` badge, and for a stale claim by someone else "Release stale claim" (sending `stale: staleAfter`, not `force`, so the server releases it only if it is still stale) replaces "Release" (the status and assignee dropdowns edit the fields via `PATCH` as the "Acting as" user; status, priority and assignee saves go one at a time, and a failure shows inline at the top of the sidebar (`src/web/ui/lib/save-queue.ts`); a status or assignee change refused because someone else holds the issue (409 `already_claimed`, see [Editing a claimed issue](#editing-a-claimed-issue)) shows the server's message there with a "Change anyway" button that sends it again with `force`); below that, an "Elsewhere" badge spells out a claim in another worktree / on another branch (`Claimed by Bob in worktree /path (branch agent-1)`), or a close there (`Closed (Done) in worktree /path (branch agent-1)`, styled like that closed status's badge). Below the metadata, a dependencies panel lists the parent, sub-issues, blockers and the issues this one blocks (linked, with status; closed/missing ones struck through; refreshed on every change). A linked issue that exists only in another worktree or on another branch gets a dashed `only in wt-1` / `only on agent-1` badge (the full location on hover) and links to its read-only view; when only such blockers block, the notice reads "Blocked by an issue that is only in another worktree or on another branch". The parent and the blockers can be edited there: type an issue number (`12` or `#12`; blockers take a list such as `#3, #4`) to set the parent or add blockers, and use the `×` next to a link to clear the parent or remove a blocker (`POST /api/issues/:id/link` / `unlink`). The server's 400 message (a missing issue, a self-link or a cycle) shows inline in the panel, and nothing is written. Sub-issues and "Blocks" are derived from other issues, so they are read-only here. Comments rendered below with author/timestamp; editing or deleting one sends the version shown, and a 409 shows the latest issue with an inline notice in that comment (an open comment editor keeps its draft, to save again); a failed delete shows inline in the comment. The title is edited in place (click it; Enter or blur saves, Escape cancels); if the save fails, the input stays open with the typed text and the error shows below it. Tiptap "add comment" editor at bottom. Posting or saving a comment shows "Posting..." / "Saving..." until the request finishes; a failure is shown next to the editor and the text is kept. Label toggles apply at once to the labels shown and are saved one PATCH at a time, each with the full list including earlier toggles, so quick clicks in the label picker never undo each other (`src/web/ui/lib/label-updates.ts`); like the other metadata dropdowns they send no `If-Match`. "Delete issue" at the bottom of the sidebar fetches the dry-run plan and asks for confirmation in a dialog listing the issue file, the assets that will be removed and the issues whose `blockedBy` / `parent` links to it will be removed; confirming deletes with `If-Match` set to the version the plan was made from (a 409 shows the latest version instead), then returns to the list. All changes trigger commit (with amend-until-pushed logic).

**Issue references:** `#N` in descriptions and comments (read-only views and editors alike) renders as a link to `/issues/N`, with the issue's title on hover when the UI has already loaded it (the list, the open issue, its linked issues). It's render-only — ProseMirror decorations (`src/web/ui/lib/issue-link-plugin.ts`), so the saved markdown is unchanged. A reference must be word-bounded (not `abc#3`, `##3`, `&#38;`, `#3a`, `#3.5`, `#3-setup`) and not in inline code, a code block, a link, or a bare URL (`https://x/page#3`); rules in `src/web/ui/lib/issue-refs.ts`. Clicking navigates in-app in read-only views and the description editor; in composers (new comment, comment edit, new issue) it opens a new tab so the draft isn't lost.

**Visual Style:** Dark theme by default (with light theme option). Status colors: a status's configured `color`, else backlog=gray, todo=blue, in_progress=yellow, done=green, cancelled=red, gray for other statuses (priority dots likewise). Clean sans-serif typography, minimal chrome.

**Branch Warning:** Persistent yellow banner when not on default branch.

### Build

Vite builds the React SPA at publish time (`dist/ui/`). `scripts/build.ts` then generates an entry (`dist/gitrac-entry.ts`) that imports every `dist/ui` file `with { type: 'file' }` — embedding it in the executable — and registers the URL-path manifest (`registerEmbeddedUi`, `src/web/ui-assets.ts`) before running the CLI; `bun build --compile` turns that into a single self-contained binary, which serves the UI from the embedded files and needs nothing beside it on disk. Releases ship just that binary.

Where the server finds the UI (`resolveUiAssets`):

1. **Compiled binary:** the embedded manifest only.
2. **From source** (`./gitrac`): gitrac's own `dist/ui/` (built by `./bun run vite build --config vite.config.ts`), resolved relative to the gitrac source tree — so it works when serving any other repo.
3. Otherwise only the API is served (startup prints a warning).

The served project's directory, the cwd and the bun executable's directory are never searched, so a repo with an unrelated `dist/ui/` can't shadow the UI. Files under `/assets/` (Vite's hashed output) are served `Cache-Control: immutable` and a missing one is a 404; any other unknown GET path outside `/api` falls back to `index.html` (SPA routing).

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
- **Custom fields:** Extensible frontmatter schema (unknown keys are already preserved and exposed read-only as `extra`)
- **Templates:** Issue templates in `.issues/templates/`
