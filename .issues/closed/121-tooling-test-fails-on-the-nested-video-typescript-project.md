---
id: 121
title: Tooling test fails on the nested video/ TypeScript project
status: done
priority: medium
assignee: justin@tigerdata.com
labels:
  - chore
created: '2026-10-20T21:25:44.664Z'
createdBy: Justin Murray
updated: '2026-10-20T21:25:46.576Z'
---

`src/tooling.test.ts` (#70) requires the root `tsconfig.json` to include every tracked TypeScript file. `video/` (the Remotion demo video, added on origin) is a separate npm project with its own `package.json`, `tsconfig.json` and dependencies that are not installed at the root, so the test fails on origin/main and after the merge.

## Acceptance criteria

- The test skips files in a nested project (a directory below the root with its own `tsconfig.json`), and still catches root files that the root config misses.

---

### Justin Murray — 2026-10-20T21:25:46.125Z

**What was wrong:** `src/tooling.test.ts` checks that the root `tsconfig.json` covers every tracked TypeScript file. `video/` (the Remotion demo video) has its own `package.json`, `tsconfig.json` and dependencies, which are not installed at the root, so the root config can't type-check it. The test failed on origin/main, and so after the merge too.

**What changed:** a new `inNestedProject(file)` helper in the test walks up from each file to the repo root. A file under a directory with its own `tsconfig.json` belongs to that nested project and is skipped. Root files are still checked: `scripts/`, `src/` and `index.ts` are not nested, `video/src/*` is.

**Verification:** the tooling tests pass (3/3). Typecheck and lint are clean. The full suite after the merge had this as its only failure (1608 pass, 1 fail).
