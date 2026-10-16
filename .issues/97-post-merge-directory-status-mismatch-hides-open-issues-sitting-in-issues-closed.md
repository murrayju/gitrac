---
id: 97
title: >-
  Post-merge directory/status mismatch hides open issues sitting in
  .issues/closed/
status: backlog
priority: medium
assignee: ''
labels:
  - bug
created: '2026-10-16T12:12:43.845Z'
createdBy: Justin Murray
updated: '2026-10-16T12:12:43.845Z'
---

When branch A closes an issue at `T1` (moving `.issues/1-foo.md` to `.issues/closed/1-foo.md`) and branch B updates it at `T2 > T1` with an open status (keeping it in `.issues/1-foo.md`), `git merge` resolves the rename to `.issues/closed/1-foo.md` and invokes `gitrac merge-driver`. `mergeIssueFrontmatter` picks branch B's open status (`T2 > T1`), leaving an issue with an open status inside `.issues/closed/` (or, in the inverse case, a closed status inside `.issues/`).

Because `listIssues` (`src/service/list.ts:62`) only reads `.issues/closed/` when `includesClosed(query, config)` is true, an open-status issue sitting in `.issues/closed/` is completely hidden from `gitrac ls` (default open filter) and `GET /api/issues`.

## Acceptance criteria

- Ensure `listIssues` does not hide an open-status issue whose file is in `.issues/closed/` (or relocate/surface mismatched files consistently).
- Add regression tests in `src/service/` and `src/cli/commands/list.test.ts` for open-status issues in `.issues/closed/` and closed-status issues in `.issues/`.
