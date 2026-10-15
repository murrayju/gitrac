---
id: 88
title: ./gitrac wrapper doesn't resolve symlinks
status: todo
priority: low
assignee: ''
labels:
  - bug
created: '2026-10-15T16:07:10.988Z'
createdBy: Justin Murray
updated: '2026-10-15T16:07:10.988Z'
---

The `./gitrac` source wrapper resolves `bun` and `index.ts` relative to `dirname "$0"`. If you symlink it onto your PATH (`ln -s ~/src/gitrac/gitrac ~/.local/bin/gitrac`), it looks for `~/.local/bin/bun` and fails.

## Acceptance criteria

- Resolve the script's real path (portable on Linux and macOS without GNU `readlink -f`, e.g. a loop over `readlink`).
- Test (shell-level, run from bun test) that a symlinked wrapper works from another directory.
- Mention in README "From source".
