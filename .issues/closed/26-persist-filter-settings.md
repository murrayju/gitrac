---
id: 26
title: Persist filter settings
status: done
priority: medium
assignee: Justin Murray
labels:
  - enhancement
created: '2026-03-30T23:53:07.420Z'
createdBy: web
updated: '2026-04-01T17:40:00.330Z'
---

On the issues list, the filter settings should persist in a Zustand store, so that they are preserved when navigating to different views and back.

---

### Justin Murray — 2026-04-01T17:40:00.330Z

Implemented with Zustand store. Created filterStore.ts with shared filter/sort state, updated IssueList.tsx to consume from store instead of local useState. All checks pass.
