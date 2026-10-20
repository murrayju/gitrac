---
id: 117
title: add `gitrac commit` command
status: in_progress
priority: medium
assignee: justin@tigerdata.com
labels:
  - feature
created: '2026-10-20T21:03:15.462Z'
createdBy: Justin Murray
updated: '2026-10-20T22:23:49.666Z'
---

This command acts as a proxy to `git commit`, while simultaneously closing the issue. This will allow us to clean up the suggested workflow, that involves using `gitrac close <id> --no-commit` to make the commit atomic (fix and close together).

Proposed syntax:

```
gitrac commit <id> [<gitrac close params>] [-- <git commit params>]
```

Examples:

```
# explicit form
gitrac commit 123 -c "comment on issue" -- -m "commit message"

# no issue comment, interactive git commit
gitrac commit 123
```

This will implicitly perform the `gitrac close` first (staging the issue change, but not committing it), then shell out to `git commit`
