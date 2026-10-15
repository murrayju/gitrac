---
id: 63
title: Commenting or claiming can leave duplicate files for one issue
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T01:16:54.902Z'
createdBy: Justin Murray
updated: '2026-10-15T01:17:11.826Z'
---

Found during #51. `addComment` and `claimIssue` (open issue) write the issue under the filename derived from the *current* title, but never remove an existing file whose slug differs (e.g. title edited by hand in the markdown, or older slug rules). The result is two files for the same issue ID; `findIssueFile` then returns whichever comes first in `readdir`.

Close/reopen/edit already handle this via `relocateIssue` — use it everywhere an issue is rewritten (service layer).

## Acceptance criteria

- Every service write path removes the old file when the computed filename differs, and commits the deletion.
- Duplicate IDs on disk are detected: `findIssueFile` (or a `gitrac doctor` check) reports an error listing the conflicting files instead of silently picking one.
- Tests for comment/claim on a file whose name doesn't match its title.
