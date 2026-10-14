---
id: 37
title: create -p (priority) is swallowed by global -p/--port
status: todo
priority: high
assignee: ''
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-14T21:43:46.806Z'
---

The root program defines `-p, --port <port>` and `create` defines `-p, --priority <priority>`. Commander consumes `-p high` as the global port, so `gitrac create -t x -p high` creates a `medium` priority issue. `edit -p` has the same conflict.

## Acceptance criteria

- `create -p high` and `edit -p high` set priority.
- Move server-only options (`--port`) to an explicit `serve` subcommand (keeping bare `gitrac` as an alias for serving), or otherwise avoid short-flag collisions between global and subcommand options.
- Tests exercising real argv parsing for both commands.
