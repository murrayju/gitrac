---
id: 121
title: Tooling test fails on the nested video/ TypeScript project
status: backlog
priority: medium
assignee: ''
labels:
  - chore
created: '2026-10-20T21:25:44.664Z'
createdBy: Justin Murray
updated: '2026-10-20T21:25:44.664Z'
---

`src/tooling.test.ts` (#70) requires the root `tsconfig.json` to include every tracked TypeScript file. `video/` (the Remotion demo video, added on origin) is a separate npm project with its own `package.json`, `tsconfig.json` and dependencies that are not installed at the root, so the test fails on origin/main and after the merge.

## Acceptance criteria

- The test skips files in a nested project (a directory below the root with its own `tsconfig.json`), and still catches root files that the root config misses.
