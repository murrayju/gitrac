---
id: 117
title: add `gitrac commit` command
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-20T21:03:15.462Z'
createdBy: Justin Murray
updated: '2026-10-21T00:34:25.152Z'
---

This command acts as a proxy to `git commit`, while simultaneously closing the issue. This will allow us to clean up the suggested workflow, that involves using `gitrac close <id> --no-commit` to make the commit atomic (fix and close together).

Proposed syntax:

```
gitrac commit <id> [<gitrac close params>] [-- <git commit params>]
```

Examples:

```
# explicit form
gitrac commit 123 -c "comment on issue" -- -m "commit message"

# no issue comment, interactive git commit
gitrac commit 123
```

This will implicitly perform the `gitrac close` first (staging the issue change, but not committing it), then shell out to `git commit`

---

### Justin Murray — 2026-10-21T00:34:25.152Z

I've added `gitrac commit <id> [close options] [-- <git commit args>]`. It closes the issue and puts the close into the same `git commit` as your staged changes. If git fails, the close is undone. Typecheck and lint are clean, and the full suite for `src/cli`, `src/git`, `src/service` and `src/core` passes (1083 tests, 0 failures).

\## What was wrong
To fix and close an issue in one commit, you had to run `gitrac close <id> --no-commit`, then `git add -A`, then `git commit`. This was easy to get wrong: forgetting `--no-commit` gave two commits, and passing paths to `git commit` left the issue out.

\## What changed
- **Argument check (`src/core/git-commit-args.ts`, new):** a small pure function that reads the `git commit` arguments the way git does. It knows which options take a separate value, handles `--opt=value` and attached values like `-mmsg`, clustered short flags (`-am msg`), and git's abbreviated long options (`--mess`), and treats `--no-x` as turning `x` off. It reports pathspecs, `-a`/`--all` and `--amend`. Positional arguments, anything after a second `--`, and `--pathspec-from-file` all count as pathspecs.
- **Snapshot and restore (`src/git/path-snapshot.ts`, new):** saves each issue path's working file (content and mode) and its index entries, and puts both back exactly.
- **`src/git/operations.ts`:**
  - New `stageFiles`, a thin wrapper around the existing `stagePaths`. I added a `removeMissing` option so the moved-away file's deletion is staged too; a normal commit, unlike the existing `--only` commit, needs that.
  - New small helpers: `stagedFiles`, `headCommit`, and `runGitCommit`, which runs git attached to the terminal and ignores Ctrl-C while git runs so cleanup can still happen.
- **Service (`src/service/commit-close.ts`, `closeWithCommit`):**
  1. Rejects pathspecs (exit 2) before taking the lock.
  2. Under the lock: if nothing besides the issue is staged and there is no `-a` or `--amend`, it stops with exit 2. Otherwise it saves the issue file, runs the existing `closeIssue` without committing, and stages exactly the paths it returned.
  3. Runs `git commit` outside the lock. It counts as success only if git exits 0 and `HEAD` moved.
  4. On failure it restores the issue file and index under the lock and exits 7 (`git_error`), with git's exit status in the error details.
  5. On success it pushes per `--push` / `git.autoPush`.
- **CLI (`src/cli/commands/commit.ts`):**
  - Takes the same options as `close`: `-c`, `--cancelled`, `-s`, `-f`.
  - `--no-commit` is a usage error (exit 2).
  - Human output is git's own output plus `Closed #N (<status>) in <hash>`.
  - With `-o json`/`yaml`, git's output goes to stderr and stdout carries only `{ issue, commit }`.
  - Error hints are added by error reason, so the service messages stay free of CLI flags.
- **Docs:** updated `SKILL.md`, `README.md`, `AGENTS.md`, the design spec and `work-backlog.md` to make this the recommended workflow. `close --no-commit` followed by `git commit` stays documented as the alternative.

\## Tests
- **Argument check:** option values, pathspecs, `-a` inside clusters, abbreviated and negated options.
- **Snapshot and restore:** a moved file with both staged and unstaged changes, untracked and missing paths, a staged deletion with file mode kept, and paths with spaces.
- **End-to-end CLI (temp repo, `commit.gpgsign=false`):**
  - success with `-- -m`: one commit with the code, the deleted open file and the new closed file; tree clean afterwards
  - `-o json` output
  - `-a`
  - message written by a `GIT_EDITOR` script
  - nothing staged and pathspecs (with and without a second `--`): exit 2, nothing changed
  - `--no-commit`: exit 2
  - `--dry-run` and a rejecting `commit-msg` hook: exit 7, with `HEAD`, status, index and the issue file all as before, including an uncommitted claim and a partly staged issue file
  - someone else's claim: exit 3 without `-f`, works with it
  - `--push`

All of these tests fail without the change, since the command and modules don't exist.

\## Decisions and trade-offs
- **New module instead of growing `issues.ts`:** the new service operation lives in its own file, `src/service/commit-close.ts`.
- **Order of the empty-staging check:** it runs under the lock, before the close. If the issue file doesn't exist, the check is skipped so `closeIssue` reports "not found" (exit 5) instead.
- **Partial failure:** if git makes the commit but then exits non-zero (for example a failing `post-commit` hook), the commit is kept, because rolling back would leave a closed issue in history and an open one on disk. It still exits 7, with the commit hash in the details.
- **Rollback scope:** only the issue files are restored. Referenced asset files keep their contents, but their index entries are restored too, so assets the command staged are unstaged again.
- **Ctrl-C:** while git runs, gitrac ignores Ctrl-C so it can roll back after git exits. A `SIGKILL` would leave the close in the working tree, uncommitted.
- **Commit message:** gitrac adds none, as specified. The docs tell users to reference `(#id)` in it.

\## Follow-ups noticed
- `--amend` together with a pushed `HEAD` gets no special warning.

- `.agents/skills` is a symlink to `skills/`, so updating `skills/using-gitrac/SKILL.md` covers both.

**Orchestrator verification:** on a scratch repo, `gitrac commit 3 -c ... -- --dry-run -m x` exited 7 ("git commit made no commit") and left HEAD, the index and the working tree exactly as before, including an uncommitted `--no-commit` claim; `gitrac commit 3 -c ... -- -m "fix: ... (#3)"` then made one commit with the code change and the issue moved to `closed/`. This change itself was committed with `gitrac commit 117` (gpg-signed). The first agent run stalled on an idle API stream and was restarted; the second run produced this change.
