---
id: 80
title: gitrac --version is hard-coded to 0.1.0
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:03.765Z'
createdBy: Justin Murray
updated: '2026-10-15T16:27:20.520Z'
---

`src/cli/index.ts` calls `.version('0.1.0')`. `scripts/release.ts` bumps `package.json` only, so released binaries will always report 0.1.0.

## Acceptance criteria

- `--version` reports the `package.json` version, both from source and in the compiled binary (e.g. import `package.json` with `with { type: 'json' }` so it's bundled).
- Test that `--version` matches `package.json`.

---

### Justin Murray — 2026-10-15T16:27:20.520Z

\## #80: `--version` now comes from `package.json`

**What was wrong:** `src/cli/index.ts` had `.version('0.1.0')` written into the code. `scripts/release.ts` only updates `package.json`, so every released binary would have reported 0.1.0.

**What changed:**
- **`src/cli/index.ts`** now imports `package.json` with `import packageJson from '../../package.json' with { type: 'json' }` and calls `.version(packageJson.version)`. Because it's a static import, `bun build --compile` builds the version into the binary, so the binary doesn't need to read `package.json` when it runs.
- **`src/cli/version.test.ts`** (new) has three tests:
  - `createProgram().version()` equals the version in `package.json`.
  - Running `index.ts --version` prints that version.
  - It copies `src/` and `index.ts` to a temp directory, links `node_modules`, writes a `package.json` with a bumped version (`98.76.54-test.1`), and checks that `--version` prints it.

  The current version happens to be 0.1.0, so the first two tests pass even with the old code. The third one fails without the fix; I checked by putting the old line back.

**Verification:**
- `./bun run check` passes: typecheck, lint and 1076 tests. Biome reformatted the new test file; nothing else in the tree was changed.
- After a full `./bun run scripts/build.ts`, `./bin/gitrac --version` prints `0.1.0`. A copy of the binary run from an empty temp directory prints the same, so it isn't reading `package.json` when it runs.

**Decisions:**
- I imported the whole `package.json` rather than reading the file at runtime, because a runtime read would break the standalone binary. It works with the current tsconfig settings, so no config changes were needed.
- I didn't change any docs: `README.md` already lists `gitrac --version` and nothing describes how the version is sourced.

**Follow-ups / interactions:** #73 may edit `package.json` (typography plugin). That doesn't affect this change, since only `version` is read.
