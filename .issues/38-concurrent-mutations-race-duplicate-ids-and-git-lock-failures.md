---
id: 38
title: 'Concurrent mutations race: duplicate IDs and git lock failures'
status: todo
priority: high
assignee: ''
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

Nothing serializes gitrac writes.

- `allocateNextId` is an unlocked read-modify-write of `config.yaml`.
- Every CLI invocation and every web request runs `git add`/`git commit` independently.
- The web server handles overlapping autosave/comment requests concurrently.

Running 5 `gitrac create` in parallel produced two issues numbered #5 and four `fatal: cannot lock ref 'HEAD'` failures.

This blocks using gitrac with parallel agents.

## Acceptance criteria

- A cross-process lock (e.g. a lockfile under `$(git rev-parse --git-common-dir)/gitrac.lock` with stale-lock detection) wraps the read-modify-write + commit of every mutation, in both CLI and web server.
- Within the web server, mutations are additionally serialized through an in-process queue.
- ID allocation also checks existing filenames so a duplicate ID is never produced even if `nextId` is stale.
- Test: N parallel creates produce N distinct IDs and N commits with no errors.
