---
id: 83
title: init assumes the default branch is main
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - enhancement
created: '2026-10-15T16:07:06.399Z'
createdBy: Justin Murray
updated: '2026-10-15T17:32:52.232Z'
---

`gitrac init` always writes `git.defaultBranch: main`. Repos on `master` (or anything else) then get a "not on the default branch" warning on every `ls`/`show`/`ready`/`next` until the user edits config.

## Acceptance criteria

- `init` detects the default branch: `origin/HEAD` if set, else the current branch, else `init.defaultBranch` from git config, else `main`.
- Tests for each source.

---

### Justin Murray — 2026-10-15T17:32:52.232Z

`gitrac init` now picks up the repo's default branch instead of always writing `main`. A repo on `master` gets `defaultBranch: master` and no "not on the default branch" warning. `./bun run check` passes (1103 tests). I also ran it end to end in a scratch repo on `master`: `init` wrote `defaultBranch: master` and `ls` printed no warning.

**What was wrong**
`createDefaultConfig()` always wrote `git.defaultBranch: main`. In repos on any other branch, `ls`/`show`/`ready`/`next` warned "not on the default branch" every time until someone edited `config.yaml` by hand.

**What changed**
`init` now checks these sources in order, as the issue asks:
1. **`origin/HEAD`:** the branch it points at, with the `origin/` prefix removed.
2. **Current branch:** includes a brand-new repo with no commits yet; skipped if HEAD is detached.
3. **`init.defaultBranch`** from git config.
4. **`main`** if none of the above gives a name.

**How**
- **`src/core/config.ts`:** new `chooseDefaultBranch(hints)` applies the order above as a plain function (blank values are skipped). `createDefaultConfig({ defaultBranch? })` takes an optional override; with no argument it still returns `main`.
- **`src/git/status.ts`:** new `detectDefaultBranch(dir)` reads the three values from git and never throws. If a git command fails, that source is skipped, so outside a repo it falls back to git config or `main`.
- **`src/fs/issue-store.ts`:** `initIssuesDir(dir, { force?, defaultBranch? })` passes the value through. The fs layer doesn't call git, so the layering stays intact.
- **`src/service/config.ts`:** `initProject` runs the detection inside the repo lock and passes the result down. The CLI, web and every other caller of `initIssuesDir` behave as before.

**Tests (all fail without the fix)**
- `src/core/config.test.ts`: the priority order, blank values falling through to `main`, and the `createDefaultConfig` override.
- `src/git/status.test.ts`: one test per source against real git repos — `origin/HEAD` wins over the current branch and git config; current branch, both before and after the first commit; `init.defaultBranch` with a detached HEAD; `main`; and no error outside a repo.
  - The `main` test sets an empty local `init.defaultBranch`, so a developer's global git config can't change the result.
  - Test repos set their branch with `git symbolic-ref`, so they don't depend on which git version is installed.
- `src/fs/issue-store.test.ts` and `src/service/config.test.ts`: `initProject` in a repo on `master` writes `defaultBranch: master`.

**Docs**
- `README.md`: the "Branch warning" bullet now describes the detection.
- `docs/specs/2026-03-28-gitrac-design.md`: the `gitrac init` row and the branch-warning section describe it too.
- The skill file has nothing about `defaultBranch`, so I left it alone.

**Decisions and trade-offs**
- If there is no `origin/HEAD`, the current branch wins. So running `init` while on a feature branch records that branch, as the issue specifies.
- `init.defaultBranch` is read like any other git setting, so outside a repo it comes from the user's global config, which matches git's own behaviour.

**Follow-ups noticed:** none in scope. `init --force` also re-detects the branch, which is consistent since it rewrites the whole config anyway. My changes don't overlap with the files for #74, #79 or #82; the only shared files are one line in `README.md` and two in the spec.
