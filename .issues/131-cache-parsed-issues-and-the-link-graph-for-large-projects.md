---
id: 131
title: Cache parsed issues and the link graph for large projects
status: backlog
priority: low
assignee: ''
labels:
  - enhancement
links:
  - type: issue
    relationship: related
    id: 127
created: '2026-11-02T17:44:50.323Z'
createdBy: Justin Murray
updated: '2026-11-02T17:44:55.805Z'
---

Every `ls`, `ready`, `show` and link command reads and parses every issue file (open and closed). The link relations are derived from all issues' links (each link is stored once, on the dependent issue), so `show` and the links panel need them all too. Parsing costs about 0.35 ms per issue: 125 ms for this repo (128 issues), 1.6 s for 5,000, 7 s for 20,000. Building the link graph is cheap (indexed; about 120 ms for 20,000 issues with 40,000 lookups).

Add caching so large projects stay fast:

- Web server: keep the parsed issues (and the link graph) in memory, updated from the file watcher it already runs, instead of re-reading `.issues/` per request.
- CLI: a parsed-issue cache in the git dir (e.g. `$(git rev-parse --git-common-dir)/gitrac/cache/<worktree>`), keyed by path + size + mtime, so only changed files are parsed. Per worktree, since worktrees have different files.
- Mutations under the repo lock must still read fresh (or validate the cache entries they use against the files).
- Measure before and after, on synthetic projects of 1k / 5k / 20k issues.
