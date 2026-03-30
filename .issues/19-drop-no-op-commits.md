---
id: 19
title: Drop no-op commits
status: in_progress
priority: medium
assignee: Justin Murray
labels:
  - enhancement
created: '2026-03-30T00:09:34.775Z'
createdBy: web
updated: '2026-03-30T01:13:24.084Z'
---

As a user makes edits to a ticket, we amend the commit for each. It is possible that the user effectively reverts all their changes, such that the only change remaining in the commit is the `updated` timestamp in the metadata. In this case, we should drop the commit to avoid pushing what was effectively no change.

---

### Justin Murray — 2026-03-30T01:13:24.084Z

Added dropIfNoOp method to AmendTracker that detects when a commit only changes the updated: timestamp in YAML frontmatter and drops it via git reset --hard HEAD~1.

Changes:
- src/git/amend-tracker.ts: Added dropIfNoOp(dir) method that diffs HEAD~1..HEAD, checks if all changed lines are updated: timestamps, and resets HEAD if so
- src/web/routes/issues.ts: After amending in the PATCH handler, calls dropIfNoOp and only records the hash if the commit wasn't dropped
- src/git/amend-tracker.test.ts: Added 4 tests covering: timestamp-only commits are dropped, real content changes are preserved, tracker state is cleared after drop, and working tree is clean after drop
