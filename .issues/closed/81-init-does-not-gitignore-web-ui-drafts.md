---
id: 81
title: init does not gitignore web UI drafts
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:04.696Z'
createdBy: Justin Murray
updated: '2026-10-15T16:42:21.204Z'
---

The web UI saves new-issue drafts to `.issues/drafts/*.json` (untracked). This repo's own `.gitignore` excludes them, but `gitrac init` doesn't set that up for other projects. The documented `git add -A && git commit` workflow then commits drafts.

## Acceptance criteria

- `gitrac init` writes `.issues/.gitignore` containing `drafts/` and commits it. `install-merge-driver` or another idempotent path ensures existing projects get it (or document a one-time step; prefer automatic).
- Lock/temp files gitrac might create under `.issues/` are also covered if any.
- This repo's `.issues/` gets the file too (orchestrator will commit it).
- Tests.

---

### Justin Murray — 2026-10-15T16:42:21.204Z

**Fix #81: `init` now gitignores web UI drafts**

**What was wrong**
The web UI saves new-issue drafts to `.issues/drafts/*.json`. Only this repo's own root `.gitignore` excluded them; `gitrac init` set nothing up for other projects. So the documented `git add -A && git commit` workflow committed drafts.

**What changed**
- **New `src/fs/gitignore.ts`:** `writeIssuesGitignore(dir)` makes sure `.issues/.gitignore` contains `drafts/`. It creates the file with a header comment, or adds the missing line to an existing file and keeps everything else. Running it twice changes nothing, and it accepts equivalent existing patterns (`drafts`, `/drafts/`). It returns whether it wrote anything. It's also where `ISSUES_GITIGNORE_PATH` and `ISSUES_GITIGNORE_LINES` are defined.
- **`initProject`** (`src/service/config.ts`) writes the file and commits it with `config.yaml` and `.gitattributes`.
- **Existing projects get it automatically, two ways:**
  - **`installMergeDriver`** (`src/service/merge-driver.ts`) also writes `.issues/.gitignore` and commits it in the same "install merge driver" commit, only if it changed. The output's `paths` lists it.
  - **The drafts route** (`PUT /api/drafts/:filename`, `src/web/routes/drafts.ts`) writes the file before saving a draft, **without committing it**. Drafts are ignored from the very first save, before anyone runs `install-merge-driver`. The file then shows up as untracked, so `git add -A` picks it up, or `install-merge-driver` commits it.
- **`install-merge-driver` CLI** (`src/cli/commands/merge-driver.ts`): the human-readable output now names the files it actually wrote or committed (before, it always said `.gitattributes`). The description is updated too.
- **Lock/temp files:** I checked, and none are created under `.issues/`. The repo lock, the ID high-water mark and their temp files live in the git dir (or the OS temp dir outside a repo), and the merge driver uses `mkdtemp` in the OS temp dir. So `drafts/` is the only entry, and the spec now says so.

**Tests** (all new ones fail without the fix):
- `src/fs/gitignore.test.ts`: creating the file, adding to an existing one, equivalent patterns, and a real `git check-ignore`/status check.
- `src/web/routes/drafts.test.ts` (new): the first draft save adds the file; an existing file that already covers drafts is left alone; a rejected filename writes nothing.
- `src/service/config.test.ts`: `init` writes and commits `.issues/.gitignore`.
- `src/service/merge-driver.test.ts`:
  - `install-merge-driver` writes and commits `.gitattributes` and `.gitignore`.
  - In a project that already has the driver, it adds only `.gitignore`.
  - End to end in a real repo: `init` commits the file, and the tree stays clean after a draft is written.

`./bun run check` passes (1082 tests). I also ran `init` and `install-merge-driver` in a scratch repo and both work.

**Docs:** the spec (directory layout, the `init` and `install-merge-driver` rows, the concurrency note on drafts), the README file tree and command table, and the skill's command table.

**Trade-offs**
- **Drafts route doesn't commit:** drafts don't take the repo lock or go through the service layer, and a commit from an autosave would be surprising. Writing the file uncommitted is harmless because the content never changes once written.
- **Possible small race:** a draft save happening at the same moment as `init`/`install-merge-driver` could also write the file, but both write the same content.
- **Bundled into `install-merge-driver`:** it's the one-time-per-clone command people already run, so it was the natural place. The commit message is still "install merge driver".

**Follow-ups noticed**
- This repo's own `.issues/.gitignore` isn't added, since I wasn't allowed to touch `.issues/`. The orchestrator should run `./gitrac install-merge-driver` here (or start the web UI and save a draft), which writes and commits it. The root `.gitignore` entry `.issues/drafts/` can stay; it's now redundant but harmless.
- `GET /api/drafts` still creates an empty `.issues/drafts/` directory. Git ignores empty directories, so I left it as is.
