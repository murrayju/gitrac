---
id: 70
title: scripts/ is not covered by typecheck
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - chore
created: '2026-10-15T13:15:05.462Z'
createdBy: Justin Murray
updated: '2026-10-15T13:33:27.162Z'
---

`tsconfig.json` `include` doesn't cover `scripts/`, so `./bun run typecheck` (and CI) never type-checks `scripts/build.ts` or `scripts/release.ts`. Add them (and any other TS outside `src/` such as `index.ts`, `vite.config.ts`) to the typecheck and fix any errors found. Make sure lint covers them too.

---

### Justin Murray — 2026-10-15T13:33:27.162Z

Typecheck now covers every TypeScript file in the repo, not just `src/`. `./bun run check` passes (997 tests) and `./bun run scripts/build.ts --minify` still builds `./bin/gitrac`.

**What was wrong**
In `tsconfig.json`, `include` only listed `index.ts` and `src/**/*`. So `./bun run typecheck` and CI never checked `scripts/build.ts`, `scripts/release.ts` or `vite.config.ts`.

**What changed**
- **`tsconfig.json`**: `include` is now `["*.ts", "scripts/**/*", "src/**/*"]`, which covers all root-level TS files, `scripts/` and `src/`. With these files added, `tsc` found no type errors, so no script code changed.
- **Lint already covered these files.** `biome.json` has no `files.includes` and relies on the git ignore file, so `biome check` was already linting `index.ts`, `scripts/*.ts` and `vite.config.ts` (I confirmed this with `biome check --verbose`). I left `biome.json` alone.
- **New test, `src/tooling.test.ts`**:
  - Takes every git-tracked `.ts`/`.tsx` file (skipping `.d.ts`) and asks the TypeScript compiler which files `tsconfig.json` resolves to. That way it follows tsc's own include/exclude/extends rules. It fails if any tracked file is missing.
  - If someone later adds `files.includes` to `biome.json`, it checks that every tracked TS file still matches it.
  - With the old `tsconfig.json` it fails, listing `scripts/build.ts`, `scripts/release.ts` and `vite.config.ts` as missing.
- **`AGENTS.md`**: the Testing section now says what typecheck and lint each cover.

**Decisions / trade-offs**
- The test lives in `src/` because `bunfig.toml` sets the test root to `src`.
- It imports `typescript`, a devDependency, which adds about 1.2s on first load. It does not run a full `tsc`.
- I used `*.ts` at the root rather than naming each file, so new root config files are picked up automatically.

**Follow-ups / interactions**
- There's an untracked `download` entry in this worktree that I didn't create. `.gitignore` has `download/` with a trailing slash, which only matches directories, so if `download` is a file or symlink it isn't ignored. You may want to change that line to `download`.
- This shouldn't conflict with #67, #68 or #69 (only `tsconfig.json`, one `AGENTS.md` line and a new test file changed). Any new TS file they add outside `src/` will now be typechecked automatically.

**Orchestrator note:** also changed `.gitignore` `download/` → `download` so a symlinked bun download dir (as used in worktrees) is ignored too.
