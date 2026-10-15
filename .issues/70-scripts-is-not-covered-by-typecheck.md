---
id: 70
title: scripts/ is not covered by typecheck
status: todo
priority: low
assignee: ''
labels:
  - chore
created: '2026-10-15T13:15:05.462Z'
createdBy: Justin Murray
updated: '2026-10-15T13:15:05.462Z'
---

`tsconfig.json` `include` doesn't cover `scripts/`, so `./bun run typecheck` (and CI) never type-checks `scripts/build.ts` or `scripts/release.ts`. Add them (and any other TS outside `src/` such as `index.ts`, `vite.config.ts`) to the typecheck and fix any errors found. Make sure lint covers them too.
