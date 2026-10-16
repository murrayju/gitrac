---
name: using-gitrac
description: Use when a project has a .issues/ directory or AGENTS.md mentions gitrac for issue tracking - guides claiming, working on, and closing issues atomically alongside code changes
---

# Using gitrac

## Overview

gitrac manages project issues as markdown files in the git repo itself. Issues live in `.issues/`, closed issues in `.issues/closed/`. Every mutation auto-commits to git. Auto-commits include only the issue files gitrac touched; anything else you have staged stays staged and is not swept into the `issue:` commit.

Mutations are safe to run in parallel (multiple agents, worktrees, or the web UI at the same time): gitrac serializes them with a lock in the git dir, so IDs never collide and commits don't fail on git locks. New IDs also skip any ID used on another worktree or any branch you have locally (including fetched remote branches), and creating an issue doesn't touch `config.yaml`, so parallel branches merge cleanly. Only unfetched work from another clone can still reuse an ID — `git fetch` before creating issues if others are working in separate clones. If a gitrac process is killed, its stale lock is cleaned up automatically. Editing an issue from the CLI while it's open in the web UI is safe too: the browser picks up your change, and if someone has unsaved edits to that description they get a conflict notice instead of the autosave overwriting your text.

gitrac finds the project via `git rev-parse --show-toplevel`, so commands work from any subdirectory of the repo (or with `--dir <path>` pointing anywhere inside it). `.issues/` always lives at the repo root.

**Core principle:** Claim before working. Close in the same commit as the code change.

## When to Use

```dot
digraph when {
  ".issues/ dir exists?" [shape=diamond];
  "AGENTS.md mentions gitrac?" [shape=diamond];
  "Use this skill" [shape=box];
  "Skip" [shape=box];

  ".issues/ dir exists?" -> "Use this skill" [label="yes"];
  ".issues/ dir exists?" -> "AGENTS.md mentions gitrac?" [label="no"];
  "AGENTS.md mentions gitrac?" -> "Use this skill" [label="yes"];
  "AGENTS.md mentions gitrac?" -> "Skip" [label="no"];
}
```

- Project has a `.issues/` directory at the repo root
- AGENTS.md or CLAUDE.md references gitrac
- You've been asked to work on a gitrac issue

## Installation

```bash
curl -fsSL https://get.gitrac.dev | bash     # binary to ~/.local/bin (GITRAC_NONINTERACTIVE=1 in CI)
npm install -g @gitrac/cli                   # or via npm
gitrac --version
```

**From source (if working in the gitrac repo itself):** use `./gitrac <command>` instead of `gitrac`.

## Quick Reference

| Command | Description |
|---------|------------|
| `gitrac ls` | List open issues |
| `gitrac show <id>` | View issue details |
| `gitrac create -t "title"` | Create an issue |
| `gitrac claim <id>` | Assign to yourself + set in_progress (fails if someone else has it) |
| `gitrac ready` | Issues you can start now: open, unassigned or yours, no open blockers; by priority, then ID (`-o json`; filters `--status`, `--priority`, `--label`, `--mine`, `--search`, `--sort`) |
| `gitrac next --claim` | Pick the top ready issue that isn't already in progress and claim it, atomically (exit 5 `no_ready_issues` if none). Without `--claim` it just shows it |
| `gitrac link <id> --blocked-by 3,4` | `<id>` can't start until #3 and #4 are closed (`--parent <n>` makes it a sub-issue of #n). Rejects self-links, missing issues and cycles (exit 2) |
| `gitrac unlink <id> --blocked-by 3` | Remove a blocker (`--parent` clears the parent) |
| `gitrac unclaim <id>` | Give an issue back (alias `release`) |
| `gitrac close <id>` | Close an issue (moves to closed/; status = config `closeStatus`, default `done`; `--cancelled` = `cancelStatus`, default `cancelled`; `-s <status>` any closed status) |
| `gitrac close <id> --no-commit` | Close without committing (for atomic commits) |
| `gitrac close <id> -c "text"` | Close with an inline comment |
| `gitrac delete <id> --yes` | Delete an issue (duplicates, test issues) and the assets only it uses, and drop it from other issues' `blockedBy`/`parent`, in one commit. Without `--yes` and no terminal it only prints what would be deleted and exits 2; `--dry-run` previews (exit 0) |
| `gitrac renumber <id> --file <path>` | Give one copy of a duplicated issue ID (`duplicate_issue`) a fresh ID: renames the file, updates its `id`, adds a `Renumbered from #<old>` comment, commits (`-o json`: `oldId`, `newId`, `from`, `to`, `references`). Without `--file` it lists the files (exit 3). Issues linking to / mentioning the old ID are listed, not changed; `--update-refs` repoints their `blockedBy`/`parent`. `--force` for a non-duplicated ID |
| `gitrac reopen <id>` | Reopen a closed issue (status = config `defaultStatus`; `-s todo` to pick) |
| `gitrac create -t "title" --description-file desc.md` | Create with a markdown description (`-` = stdin; or `-d "text"`) |
| `gitrac comment <id> "text"` | Add a comment (or `--body-file <path\|->`) |
| `gitrac edit <id> -s todo` | Update status |
| `gitrac edit <id> -d "text"` | Replace the description (or `--description-file <path\|->`). Values equal to the current ones are a no-op (exit 0, no write/commit, note on stderr); no flags at all is exit 2 |
| `gitrac install-merge-driver` | Once per clone: issue-aware `git merge`/`rebase` for `.issues/` (`init` does it too); also commits `.issues/.gitignore` (ignores web UI `drafts/`) if missing |
| `gitrac ls -o json` | Machine-readable output |
| `gitrac ls --mine` | Issues assigned to you |
| `gitrac ls --priority urgent,high --label bug` | Filters take comma-separated values (any of); `--status all` includes closed |
| `gitrac ls --search "login timeout"` | Title/description contains every word |
| `gitrac serve -p 4000` | Start the web UI (bare `gitrac` also serves, on :3000). Binds 127.0.0.1; `--host 0.0.0.0` exposes it to the network (no auth). Web changes are attributed to your git `user.name` (or `--author`); the sidebar's "Acting as" picker can switch to a configured assignee |

## The Workflow

### 1. Find work

```bash
gitrac ls        # everything open
gitrac ready     # only what you can start now (unblocked, not someone else's — in any worktree/branch)
```

Review the open issues. Pick one that matches the task at hand. To just take the most important unblocked issue, `gitrac next --claim` picks and claims it in one step (under the repo lock, so parallel agents never get the same one) — then skip step 2.

**Dependencies.** `blockedBy` lists issues that must be closed first; `ready`/`next` skip an issue while any blocker is open. A blocker counts as resolved when it is `done` **or** `cancelled` (or deleted). `parent` is informational (sub-issues), it doesn't block. `gitrac show <id>` lists the parent, sub-issues, blockers and the issues it blocks. When you discover that an issue depends on another, record it: `gitrac link <id> --blocked-by <other>`.

### 2. Claim it

```bash
gitrac claim <id>
```

This sets `assignee` to your git user and `status` to `in_progress`, and commits the change. Claims are exclusive:

- If the issue is already `in_progress` and assigned to someone else, `claim` fails with **exit code 3** and changes nothing. Pick another issue (or use `--force` only if you really mean to take it over). This includes claims made in **another worktree** (even uncommitted, `--no-commit`) or committed on **another branch**, local or fetched: gitrac compares the issue's versions everywhere and the one with the latest `updated` wins. The error says where (`… claimed by bob (in_progress) in worktree /path (branch agent-1)`); with `-o json` it has `claimedElsewhere: { ref, worktree?, assignee, updated }`.
- If the issue is closed, `claim` fails with **exit code 4**. Use `gitrac reopen <id>` first, or `claim --force` to reopen and claim in one step. `claim` also fails with exit 4 when the issue is open here but was closed in **another worktree** or on **another branch** (e.g. an agent finished it and the branch isn't merged yet): the error says where (`Issue #1 is closed (done) in worktree /path (branch agent-1).`) and `-o json` has `closedElsewhere: { ref, worktree?, status, updated }`. Don't reopen it here; merge that branch to bring the close in. Use `--force` only if you really mean to claim it again (your newer claim would undo that close when the branch is merged).
- Claiming an issue you already own is a no-op (exit 0, no commit). If you already hold it in **another worktree** (or on another branch), `claim` succeeds but warns on stderr (`Warning: you already hold issue #N in worktree /path …; claimed it here too.`) — you probably meant to work on it there.

If you stop working on an issue without finishing it, give it back with `gitrac unclaim <id>` (alias `release`): it clears the assignee and moves `in_progress` back to `todo`. Releasing someone else's claim requires `--force` (exit 3 otherwise). This works across worktrees and branches too: `unclaim` from `main` releases a claim made in an agent's worktree (or committed on its branch) by writing a newer local version that supersedes it, so the issue is ready again for everyone. The error (and its `-o json` `claimedElsewhere`) says where someone else's claim is.

`ls`, `show` and `ready` flag issues claimed elsewhere: `[claimed on branch X by Y]` in the list, an `Elsewhere:` line in `show`, and a `claimedElsewhere` field in `-o json` (the web UI shows a `claimed by Y in …` badge, and `GET /api/issues[/:id]` has the same `claimedElsewhere` field, refreshed within a few seconds). They also flag issues that are open here but closed elsewhere (finished work waiting for a merge): `[closed (done) on branch X]` / `[closed (done) in worktree P (branch X)]`, an `Elsewhere:` line, and a `closedElsewhere` field (a `Done in …` badge in the web UI). `ready`/`next` skip issues claimed (or closed) in another worktree or on an unmerged branch. A later unclaim or close anywhere supersedes the claim. A claim stuck on an abandoned branch stays visible until you delete that branch (`git branch -D <branch>`, or `git fetch --prune` for remote ones) or take it over with `claim --force`.

### 3. Implement the fix/feature

Write code, run tests — the normal development workflow. The issue file in `.issues/` serves as your spec.

### 4. Document what was done

**Always add a comment before closing.** The comment should read like a PR description. You can either use the standalone comment command or the `--comment` / `-c` flag on close:

```bash
# Standalone comment
gitrac comment <id> "Summary of changes: what was fixed/added, why, files affected, and any notable decisions."

# Or inline with close (preferred for atomic workflows)
gitrac close <id> --no-commit --comment "Summary of changes"
```

The comment becomes part of the issue's permanent history. Write it for someone who needs to understand what happened without reading every diff line.

The `--comment` / `-c` flag is also available on `claim`, `unclaim`, `edit`, and `reopen`.

### 5. Close with the code change

This is the key pattern. Close the issue **in the same commit** as the code change:

```bash
# Close the issue with a comment, without auto-committing
gitrac close <id> --no-commit -c "Summary of what was done"

# Stage everything together: code changes + the closed issue file
git add -A

# One atomic commit
git commit -m "fix: resolve the problem (#<id>)"
```

This creates a single commit that contains both the code fix and the issue state change. Anyone looking at the commit sees exactly what was fixed and why.

### 6. Verify

```bash
gitrac ls              # issue should no longer appear
gitrac show <id>       # should show status: done, in .issues/closed/
```

## Parallel Agents in Worktrees

Recommended workflow when an orchestrator runs several agents at once:

1. The orchestrator creates one worktree (and branch) per agent: `git worktree add -b agent-1 ../agent-1`.
2. Each agent runs gitrac **inside its own worktree** and claims there: `gitrac claim <id>` (or `gitrac next --claim`). The claim is visible to every other worktree immediately — committed or not — so other agents' `claim` fails with exit 3 and their `ready`/`next` skip it. Agents sharing one git identity still get different issues from `next --claim`.
3. When done, the agent closes with `gitrac close <id> --no-commit -c "summary"` and commits the code and the issue file together on its branch. Until that branch is merged, the issue no longer shows up in `ready`/`next` elsewhere.
4. If an agent gives up or dies, release its claim from anywhere (e.g. the main worktree): `gitrac unclaim <id>` (add `--force` if the agent used a different identity). The newer release supersedes the claim in its worktree, so `ready`/`next` offer the issue again.
5. The orchestrator merges the branches; the gitrac merge driver (below) merges the `.issues/` files. Delete merged/abandoned agent branches so stale claims don't linger.

## Merging Branches

With the gitrac merge driver installed (`gitrac init` installs it; in an existing clone run `gitrac install-merge-driver` once — the git config part isn't versioned), git merges issue files field by field instead of line by line: comments from both branches are kept, a field changed on one side wins, a field changed on both goes to the side updated last, labels and `blockedBy` merge as sets, and `config.yaml` labels/assignees are unioned. A rename (title change) or close on one branch plus edits on the other merges into the renamed file. Only these need you:

- **Both branches edited the same lines of a description:** the merge stops with conflict markers inside the description (frontmatter and comments are already merged). Edit them out, `git add`, continue.
- **Both branches changed the title:** git reports a rename/rename conflict and leaves two files with the same merged content. Keep the one matching the title, `git rm` the other.
- **A file the driver can't parse** (hand-broken YAML, leftover markers): you get git's normal conflict markers for the whole file.
- **Same ID created in two clones** (`12-a.md` and `12-b.md`): not a merge conflict; gitrac then fails with `duplicate_issue` (exit 3). Run `gitrac renumber 12 --file .issues/12-b.md` to give one copy a new ID, then check the issues it lists as referencing #12 (the old links/mentions could mean either issue; `--update-refs` points their `blockedBy`/`parent` at the new ID).

## Reading Issues Directly

Issues are plain markdown. You can read them without the CLI:

```
.issues/<id>-<slug>.md     # open issues
.issues/closed/<id>-<slug>.md  # closed issues
```

Format: YAML frontmatter (id, title, status, priority, assignee, labels, optional `parent` / `blockedBy`, dates; any other keys you add, like `estimate:`, are kept verbatim after these and shown read-only as `extra` in `-o json`) followed by a markdown description, then optionally a `---` separator and comments. Each comment starts with `### author — timestamp`. Only a `---` immediately followed (after blank lines) by a comment header is the separator; other horizontal rules in the description are preserved.

When reading comment bodies, headings are escaped (`\## Heading` means `## Heading`). A comment-header-like line right after a `---` in a description is likewise escaped (`\### a — b`).

## Structured Output for Agents

Use `-o json` or `-o yaml` for machine-readable output:

```bash
gitrac ls -o json                    # all open issues as JSON array
gitrac show <id> -o json             # single issue as JSON
gitrac ls -o json --status all       # include closed issues
gitrac ls -o json --mine --status todo,in_progress  # my active work
gitrac ready -o json                 # what can be started now
gitrac next --claim -o json          # claim the top ready issue (exit 5 if none)
```

This is useful for programmatic decision-making about which issue to work on.

### Errors and exit codes

stdout only ever holds the result. Errors and warnings (e.g. "not on the default branch") go to **stderr**. With `-o json`, the error is a single JSON line — the last line of stderr:

```json
{"error":{"code":"not_found","message":"Issue #9 not found","id":9}}
```

(`-o yaml` prints the same object as YAML; human mode prints `Error: <message>`.) Branch on the exit code or `code`:

| Exit | `code` | Meaning |
|------|--------|---------|
| 0 | | Success |
| 1 | `error`, `invalid_config`, `invalid_issue` | Unexpected error, unparseable `.issues/config.yaml`, or a malformed issue file (no frontmatter, bad YAML, `id` not matching the file name; `file` names it, nothing is written — fix the file by hand) |
| 2 | `invalid_input`, `usage`, `confirmation_required` | Bad ID / field value / flag / missing argument, or `delete` without `--yes` (stdin not a terminal) — nothing was written |
| 3 | `already_claimed`, `already_initialized`, `invalid_state`, `duplicate_issue` | Conflict: claimed by someone else, already initialized, closing a closed / reopening an open issue, or several files on disk for one issue ID (`files` lists them — merge them by hand and delete all but one, or `gitrac renumber <id> --file <path>` if they are different issues); `renumber` of a non-duplicated ID without `--force` |
| 4 | `issue_closed` | `claim`/`unclaim` on a closed issue |
| 5 | `not_found`, `no_ready_issues` | No such issue; `next` found no ready issue |
| 6 | `lock_timeout` | Another gitrac process held the repo lock too long — retry |
| 7 | `git_error` | git commit/push failed (the issue file may already be changed — check `git status`) |
| 8 | `not_a_git_repo`, `not_initialized` | Not in a git repo, or run `gitrac init` |

Stack traces are hidden unless you pass `--debug`.

## Common Mistakes

| Mistake | Why it's wrong | Fix |
|---------|---------------|-----|
| Closing in a separate commit | Breaks the atomic link between fix and issue | Use `--no-commit` on close, commit together |
| Not claiming before working | Another agent may start the same work | Always `claim` first |
| Editing issue files directly | Bypasses git auto-commit, may produce invalid format | Use the CLI |
| Forgetting `--no-commit` on close | Creates two commits instead of one | Close with `--no-commit`, then `git add -A && git commit` |
| Working on closed issues | They live in `closed/` and are done | Check `gitrac show <id>` first |
| Closing without a comment | Loses context about what was done and why | Always `gitrac comment <id> "..."` before closing |
| Deleting an issue you just don't want to do | Erases its history from the tracker | `gitrac close <id> --cancelled -c "why"`; reserve `delete` for duplicates / test issues |

## Creating Issues

When you discover a bug or identify needed work during development:

```bash
gitrac create -t "Brief description" -p high -l bug
```

Flags: `-t` title (required — without it, and no terminal, `create` exits 2 rather than prompting), `-p` priority, `-l` labels (comma-separated), `-a` assignee, `-s` status, `-d` description (markdown), `--description-file <path|->` description from a file or stdin (`-`).

Status and priority must be one of the values in `.issues/config.yaml` — anything else is rejected (exit 2, nothing written). Titles, assignees and labels must be one line, and an author name (`--author`, or your git `user.name` when it writes a comment or `createdBy`) must have no line break and no em dash (U+2014); otherwise exit 2, nothing written. New labels are added to the config automatically with a color.

**Statuses and priorities are project-specific.** Check `statuses` / `priorities` in `.issues/config.yaml` (or the error message, which lists them) rather than assuming the defaults (`backlog, todo, in_progress, done, cancelled`; `urgent, high, medium, low, none`). A status entry is a plain name or `{ name, label?, color?, closed? }`; `closed: true` statuses live in `.issues/closed/` (also when an issue is created with one; plain `done`/`cancelled` are closed, other plain names open). Optional keys pick the statuses commands use: `activeStatus` (what `claim` sets; default `in_progress`), `unclaimStatus` (`todo`), `closeStatus` (`done`), `cancelStatus` (`cancelled`; without one, `close --cancelled` exits 2). In this guide `in_progress` / `todo` / `done` mean those configured statuses. An inconsistent config (e.g. `defaultStatus` closed, no closed status) makes every command exit 1 (`invalid_config`) listing each problem.

Don't over-describe in the title — put details (context, acceptance criteria) in the markdown description. For multi-line text, use a heredoc instead of shell-quoting:

```bash
gitrac create -t "Fix login timeout" -p high -l bug --description-file - <<'EOF'
Sessions expire after 5 minutes instead of 30.

## Acceptance criteria
- Session lifetime honors `SESSION_TTL`
EOF
```

`gitrac edit <id> -d "..."` / `--description-file` replaces the description later; `gitrac comment <id> --body-file -` does the same for long comments. Passing both the inline and file form is an error.
