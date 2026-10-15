---
id: 69
title: Add a renumber command for duplicate issue IDs
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-15T13:15:04.607Z'
createdBy: Justin Murray
updated: '2026-10-15T14:09:47.238Z'
---

Two separate clones that create issues without fetching each other can still allocate the same ID (#54 limitation). After merging, gitrac reports `duplicate_issue` (#63) and the fix is manual.

## Acceptance criteria

- `gitrac renumber <id> --file <path>` (or an interactive choice when stdin is a TTY) moves the selected file to a fresh ID allocated the normal way (#54 allocator), renaming the file and updating its frontmatter `id`, under the repo lock, committed (respect `--no-commit`), `-o json` output with old/new IDs and paths.
- Without `--file`, if the ID is duplicated, list the candidates and exit with `duplicate_issue`/usage guidance; if the ID isn't duplicated, require `--force` to renumber anyway.
- References: since `#N` mentions and `blockedBy`/`parent` links are ambiguous when an ID is duplicated, do not rewrite them by default; print (and include in JSON) the issues that reference the old ID; `--update-refs` rewrites `blockedBy`/`parent` links in other issues to the new ID.
- Error messages for `duplicate_issue` (CLI hint + skill/spec docs) point to `gitrac renumber`.
- Tests (service + CLI), including a real two-clone merge producing a duplicate.

---

### Justin Murray — 2026-10-15T14:09:47.238Z

Issue #69 is done: there is now a `gitrac renumber <id>` command that gives one copy of a duplicated issue ID a new ID. `./bun run check` passes (1038 tests); nothing is committed.

**What was wrong:** two clones that create issues without fetching each other can both pick the same ID (the #54 limitation). After a merge, gitrac reports `duplicate_issue` and you had to rename the file and edit its `id:` by hand.

**What changed**
- **New service operation `renumberIssue`** (`src/service/renumber.ts`). It runs under the repo lock and gets the new ID from the normal allocator (`allocateIssueId`). It changes the frontmatter `id`, updates `updated`, and renames the file to `<new>-<slug>.md` in the same folder (`.issues/` or `.issues/closed/`). It commits as `issue: renumber #1 -> #3 <title>` and respects `--no-commit`. The other copy keeps the old ID. Everything is checked before an ID is allocated:
  - The ID has no files: `not_found`.
  - Several files and no `--file`: `duplicate_issue`, listing each path with its title (also as `candidates` in the JSON error).
  - `--file` doesn't match one of the ID's files: `invalid_input`.
  - Only one file and no `--force`: `invalid_state` (exit 3).
- **References.** Since the old ID meant two issues, other issues that point at it (`blockedBy`, `parent`) or mention `#<id>` are listed, not changed. `--update-refs` rewrites the `blockedBy`/`parent` links (never mentions) in the same commit.
- **CLI command** (`src/cli/commands/renumber.ts`, registered in `src/cli/index.ts`). `-f, --file` takes the repo-relative path from the error, a path relative to the current directory, or just the filename. Without `--file` on a terminal, it lists the files and asks which one; the question is asked before taking the lock. `-o json|yaml` returns `{ renumbered, oldId, newId, from, to, issue, references, paths }`.
- **Error messages.** The core `duplicate_issue` message now says to delete extra copies of the same issue, or renumber one if they are different issues. Every CLI command now adds `To give one of them a new ID: gitrac renumber <id> --file <path>.` (`withCliHints` in `src/cli/errors.ts`, applied in `reportError`). It is skipped when the message already mentions `gitrac renumber`, so `renumber` itself shows only one hint.
- **Shared code:**
  - `findIssueFiles` (`src/fs/issue-store.ts`) returns every file for an ID, sorted by filename; `findIssueFile` now uses it and returns the same shape as before.
  - The `referencingIssues` logic from `delete.ts` moved into `src/service/references.ts` (`linkingIssues`, `linksTo`, `rewritePaths`), and `delete.ts` uses it. Delete behaves the same.
  - `'renumber'` was added to `Operation` in `src/service/context.ts`.
- **Docs:** `AGENTS.md`, `skills/using-gitrac/SKILL.md` and the design spec (new "Renumbering" section; ID scheme, file lookup, commands, `--no-commit`, commit messages and exit codes updated).

**Tests**
- `src/service/renumber.test.ts`: duplicate without `--file`, picking a file by path or filename, a filename that exists in both folders, `--force`, not found, a malformed file, `--no-commit`, reported references, `--update-refs`, and a failure before any write when a linking issue is itself duplicated.
- `src/cli/commands/renumber.test.ts`: a real two-clone setup (bare origin; both clones create #1; push, then pull to merge). It covers the `show` hint, listing candidates without a terminal, human and JSON output, `--update-refs` with the exact files in the commit, `--no-commit`, `--force`, the next `create` getting the next ID, and the terminal prompt via injected input.

**Decisions**
- A non-duplicated ID without `--force` fails with `invalid_state` (exit 3) rather than `confirmation_required`, because it's a state conflict, not an unconfirmed destructive action.
- `#N` mentions are reported but never rewritten, and `--update-refs` points every link at the new ID. It can't tell which copy a link meant, so the user still has to check.
- References are only looked for in this worktree's files, not on other branches or worktrees.
- Nothing was added to the web API or UI; the 409 message there now mentions renumbering, without the CLI command.

**Follow-ups noticed**
- The claim/availability logic for other branches and worktrees (#65, #66) matches issues by ID only. Until other clones fetch the renumber, their old-ID version of the moved issue can still be read as a newer version of the copy that kept the ID (for example, a claim).
- `amendStrategy` (web) has no special case for `'renumber'`. That's harmless for now because only the CLI calls it; if the web gets renumber, treat it like `delete` (always a new commit).
- The renamed issue gets no comment recording its old ID; that might help when reading old `#N` mentions.
