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
updated: '2026-04-01T17:41:07.759Z'
---

On the issues list, the filter settings should persist in a Zustand store, so that they are preserved when navigating to different views and back.

---

### Justin Murray — 2026-04-01T17:40:00.330Z

Implemented with Zustand store. Created filterStore.ts with shared filter/sort state, updated IssueList.tsx to consume from store instead of local useState. All checks pass.

### Justin Murray — 2026-04-01T17:41:03.581Z

Implemented filter persistence using a Zustand store.

**Changes:**
- Added zustand as a dependency
- Created src/web/ui/stores/filterStore.ts — a Zustand store holding statusFilter, priorityFilter, assigneeFilter, sortField, and sortDir with setter actions. Also exports the SortField and SortDir types.
- Updated src/web/ui/components/IssueList.tsx — replaced 5 local useState hooks with useFilterStore selectors. Filter and sort state now persists across navigation since the Zustand store lives outside the component lifecycle.

All existing tests pass, no lint or type errors.
