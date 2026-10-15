---
id: 48
title: Web server config cache goes stale
status: done
priority: low
assignee: justin@tigerdata.com
labels:
  - bug
created: '2026-10-14T21:43:46.806Z'
createdBy: Justin Murray
updated: '2026-10-15T00:38:13.962Z'
---

`ctx.config` is read once at startup. CLI changes to `config.yaml` (new assignees from `claim`, label colors, git settings like `autoCommit`) are not seen by the server until restart; `GET /api/config` returns stale data and routes use stale git settings.

## Acceptance criteria

- Reload config when `config.yaml` changes (the watcher already watches `.issues/`), or read fresh per request.
- Emit an SSE event so the UI refreshes config.

---

### Justin Murray — 2026-10-15T00:38:13.962Z

\## #48: Web server now always uses the current config

**What was wrong**
The server read `config.yaml` once at startup into `ctx.config` and never reloaded it. Anything the CLI changed after that was invisible until a restart: new assignees from `claim`, label colors, `defaultStatus`/`defaultPriority`, and `git.autoCommit`/`commitPrefix`. So `GET /api/config` returned old data, and mutations validated, filled in defaults and decided whether to commit using old settings. The SSE half of the issue was already working: `config.yaml` lives in the watched `.issues/` directory, so changes to it already sent `issues-changed`, and the UI's shared config store already refetched on that event. It just got the old copy back.

**What changed**
- **New `src/web/live-config.ts`:**
  - `reloadConfig(ctx)` re-reads `config.yaml` into `ctx.config`. If the file can't be read or parsed (e.g. someone is mid-edit), it keeps the last good config.
  - `freshConfig(ctx)` is middleware that does this reload before every GET/HEAD API request.
- **`src/web/server.ts`:** `createApp` adds `app.use('/api/*', freshConfig(ctx))`, so read routes (`/api/config`, `/api/git/status`, …) always reflect the file. There is a doc comment on `ServerContext.config`.
- **`src/web/lock.ts`:** `mutationLock` now reloads config right after taking the repo lock, before the handler runs. Mutations can't race a CLI write, because CLI writes hold the same lock. Every existing mutating route gets this without any handler changes, since handlers read `ctx.config` after the middleware has run.
- **Choice of approach:** I read the file per request rather than reloading when the watcher fires. A watcher-driven reload would race the UI's refetch (the SSE event and the reload both happen after the debounce), and it would leave a window where a mutation runs with old settings. The cost is one small YAML read per API request; the issues list already reads every issue file per request.

**Tests**
- **New `src/web/live-config.test.ts`:** 6 tests. They cover:
  - `GET /api/config` shows assignee and label changes made on disk.
  - A POST uses new defaults.
  - A POST commits using the new `autoCommit` and `commitPrefix` (real git repo).
  - The label PATCH keeps assignees the CLI added.
  - An invalid file falls back to the last good config.
  - End to end over `Bun.serve`: a write to `config.yaml` sends `issues-changed` over SSE, and `GET /api/config` afterwards returns the new data.

  With the reload disabled, 5 of the 6 fail. The label PATCH test passes either way because that route already re-read the file itself.
- **Existing test setups:** `issues.test.ts`, `issues-validation.test.ts`, `identity.test.ts` and `server.test.ts` only turned off `autoCommit` in memory. Since the server now re-reads the file, they write that config to disk with `writeConfig` instead.
- `./bun run check` passes (641 tests).

**Docs**
- `docs/specs` (Web UI section): new "Live config" paragraph.
- `AGENTS.md`: a convention line saying server config is re-read per request, and tests must write custom config to disk.

**Things that interact with other work**
- **#50 (web close/reopen routes):** any new web route test that sets values like `config.git.autoCommit = false` only in memory will now have them overwritten from disk. It needs to `writeConfig` them, as the updated test setups do. Handlers that read `ctx.config` / destructure `config` after `mutationLock` automatically get the current config.
- **Not changed:**
  - `routes/config.ts` still calls `readConfig` itself; that's now redundant but harmless.
  - `writeConfig` isn't atomic (a plain `writeFile`). A GET could in theory catch the file half-written. Unparseable content falls back to the last good config, and the watcher's follow-up event triggers a correct refetch. Mutations read under the lock, so they're safe. An atomic temp-file-and-rename write would close this fully; it could be a follow-up.
  - The branch warning printed at startup still uses the startup config, which is fine for a one-time message.
