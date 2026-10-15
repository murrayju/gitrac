---
id: 88
title: ./gitrac wrapper doesn't resolve symlinks
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-15T16:07:10.988Z'
createdBy: Justin Murray
updated: '2026-10-15T18:18:37.134Z'
---

The `./gitrac` source wrapper resolves `bun` and `index.ts` relative to `dirname "$0"`. If you symlink it onto your PATH (`ln -s ~/src/gitrac/gitrac ~/.local/bin/gitrac`), it looks for `~/.local/bin/bun` and fails.

## Acceptance criteria

- Resolve the script's real path (portable on Linux and macOS without GNU `readlink -f`, e.g. a loop over `readlink`).
- Test (shell-level, run from bun test) that a symlinked wrapper works from another directory.
- Mention in README "From source".

---

### Justin Murray — 2026-10-15T18:18:37.134Z

Fixed: the `./gitrac` wrapper now works when you symlink it onto your PATH. `./bun run check` passes.

**What was wrong**
The wrapper looked for `bun` and `index.ts` next to the path it was called by (`dirname "$0"`). After `ln -s ~/src/gitrac/gitrac ~/.local/bin/gitrac`, it went looking for `~/.local/bin/bun` and failed.

**What changed**
- **`gitrac`:** the wrapper now follows the symlink chain with a plain `readlink` loop until it reaches the real file, then uses that file's directory. A relative link target is resolved against the link's own directory, so chains like `a -> ../b -> /repo/gitrac` work. It doesn't need GNU `readlink -f`, so it works on Linux and macOS. Paths stay quoted. Running it directly as `./gitrac` or `../gitrac` from a subdirectory behaves as before.
- **`src/wrapper.test.ts` (new):** shell-level tests run from `bun test`. Each one sets up symlinks in a temporary directory whose name contains a space, runs `--version` from another directory, and checks the output matches the version in `package.json`. The three cases are:
  - an absolute symlink;
  - a symlink found by `PATH` lookup;
  - a chain of relative symlinks.

  All three fail against the old wrapper and pass with the fix.
- **`README.md`:** the "From source" section now says the wrapper also works through a symlink, with an example `ln -s` command.

**Decisions / trade-offs**
- The test lives in `src/` because `bunfig.toml` sets the test root to `src`. It finds the repo root the same way `src/tooling.test.ts` does.
- I didn't change `./bun`. The wrapper always calls it by its real path, so it never sees a symlink. If someone symlinked `./bun` itself, it would hit the same problem.

**Follow-ups noticed**
- `docs/plans/2026-03-28-gitrac-implementation.md` still shows the old `dirname "$0"` snippet. It's a historical plan document, so I left it alone.
- No overlap with #84, #86 or #76. The only shared file I touched is a one-sentence edit in `README.md`.
