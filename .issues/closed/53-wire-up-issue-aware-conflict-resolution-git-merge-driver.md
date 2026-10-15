---
id: 53
title: Wire up issue-aware conflict resolution (git merge driver)
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T02:29:08.301Z'
---

`resolveIssueConflict`, `mergeIssueFrontmatter` and `mergeComments` in `src/git/conflict.ts` are implemented and tested but never invoked. `pullRebase` is also unused.

## Proposal

- Add `gitrac merge-driver %O %A %B %P` command implementing a git custom merge driver for `.issues/**/*.md` (exit non-zero when descriptions truly conflict).
- `gitrac init` (and a `gitrac install-merge-driver` command) writes `.gitattributes` (`.issues/**/*.md merge=gitrac`) and the local `merge.gitrac.driver` git config.
- A merge strategy for `config.yaml` (`nextId` = max of both, union of labels/assignees).
- Fix: `mergeIssueFrontmatter` should take the max of `updated` rather than "ours wins".

---

### Justin Murray — 2026-10-15T02:29:08.301Z

\## #53: gitrac git merge driver for issue files and `config.yaml`

**What was wrong.** `resolveIssueConflict`, `mergeIssueFrontmatter` and `mergeComments` in `src/git/conflict.ts` existed but nothing called them, so git merged issue files line by line. `mergeIssueFrontmatter` also let "ours" win every field both sides changed, including `updated`. Nothing merged `config.yaml`. `./bun run check` passes (802 tests), and the new tests fail without the change.

**What changed**
- **New command `gitrac merge-driver <base> <ours> <theirs> [path]`.** Git runs it as `--marker-size %L %O %A %B %P`. It writes the result to `%A` and exits 0 when clean, 1 when conflicts remain. It chooses how to merge by path: `.issues/config.yaml`, `.issues/**/*.md`, or plain text for anything else.
- **Issue merge (`mergeIssueFiles`):**
  - **Frontmatter:** merged per field. A field changed on one side takes that change. A field changed on both sides goes to the side with the later `updated` (a tie goes to ours). `updated` is now the later of the two, which is the requested fix. Labels merge as a set, so additions and removals from both sides are kept.
  - **Description:** if both sides changed it, `git merge-file` merges it line by line. If that conflicts, the file is still written with the frontmatter and comments merged, the conflict markers stay inside the description, and the driver exits 1.
  - **Comments:** three-way, keyed by author + timestamp. A comment deleted on one side stays deleted, unless the other side edited it.
- **`config.yaml` merge (`mergeConfigFiles`):**
  - `nextId` takes the larger value.
  - Labels are unioned; if both sides changed a color, ours wins.
  - Assignees are unioned and deduplicated by email (case-insensitive).
  - Removals made on one side stick.
  - `git.*` and any other key merge three-way, with ours winning conflicts.
  - Each side picks its own colors for new labels, so the same color can end up on two labels. In that case the label added on their side gets a new color.
- **Fallback when parsing fails.** If any version fails a strict parse, the driver runs `git merge-file` in place instead. Strict means: frontmatter present, a valid id and YAML, no leftover conflict markers, the same ID in every version, and a valid config. The same fallback runs if the merged issue doesn't read back identically. This gives git's normal conflict markers and exit 1, with a one-line note on stderr. It never writes a half-merged file.
- **New command `gitrac install-merge-driver [--command <cmd>]`, and `init` now does the same:**
  - Writes `.issues/.gitattributes` (`*.md merge=gitrac`, `config.yaml merge=gitrac`) and commits it if it changed.
  - Sets `merge.gitrac.name` and `merge.gitrac.driver` in the local git config. It's idempotent, and outside a git repo it skips the git config.
  - The default `<cmd>` is `gitrac` if that's the binary on `PATH`, otherwise the binary's absolute path. Running from source it is `./gitrac` inside the gitrac repo (git runs drivers at the work-tree root; I checked this), otherwise `<bun> <index.ts>`.
- Both commands go through a new service operation, `installMergeDriver` (`src/service/merge-driver.ts`), which holds the repo lock; I added the `'merge-driver'` operation. `initProject` adds `.gitattributes` to the files it commits.

**Files**
- New: `src/git/merge-driver.ts`, `src/service/merge-driver.ts`, `src/cli/commands/merge-driver.ts`, each with a test file. The `src/git/merge-driver.test.ts` tests include real `git merge` runs in a scratch repo.
- Changed: `src/git/conflict.ts` (+ tests), `src/service/config.ts` (+ test), `src/service/context.ts`, `src/cli/index.ts`, `AGENTS.md`, `skills/using-gitrac/SKILL.md`, and the design spec (Conflict Resolution rewritten, command table, ID-collision note).

**Decisions and trade-offs**
- **Attributes file location.** The attributes go in `.issues/.gitattributes`, not the root `.gitattributes`. It's less intrusive and is committed alongside `config.yaml`.
- **Per-clone setup.** Git config isn't versioned, so every clone needs to run `install-merge-driver` once. A clone without it just gets git's normal text merge. If the binary moves, re-run it.
- **Conflict marker labels** are plain `ours`/`base`/`theirs`. I didn't use `%S/%X/%Y` because older git versions don't support them.
- **`resolveIssueConflict`** is now async and wraps `mergeIssueFiles`.
- **Merged files are rewritten in gitrac's standard format.** Unknown frontmatter keys are dropped, as on any gitrac write.

**What happens with renames (documented)**
- A title change (rename) or a close (move to `closed/`) on one side, with edits on the other, merges cleanly into the renamed file.
- If both sides changed the title, git reports a rename/rename conflict and leaves two files with the same merged content. The user keeps one and `git rm`s the other; until then gitrac reports `duplicate_issue`.
- If the merged status doesn't match the directory git kept, the next gitrac write to that issue moves it.

**Follow-ups noticed**
- **`renumber` command.** The same ID created in two separate clones (different filenames) isn't a content conflict, so the driver never sees it. It shows up as `duplicate_issue`, and for now the docs say to fix it by hand. A `gitrac renumber <file>` command could do this.
- **This repo's own `.issues/`.** It doesn't have `.gitattributes` yet; I didn't touch it, per the rules. Run `./gitrac install-merge-driver` here once (it picks `./gitrac` automatically).
- **`pullRebase`** is still unused. It's out of scope, and a rebase uses the driver anyway.
- **Possible overlap with #59.** I made one-word edits to the service-op lists in `AGENTS.md` and the spec, plus small additions to the command list in `src/cli/index.ts`, the `Operation` union, and the spec's command table, so these may conflict trivially with #59.
