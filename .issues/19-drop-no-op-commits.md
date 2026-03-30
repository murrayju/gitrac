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
updated: '2026-03-30T01:07:57.028Z'
---

As a user makes edits to a ticket, we amend the commit for each. It is possible that the user effectively reverts all their changes, such that the only change remaining in the commit is the `updated` timestamp in the metadata. In this case, we should drop the commit to avoid pushing what was effectively no change.
